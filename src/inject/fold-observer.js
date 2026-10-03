/**
 * FB Diet - shared DOM observation: three slots, one observer,
 * coalescing throttle, retry ladder, hard timeout, tray veto.
 * Naming: docs/conventions.md
 */
window.FBDietFoldObserver = (() => {
  'use strict';

  function getConfig() {
    return window.FBDietFoldConfig || {};
  }

  /** Three DOM slots in precedence order. // per STRATEGY.md §1.1 */
  const DOM_SCAN_SLOTS = [
    { slot: 'surface', detectorName: 'FBDietDOMSurface', hitKey: 'isSurface' },
    { slot: 'suggested', detectorName: 'FBDietDOMSuggested', hitKey: 'isSuggested' },
    { slot: 'sponsored', detectorName: 'FBDietDOMSponsored', hitKey: 'isSponsored' }
  ];

  /**
   * Watch streaming DOM `dom` mode missed (Suspense). Entries funnel via
   * `schedule`: one pass per throttle window. // per STRATEGY.md §1.2
   * Stopping is final: observers disconnected, timers cleared, `finished`
   * blocks re-arm (folded units stay mounted; must disconnect or leak).
   * One observer serves unfilled slots; answered slots silenced, caller re-arms narrower.
   */
  function setupDomObserver(containerRef, options) {
    const config = getConfig();
    const scanDelays = config.DOM_SCAN_DELAYS;
    const scanTimeoutMs = config.DOM_SCAN_TIMEOUT_MS;
    const scanThrottleMs = config.DOM_SCAN_THROTTLE_MS;

    // No tunings = no schedule; watch nothing rather than invent one.
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

    // Nothing to watch: no observer, no timers.
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

    // Sync first pass; unfilled slots fall through to the ladder.
    check();
    const remaining = armed.some((entry) => !reported[entry.slot]);
    if (!remaining) {
      stop();
      return undefined;
    }

    // Fallback ladder for streaming Suspense; checks run directly.
    ladder = scanDelays.map((delay) => {
      const timer = setTimeout(check, delay);
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
