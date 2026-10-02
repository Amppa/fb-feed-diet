/**
 * FB Diet - shared DOM observation (MAIN world)
 *
 * Owns stage 3 of the DOM pipeline: the three-slot precedence order, the one shared
 * observer per mounted unit, the coalescing throttle, the streaming-Suspense retry
 * ladder, the hard timeout and the tray veto. Split out of fold.js; this file holds no
 * verdict and renders nothing.
 *
 * Siblings it calls: fold-config.js (window.FBDietFoldConfig) for the three scan
 * tunings. Every other module reads it, and it reads only FB_DIET_DEFAULTS and the
 * window.FBDietDOM* detectors by name, so it declares no load order.
 * Members are not prefixed with the module own name, so the module reads
 * window.FBDietFoldObserver.setupDomObserver rather than
 * window.FBDietFoldObserver.FBDietSetupDomObserver.
 */
window.FBDietFoldObserver = (() => {
  'use strict';

  function getConfig() {
    return window.FBDietFoldConfig || {};
  }

  /**
   * The three DOM detection slots, in the precedence order each observation round applies.
   * Surface (structural) precedes suggested (content cues) so a tray tile carrying buttons
   * never reads as a suggestion (misclassification #8); sponsorship is evaluated in the same
   * round but applied as an unconditional override at convergence (decision #39), never by
   * first-hit-wins.
   */
  const DOM_SCAN_SLOTS = [
    { slot: 'surface', detectorName: 'FBDietDOMSurface', hitKey: 'isSurface' },
    { slot: 'suggested', detectorName: 'FBDietDOMSuggested', hitKey: 'isSuggested' },
    { slot: 'sponsored', detectorName: 'FBDietDOMSponsored', hitKey: 'isSponsored' }
  ];

  /**
   * Watches a mounted unit for streaming DOM that the render-time verdict could not see
   * (Comet renders posts while Suspense resolves them). Armed in `dom` mode only.
   *
   * Stage 3 of the DOM pipeline: every entry point — the retry ladder, a MutationObserver
   * burst, an IntersectionObserver callback — funnels through `schedule`, so a busy post
   * costs one detection pass per throttle window instead of one per mutation batch.
   * The hard timeout calls `stop()`, and stopping is final: observers are disconnected,
   * the pending scan and the ladder are cleared, and `finished` keeps a late mutation from
   * re-arming any of it (a folded unit stays mounted for the life of the tab, so nothing
   * else would stop it).
   *
   * One observer serves all unfilled slots (`options.skip` names the slots that already
   * answered — a missing detector module counts as answered, since it can never fire).
   * A slot that answers is reported once via `options.onResult(slot, detected)` and then
   * silenced for the rest of this arm; the observer itself keeps watching the remaining
   * slots until the timeout. The caller re-arms (a fresh arm with a narrower skip set)
   * when new results land, so no slot ever starves because another one answered first.
   *
   * Two bailouts keep virtual-scroll and skeleton renders cheap. Both skip the pass
   * without stopping: stopping is final, and a node that is merely not ready yet must
   * still be there when the next ladder rung fires.
   *   - detached: `el.isConnected === false` (virtual scroll recycled the node).
   *   - skeleton: at most one child element and no text yet (Suspense placeholder).
   *
   * A tray veto (`options.vetoYes`, or computed once per round) skips the suggested sweep
   * outright: a tray satisfies every "looks like a cue" heuristic at once, so running the
   * five scans on it is pure waste. The veto is cached only when positive — a negative on
   * a skeleton may simply mean the tray has not streamed in yet, so it is re-checked.
   *
   * Returns the effect cleanup function, or undefined when the synchronous first pass
   * already filled every armed slot and nothing had to be scheduled.
   */
  function setupDomObserver(containerRef, options) {
    const config = getConfig();
    const scanDelays = config.DOM_SCAN_DELAYS;
    const scanTimeoutMs = config.DOM_SCAN_TIMEOUT_MS;
    const scanThrottleMs = config.DOM_SCAN_THROTTLE_MS;

    // The retry ladder, the coalescing window and the hard timeout all come from the
    // constants module. Without them there is no schedule to run, so the arm watches
    // nothing at all rather than inventing one.
    if (!Array.isArray(scanDelays) || typeof scanTimeoutMs !== 'number' || typeof scanThrottleMs !== 'number') {
      return undefined;
    }

    const opts = options || {};
    const onResult = typeof opts.onResult === 'function' ? opts.onResult : function () {};
    const skip = opts.skip || {};
    let vetoYes = Boolean(opts.vetoYes);

    const armed = DOM_SCAN_SLOTS.filter((entry) => {
      if (skip[entry.slot]) return false;
      const detector = window[entry.detectorName];
      return Boolean(detector && typeof detector.detect === 'function');
    });

    // Nothing to watch: no observer, no timers — the effect cleanup stays undefined.
    // A detector module that never loaded can never fire, so arming its observer and timer
    // ladder would cost an observer and seven timers per unit for nothing.
    if (!armed.length) return undefined;

    let observer = null;
    let io = null;
    let scanTimer = null;
    let ladder = [];
    let timeoutTimer = null;
    let finished = false;
    const reported = {};

    const stop = () => {
      finished = true;
      if (observer) {
        try { observer.disconnect(); } catch (e) {}
        observer = null;
      }
      if (io) {
        try { io.disconnect(); } catch (e) {}
        io = null;
      }
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      ladder.forEach((timer) => clearTimeout(timer));
      ladder = [];
    };

    const ensureObserver = (el) => {
      if (observer || finished || !el) return;
      const MutationObs = window.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
      if (MutationObs) {
        try {
          observer = new MutationObs(schedule);
          observer.observe(el, { childList: true, subtree: true, characterData: true });
        } catch (e) {}
      }
    };

    const ensureIntersectionObserver = (el) => {
      if (io || finished || !el) return;
      const IntersectionObs = window.IntersectionObserver || (typeof IntersectionObserver !== 'undefined' ? IntersectionObserver : null);
      if (IntersectionObs) {
        try {
          io = new IntersectionObs((entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) schedule();
            }
          }, { rootMargin: '300px' });
          io.observe(el);
        } catch (e) {}
      }
    };

    /** Coalesced check: one pending scan no matter how many batches arrive in the window. */
    const schedule = () => {
      if (finished || scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        check();
      }, scanThrottleMs);
    };

    /** Reads the tray veto without running the suggestion heuristics. Null when unknown. */
    const readVeto = (el) => {
      try {
        const surface = window.FBDietDOMSurface;
        if (surface && typeof surface.trayVetoFor === 'function') return surface.trayVetoFor(el) || null;
      } catch (e) {}
      return null;
    };

    const check = () => {
      if (finished) return false;
      const el = containerRef.current;
      if (!el || el.isConnected === false) return false;
      const childCount = typeof el.childElementCount === 'number' ? el.childElementCount : 2;
      if (childCount <= 1 && !(el.textContent || '').trim()) return false;
      ensureObserver(el);
      ensureIntersectionObserver(el);
      // A vetoed unit can never be a suggestion: skip the sweep, but keep watching —
      // the surface and sponsorship slots may still answer.
      if (!vetoYes) {
        const vetoNow = readVeto(el);
        if (vetoNow) vetoYes = true;
      }
      let filled = false;
      for (const entry of armed) {
        if (reported[entry.slot]) continue;
        if (entry.slot === 'suggested' && vetoYes) continue;
        const detector = window[entry.detectorName];
        if (!detector || typeof detector.detect !== 'function') continue;
        let detected = null;
        try {
          detected = detector.detect(el);
        } catch (e) {
          detected = null;
        }
        if (detected && detected[entry.hitKey]) {
          reported[entry.slot] = true;
          try {
            onResult(entry.slot, detected);
          } catch (e) {}
          filled = true;
        }
      }
      return filled;
    };

    // The synchronous first pass. Slots it fills never cost a timer; the rest fall
    // through to the ladder below.
    check();
    const remaining = armed.some((entry) => !reported[entry.slot]);
    if (!remaining) {
      stop();
      return undefined;
    }

    // Fallback timer ladder for streaming Suspense. These check directly: the delays are
    // already spread out, and the first pass must not wait for a throttle window.
    ladder = scanDelays.map((delay) => {
      const timer = setTimeout(check, delay);
      // Defensive only: a Node Timeout object would keep an event loop alive, but the browser
      // returns a number and this repo's harness records timers without ever running them, so
      // the guard is a no-op in every environment the module is loaded in today.
      if (timer && typeof timer.unref === 'function') timer.unref();
      return timer;
    });

    timeoutTimer = setTimeout(stop, scanTimeoutMs);
    if (timeoutTimer && typeof timeoutTimer.unref === 'function') timeoutTimer.unref();

    // The effect cleanup is `stop` itself: stopping is idempotent and cancels everything.
    return stop;
  }

  return {
    setupDomObserver
  };
})();
