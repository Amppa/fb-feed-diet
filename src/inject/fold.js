/**
 * FB Diet - React fold wrapper coordinator (MAIN world)
 *
 * Decorates Facebook feed units instead of deleting them:
 *   - nothing matched or the category is disabled -> the original element tree is returned untouched
 *   - matched -> a compact notice bar plus the original tree hidden with display:none / 1x1 squash
 *   - expanded by the user -> the original tree is returned with a neutral re-fold bar
 *
 * Public API (window.FBDietFold): FEED_UNIT_MODULES, HIDE_MODE, FoldUnit, install(),
 * checkModuleDrift(), getStatus()
 * Group badges, fold bars and probe reports live in their own modules (window.FBDietUI /
 * window.FBDietProbe) and are always read from there. Members are not prefixed with the
 * module's own name, so the module reads window.FBDietUI.TitleBar rather than
 * window.FBDietUI.FBDietTitleBar.
 */
window.FBDietFold = (() => {
  'use strict';

  const DEFAULT_DEFINER_PATH = '[6].default';
  const FEED_UNIT_MODULES = [
    { name: 'CometFeedUnitErrorBoundary.react', category: null },
    { name: 'CometAdsSideFeedUnitItem.react', category: 'sponsored' },
    { name: 'CometHomeRightRailUnit.react', category: 'sponsored', definerPath: '[6].default.render' },
    { name: 'FBReelsTopOfFeedTrayTile.react', category: 'reels' },
    { name: 'FBReelsRootWrapper.react', category: 'reels' },
    // A Story with a Reels attachment style is used for BOTH the Reels rail and a
    // friend's share of a reel. Routing it through the classifier keeps real reels
    // feed units foldable while friend shares stay visible.
    { name: 'CometFeedStoryFBReelsAttachmentStyle.react', category: null },
    { name: 'StoriesTrayRectangularRoot.react', category: 'stories' },
    { name: 'StoriesTray.react', category: 'stories' },
    { name: 'StoriesTrayRoot.react', category: 'stories' },
    { name: 'CometStoriesTray.react', category: 'stories' },
    { name: 'FriendingCometPYMKGrid.react', category: 'suggested' },
    { name: 'FriendingCometFeedPYMKHScroll.react', category: 'suggested' },
    { name: 'FriendingCometPYMKPanel.react', category: 'suggested' },
    { name: 'CometMarketplaceAdCard.react', category: 'marketAds' },
    { name: 'SearchCometResultsAd.react', category: 'searchingAds' }
  ];

  function withDefaultDefinerPath() {
    return FEED_UNIT_MODULES.map((item) => Object.assign({ definerPath: DEFAULT_DEFINER_PATH }, item));
  }

  const HIDE_MODE = 'squash';

  // DOM observation — armed in `dom` mode, the one that has a mounted-DOM engine
  // alike (STRATEGY.md decision #40): retry ladder for streaming Suspense renders, a throttle
  // that coalesces MutationObserver bursts, and the hard timeout after which the observer stops
  // for good. ONE set is shared by all three detectors (stage 3 of the DOM pipeline):
  // a busy post costs one detection pass per throttle window and one ladder per unit,
  // not one of each per detector.
  const DOM_SCAN_DELAYS = [50, 150, 400, 1000, 2500, 5000];
  const DOM_SCAN_TIMEOUT_MS = 15000;
  const DOM_SCAN_THROTTLE_MS = 200;

  // Module drift watchdog. FEED_UNIT_MODULES hard-codes Facebook's internal module
  // names; when Facebook renames them the Comet hook silently stops matching and folding
  // quietly dies. The hook counts loader activity (dCalls) and matched modules
  // (seen), so "loader streamed hundreds of modules + Relay data flows + scope
  // allowed + nothing matched" means drift. Warn once; never debug-gated (the
  // reference projects keep breakage detection always-on for exactly this reason).
  const DRIFT_MIN_DCALLS = 300;
  const DRIFT_CHECK_DELAYS = [15000, 45000];
  const driftState = { warned: false, hookWarned: false };

  const hydrationStats = {
    count: 0,
    byModule: {}
  };

  let FBDietContext = null;
  function getFoldContext(React) {
    if (!FBDietContext && React && typeof React.createContext === 'function') {
      try {
        FBDietContext = React.createContext(false);
      } catch (e) {
        FBDietContext = null;
      }
    }
    return FBDietContext;
  }

  function getUI() {
    return window.FBDietUI || {};
  }

  function getProbe() {
    return window.FBDietProbe || {};
  }

  /**
   * Resolves whether the fold bar renders its title text for the current state
   * (STRATEGY.md decisions #27 and #36). `showTitleMode` is the only source; FB_DIET_DEFAULTS owns
   * its normalization and an unknown/missing value falls back to 'whenFolded'. 'whenFolded'
   * shows the title while the post is folded (a summary of the hidden content) and hides it
   * once expanded, where the post itself is visible.
   */
  function resolveShowTitle(settings, expanded) {
    if (!settings) return false;
    const defaults = window.FB_DIET_DEFAULTS;
    const mode = defaults && typeof defaults.normalizeTitleMode === 'function'
      ? defaults.normalizeTitleMode(settings.showTitleMode)
      : (settings.showTitleMode === 'always' || settings.showTitleMode === 'never' ? settings.showTitleMode : 'whenFolded');
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    return !expanded;
  }

  /**
   * Resolves the detection mode from settings, folding a stored value that is no longer a
   * mode ('lite' / 'full' / 'relay+dom') onto its current name. The two strategies are named
   * for where their evidence comes from, not for page weight, and each runs one engine.
   */
  function detectionMode(settings) {
    const defaults = window.FB_DIET_DEFAULTS;
    // The fallback cannot fire under manifest load order (defaults.js is listed first), but it
    // must not collapse 'dom' into 'relay': that would re-enable the data engine this mode
    // exists to bypass and silently report a DOM verdict as a Relay one.
    if (defaults && typeof defaults.normalizeDetectionMode === 'function') {
      return defaults.normalizeDetectionMode(settings && settings.dietMode);
    }
    const raw = settings && settings.dietMode;
    return raw === 'relay' || raw === 'dom' ? raw : 'relay';
  }

  function createEl(type, props, children) {
    const ui = getUI();
    if (ui.createEl) return ui.createEl(type, props, children);
    const React = window.FBDietComet ? window.FBDietComet.getReact() : null;
    const comet = window.FBDietComet;
    if (!React || !type) return null;
    return comet.createElement(React, type, props, children);
  }

  function addProbe(element, props, verdict, reads) {
    const probe = getProbe();
    if (typeof probe.addProbe === 'function') {
      return probe.addProbe(element, props, verdict, reads);
    }
    return element;
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
      }, DOM_SCAN_THROTTLE_MS);
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
    ladder = DOM_SCAN_DELAYS.map((delay) => {
      const timer = setTimeout(check, delay);
      // Defensive only: a Node Timeout object would keep an event loop alive, but the browser
      // returns a number and this repo's harness records timers without ever running them, so
      // the guard is a no-op in every environment the module is loaded in today.
      if (timer && typeof timer.unref === 'function') timer.unref();
      return timer;
    });

    timeoutTimer = setTimeout(stop, DOM_SCAN_TIMEOUT_MS);
    if (timeoutTimer && typeof timeoutTimer.unref === 'function') timeoutTimer.unref();

    // The effect cleanup is `stop` itself: stopping is idempotent and cancels everything.
    return stop;
  }

  /** Wraps fold content in the nesting context so a nested unit never folds twice. */
  function wrapWithFoldContext(React, FoldContext, content) {
    if (FoldContext && FoldContext.Provider) {
      return createEl(FoldContext.Provider, { value: true }, content);
    }
    const Fragment = React.Fragment || null;
    return Fragment ? createEl(Fragment, null, content) : content;
  }

  /** Expanded unit: re-fold bar plus the always mounted original tree. */
  function renderExpandedView(React, FoldContext, bar, rendered, containerRef) {
    const expandedBody = createEl('div', { ref: containerRef, className: 'fb-diet-expand-body' }, [rendered]);
    return wrapWithFoldContext(React, FoldContext, [bar, expandedBody]);
  }

  /**
   * Folded unit: notice bar plus the original tree squashed into 1x1 (never unmounted).
   * The squash exists so IntersectionObserver still counts the unit as visible, which keeps
   * Facebook's own windowing from unmounting it (STRATEGY.md). Setting
   * `window.__fbDietHideMode = 'none'` from the page console swaps in a real display:none
   * hide, which lets media/DOM under folded posts be released for memory comparison.
   */
  function renderFoldedView(React, FoldContext, bar, rendered, containerRef) {
    const hideClass = (typeof window !== 'undefined' && window.__fbDietHideMode === 'none')
      ? 'fb-diet-fold-hidden'
      : 'fb-diet-fold-hidden fb-diet-foldsquash';
    const hidden = createEl(
      'div',
      {
        ref: containerRef,
        className: hideClass,
        'aria-hidden': 'true'
      },
      [rendered]
    );
    if (!bar || !hidden) return null;
    return wrapWithFoldContext(React, FoldContext, [bar, hidden]);
  }

  /**
   * Fold-scope gate (STRATEGY.md decision #26): outside the allowlisted surfaces the unit
   * keeps its native render and takes part in no counters, logs or fold bars. Fails open
   * when the defaults module or the pathname is unavailable.
   */
  function isFoldScopeBlocked(settings) {
    if (settings.restrictFoldScope === false) return false;
    const defaults = window.FB_DIET_DEFAULTS;
    const isAllowed = defaults && typeof defaults.isFoldScopeAllowed === 'function' ? defaults.isFoldScopeAllowed : null;
    if (!isAllowed) return false;
    const pathname = window.location ? window.location.pathname : undefined;
    return !isAllowed(pathname);
  }

  /**
   * One unit, one verdict. Returns null only when classification is impossible (no classifier
   * module), which the caller answers by leaving the render untouched.
   *
   * The two engines are mutually exclusive, so this is a linear scan in precedence order rather
   * than an arbitration between two opinions: whatever decides first ends the scan and the rest
   * never runs. Nothing here outranks another engine — `store` is the Relay classify result in
   * `relay` mode and null in `dom` mode, where no store is read at all.
   *
   * `opts.skipDataEngine` is `dom` mode (decision #40): the data engine is not merely out-voted,
   * it is never consulted, so the DOM detectors are the only authority. The free props the
   * classifier would have read first are the one exception, and only for sponsorship.
   *
   * `opts.domSurface` travels inside the options bag rather than beside the other two detectors
   * because it is DOM evidence that never applies in `relay` mode: that mode keeps deciding
   * reels / stories / suggestedGroup from the store, so it should not have to carry it.
   *
   * In `dom` mode the scan below is staged like the Relay pipeline (`classify()`): each stage
   * returns a partial verdict or null, and the convergence order is
   * `sponsored ?? surface ?? suggested`. Sponsorship is unconditional (decision #39); surface
   * precedes suggested because a tray tile satisfies every "looks like a cue" heuristic at
   * once (misclassification #8).
   */

  /**
   * DOM stage 1 — the free props ad. `dom` mode skips the STORE, not the props: a feed unit's
   * ad field is often a plain prop (`feedUnit.th_dat_spo`), so skipping the whole classifier
   * would throw away a signal that costs nothing and needs no store capture.
   * Sponsorship only — the one category where a false negative is expensive enough to pay
   * redundancy for. `adVerdictFromProps` consults no Relay reader, so the `dom` verdict never
   * depends on store capture.
   */
  function domStagePropsAd(props) {
    const classify = window.FBDietRelayClassify;
    if (!props.payload || !classify || typeof classify.adVerdictFromProps !== 'function') return null;
    const propsAd = classify.adVerdictFromProps(props.payload);
    if (!propsAd) return null;
    return { category: propsAd.category, reason: 'props:' + propsAd.reason, signal: null, source: 'props', propsEvidence: propsAd, domEvidence: null };
  }

  /**
   * DOM stage 2 — structural surface. "This IS a Reels tray" precedes the button heuristics
   * below (STRATEGY.md, misclassification 8).
   */
  function domStageSurface(domSurface) {
    if (!domSurface || !domSurface.isSurface || !domSurface.category) return null;
    return { category: domSurface.category, reason: domSurface.reason || 'dom:surface', signal: null, source: 'dom_surface', propsEvidence: null, domEvidence: domSurface };
  }

  /** DOM stage 3 — content cues (follow/join buttons, recommendation headers). */
  function domStageSuggested(domSuggested) {
    if (!domSuggested || !domSuggested.isSuggested) return null;
    return { category: 'suggested', reason: domSuggested.reason || 'dom:suggested', signal: domSuggested.signal || 'Other', source: 'dom_scanner', propsEvidence: null, domEvidence: domSuggested };
  }

  /**
   * DOM stage 4 — the rendered sponsorship label. Not gated on the category, unlike the
   * stages above: a label on screen is the strongest single piece of evidence on the page,
   * so a unit whose props looked like an ad, or whose buttons looked like a suggestion,
   * still folds as an ad when the byline says so (decision #39).
   */
  function domStageSponsoredOverride(domSponsored) {
    if (!domSponsored || !domSponsored.isSponsored) return null;
    return { category: 'sponsored', reason: domSponsored.reason || 'dom:sponsored', signal: domSponsored.signal || 'Sponsored', source: 'dom_sponsorship', propsEvidence: null, domEvidence: domSponsored };
  }
  function resolveVerdict(props, domSuggested, domSponsored, opts) {
    const skipDataEngine = Boolean(opts && opts.skipDataEngine);
    const domSurface = (opts && opts.domSurface) || null;
    let category = props.entryCategory || null;
    let reason = 'component:' + (props.moduleName || 'unknown');
    let source = category ? 'entry' : null;
    let signal = null;
    let unitId = null;
    let unitTypename = null;
    let store = null;
    let reads = null;
    let domEvidence = null;
    let propsEvidence = null;

    // A module-declared category is structural (this IS the Reels tray, this IS a side ad), not
    // a store read, so it applies in both modes.
    if (!category && !skipDataEngine) {
      const classify = window.FBDietRelayClassify;
      if (!classify) return null;

      // The module name is part of the classification context: the Reels attachment
      // style wrapper, for example, must never fold as Reels (see STRATEGY.md).
      const result = classify.classify(props.payload, { moduleName: props.moduleName || null, lastCmp: props.lastCmp });
      store = result;
      reads = typeof classify.getLastRelayReads === 'function' ? classify.getLastRelayReads() : null;
      category = result.category;
      reason = result.reason;
      signal = result.signal || null;
      unitId = result.unitId;
      unitTypename = result.unitTypename;
      source = 'relay';
    }

    // The whole block is gated on the mode rather than on what the store said. That is also what
    // stops a DOM hit carried across a live switch out of `dom` from being applied in `relay`,
    // where no DOM engine is mounted.
    //
    // Staged like the Relay pipeline: each stage returns a partial verdict or null, and the
    // first stages to answer win — except sponsorship, which overrides unconditionally.
    // Convergence: `sponsored ?? surface ?? suggested`.
    if (skipDataEngine) {
      source = 'dom';
      const applyStage = (stage) => {
        if (!stage) return;
        category = stage.category;
        reason = stage.reason;
        if (stage.signal !== null && stage.signal !== undefined) signal = stage.signal;
        source = stage.source;
        if (stage.propsEvidence !== undefined) propsEvidence = stage.propsEvidence;
        if (stage.domEvidence) domEvidence = stage.domEvidence;
      };
      if (!category) applyStage(domStagePropsAd(props));
      if (!category) applyStage(domStageSurface(domSurface));
      if (!category) applyStage(domStageSuggested(domSuggested));
      const sponsored = domStageSponsoredOverride(domSponsored);
      if (sponsored) {
        applyStage(sponsored);
        // The props signal did not decide this verdict, so it stops being reported as if it had.
        propsEvidence = null;
      }
      // An undecided unit here has no store result to carry a reason into the report. `source:
      // 'dom'` with a null category says the engine looked at the unit and fired nothing, which is
      // the fact the diagnostic mode exists to surface; the reason is the marker for readers who
      // only read that field. A non-detection carries no evidence, which is what says so.
      if (!category) {
        reason = 'dom:no-verdict';
      }
    }

    if (!unitId) {
      // The fallback key must identify ONE unit, because ui.js keys its titleBarCache by unitId.
      // The old shape (moduleName + typename) is constant across the whole feed, so in the
      // DOM-only pipeline — where no store id is ever read — every unit shared one key and the
      // second post's author and snippet were served to all of them. Prefer the post id that is
      // already sitting in the props, which needs no store read; feedPosition keeps two posts
      // apart when even that is missing.
      const payload = props.payload || {};
      const feedUnit = payload.feedUnit || {};
      const postId = feedUnit.post_id || feedUnit.clip_id || feedUnit.__id || null;
      const mod = props.moduleName || 'unit';
      const type = payload.unitTypename || 'ad';
      if (postId) {
        unitId = mod + '_' + postId;
      } else if (typeof payload.position === 'number') {
        unitId = mod + '_pos' + payload.position + '_' + type;
      } else {
        unitId = mod + '_' + type;
      }
    }

    return {
      category,
      reason,
      signal,
      unitId,
      unitTypename,
      moduleName: props.moduleName || null,
      // What produced the category, named explicitly and in one place — including when that answer
      // was "nothing": 'entry' (structural, declared by the module), 'relay' (the store), 'dom'
      // (the DOM engine examined the unit and fired nothing), 'props', 'dom_surface', 'dom_scanner',
      // 'dom_sponsorship'. Consumers read this instead of inferring provenance from a reason-string
      // prefix, which is the mistake that made a DOM-driven ad report as a store verdict once.
      source,
      // The Relay classify result, or null in `dom` mode. Nothing is manufactured to fill it: a
      // consumer that needs store data has to cope with there being none, which is the point.
      store,
      // The store evidence, and the only thing `FBDietRelayMetadata.collect` derives record ids
      // from. Null in `dom` mode is what stops that collector issuing a store read with a key that
      // was never a record id.
      evidence: store ? store.evidence : null,
      reads,
      // What decided, when a DOM or props capability did. The two are kept apart so nothing has to
      // read provenance off the `dom:` / `props:` reason prefix.
      domEvidence,
      propsEvidence,
      // What the mounted UI shows, kept apart from the verdict itself: an undecided unit displays as
      // `regular` because that is the group it counts towards, and the two must never be confused.
      display: { category: category || 'regular', substituted: !category }
    };
  }

  /** Counter report shape. The same payload is reported as blocked, allowed or regular. */
  function verdictReport(props, verdict) {
    return {
      category: verdict.category,
      unitId: verdict.unitId,
      reason: verdict.reason,
      unitTypename: verdict.unitTypename || (props.payload && typeof props.payload.unitTypename === 'string' ? props.payload.unitTypename : null),
      moduleName: props.moduleName || null
    };
  }

  /**
   * The component that replaces a matched feed unit.
   */
  function FoldUnit(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietComet ? window.FBDietComet.getReact() : null;
    if (!React || !rendered) return rendered;

    // Fixed order: all hooks unconditionally executed
    const FoldContext = getFoldContext(React);
    const isNested = FoldContext && typeof React.useContext === 'function' ? React.useContext(FoldContext) : false;

    const [tick, setTick] = typeof React.useState === 'function' ? React.useState(0) : [0, function noop() {}];
    const [isHydrated, setIsHydrated] = typeof React.useState === 'function' ? React.useState(false) : [true, function noop() {}];
    // The three DOM detection slots converge in one state: a hit in one slot must never
    // disturb the others, and the effect below re-arms only for the slots still open.
    // Kept as slots (not a single verdict) because the render path and the probe each need
    // the per-detector evidence shapes, not just the winning category.
    const [domScan, setDomScan] = typeof React.useState === 'function' ? React.useState({ suggested: null, sponsored: null, surface: null }) : [{ suggested: null, sponsored: null, surface: null }, function noop() {}];
    const containerRef = (React && typeof React.useRef === 'function') ? React.useRef(null) : { current: null };

    if (typeof React.useEffect === 'function') {
      React.useEffect(() => {
        const refresh = () => setTick((value) => value + 1);
        window.addEventListener('fb-diet:settings-changed', refresh);
        return () => window.removeEventListener('fb-diet:settings-changed', refresh);
      }, []);
    }

    const useSafeLayoutEffect = React.useLayoutEffect || React.useEffect;
    if (typeof useSafeLayoutEffect === 'function') {
      useSafeLayoutEffect(() => {
        setIsHydrated(true);
        const mod = props.moduleName || 'unit';
        hydrationStats.count += 1;
        hydrationStats.byModule[mod] = (hydrationStats.byModule[mod] || 0) + 1;
        const bridge = window.FBDietBridge;
        if (bridge && bridge.isDebugEnabled && bridge.isDebugEnabled()) {
          console.info('[FB Diet][Hydration] #' + hydrationStats.count + ' committed:', mod);
        }
      }, []);
    }

    // Merges one detector result into the converged scan state. Object-spread (not a
    // functional update) because the unit-test harness stores setState values as-is.
    const mergeScan = (slot, detected) => {
      setDomScan(Object.assign({}, domScan, { [slot]: detected }));
    };

    if (typeof React.useEffect === 'function') {
      React.useEffect(() => {
        // isHydrated is a dependency on purpose: this effect has to run *after* the hydration
        // commit, because that is the commit which mounts the wrapper carrying containerRef
        // (during the SSR-shaped pass the unit returns its original tree and the ref stays
        // null, so an observer set up earlier would attach to nothing).
        // isNested never changes; it only keeps nested units from scheduling work for a
        // container that is never attached.
        if (!isHydrated || isNested) return;
        const bridge = window.FBDietBridge;
        if (bridge && typeof bridge.getSettings === 'function') {
          const currentSettings = bridge.getSettings();
          // 'dom' is the sole authority of its mounted-DOM engine (STRATEGY.md decision #40):
          // a mode that mounted none of the detectors would be blind. One shared observer
          // watches whatever slots are still open; each fill re-runs this effect, which
          // tears the old observer down and re-arms for the narrower remainder.
          const mode = detectionMode(currentSettings);
          if (mode === 'dom') {
            // Stage-1 short-circuit: a props-decided ad can never be outranked by anything
            // the DOM could say, so mounting an observer for it would cost an observer and
            // seven timers per unit for nothing.
            if (!props.entryCategory && props.payload) {
              const classify = window.FBDietRelayClassify;
              if (classify && typeof classify.adVerdictFromProps === 'function') {
                let propsAd = null;
                try {
                  propsAd = classify.adVerdictFromProps(props.payload);
                } catch (e) {
                  propsAd = null;
                }
                if (propsAd) return;
              }
            }
            // A decided sponsorship is likewise unbeatable from this side.
            if (domScan.sponsored && domScan.sponsored.isSponsored) return;
            const skip = {
              suggested: Boolean(domScan.suggested && domScan.suggested.isSuggested),
              sponsored: Boolean(domScan.sponsored && domScan.sponsored.isSponsored),
              surface: Boolean(domScan.surface && domScan.surface.isSurface)
            };
            if (skip.suggested && skip.sponsored && skip.surface) return;
            return setupDomObserver(containerRef, {
              skip,
              // A decided surface IS a tray, so the veto is already proven without a walk.
              vetoYes: Boolean(domScan.surface && domScan.surface.isSurface),
              onResult: (slot, detected) => {
                mergeScan(slot, detected);
              }
            });
          }
        }
      }, [isHydrated, isNested, domScan]);
    }

    if (isNested || !isHydrated) return rendered;

    try {
      if (!React || !rendered) return rendered;

      const bridge = window.FBDietBridge;
      if (!bridge) return rendered;

      const settings = bridge.getSettings();
      // If disabled, let original render untouched
      if (!settings.enabled) return rendered;

      // Fold scope (STRATEGY.md decision #26): outside the allowlisted surfaces skip
      // classification, counters, logs and fold bars entirely. Probe stays available
      // with a null classify result.
      if (isFoldScopeBlocked(settings)) {
        return addProbe(rendered, props, null, null);
      }

      // The pipeline split lives here and nowhere else (decision #40). 'dom' skips the data
      // engine entirely: the store classifier is never called for the unit, so there is no Relay
      // read, no store-id requirement and no dependence on the classifier answering 'regular'.
      const mode = detectionMode(settings);
      const skipDataEngine = mode === 'dom';
      const verdict = resolveVerdict(props, domScan.suggested, domScan.sponsored, { skipDataEngine, domSurface: domScan.surface });
      if (!verdict) return rendered;

      const verdictCategory = verdict.category;
      const unitId = verdict.unitId;
      const store = verdict.store;
      const reads = verdict.reads;

      // Only the DISPLAYED category is substituted, and the verdict itself is left alone: an
      // undecided unit shows as `regular` because that is the group it counts towards, while
      // `category: null` with `source: 'dom'` is what the report has to say instead — "the engine
      // looked and found nothing" and "this is a regular post" are different facts.
      const category = verdict.display.category;

      if (mode === 'relay' && !verdictCategory) {
        // The store could not identify this unit at all (`no-unit-id`), so there is no category to
        // display, no fold bar to show and nothing the counters could file. Render it untouched and
        // hand the verdict to the report, which is where "we could not classify this" belongs.
        //
        // `dom` mode is not here: an undecided unit there displays as `regular` (it has to be
        // counted against something) and renders the ordinary regular bar, so the diagnostic mode
        // can see a unit its engine looked at and did not fold.
        if (typeof bridge.reportRegular === 'function') bridge.reportRegular(store || verdictReport(props, verdict));
        return addProbe(rendered, props, verdict, reads);
      }

      const defaultMode = bridge.getFoldMode ? bridge.getFoldMode(category) : (bridge.isEnabled(category) ? 'mini' : 'off');
      const visual = bridge.getUnitVisualState
        ? bridge.getUnitVisualState(unitId, defaultMode)
        : { isFolded: defaultMode !== 'off' };

      const isFolded = visual.isFolded;

      // Report counters: any folded unit counts toward blocked/filtered
      if (isFolded) {
        bridge.reportBlocked(verdictReport(props, verdict));
      } else if (category === 'regular') {
        if (typeof bridge.reportRegular === 'function') {
          bridge.reportRegular(store || verdictReport(props, verdict));
        }
      } else {
        if (typeof bridge.reportAllowed === 'function') {
          bridge.reportAllowed(verdictReport(props, verdict));
        }
      }

      const onToggle = () => {
        try {
          bridge.toggle(unitId);
          setTick(tick + 1);
        } catch (e) {
          // Ignore
        }
      };

      // When unfolded and alwaysShowFoldBar is disabled, return native render cleanly without any bar
      const keepBar = settings.alwaysShowFoldBar !== false;
      if (!isFolded && !keepBar) {
        if (mode === 'dom' && !domScan.suggested) {
          const wrapped = createEl('div', { ref: containerRef, className: 'fb-diet-full-container', style: { display: 'contents' } }, [rendered]);
          return addProbe(wrapped || rendered, props, verdict, reads);
        }
        return addProbe(rendered, props, verdict, reads);
      }

      const ui = getUI();
      const isMini = Boolean(settings.minimizedFoldMode);
      const showTitle = resolveShowTitle(settings, !isFolded);
      // The relay mode keeps its no-DOM-scan invariant (STRATEGY.md decision #36): the bar
      // renders Relay-sourced title text only, so the title bar skips its subtree scanner.
      // 'dom' allows it — there it is the only title source there is.
      const allowDomScan = mode === 'dom';

      // Only collect metadata if showTitle is enabled to save work, and only where a store result
      // exists: `FBDietRelayMetadata.collect` derives the record ids it reads from that result, so
      // handing it a `dom`-mode verdict would either do nothing or reach the store with a key that
      // was never a record id. In `dom` mode the title bar reads the DOM instead.
      const enrichment = (showTitle && store && window.FBDietRelayMetadata)
        ? window.FBDietRelayMetadata.collect(store, props)
        : null;

      const TitleBarComponent = ui.TitleBar;
      const bar = createEl(
        TitleBarComponent,
        {
          category,
          unitId,
          isExpanded: !isFolded,
          isMini,
          showTitle,
          allowDomScan,
          enrichment,
          onToggle,
          onSuggestedDetected: !domScan.suggested ? (detected) => mergeScan('suggested', detected) : null
        },
        []
      );

      if (!isFolded) {
        // Unfolded with top bar
        return addProbe(
          renderExpandedView(React, FoldContext, bar, rendered, containerRef),
          props,
          verdict,
          reads
        );
      }

      // Folded: bar plus the 1x1 squashed original tree, or the untouched render when the
      // bar / squash container could not be created.
      const folded = renderFoldedView(React, FoldContext, bar, rendered, containerRef);
      if (!folded) return rendered;
      return addProbe(folded, props, verdict, reads);
    } catch (e) {
      return rendered;
    }
  }

  function SideAdHidden(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietComet ? window.FBDietComet.getReact() : null;
    if (!React || !rendered) return rendered;

    const [isHydrated, setIsHydrated] = typeof React.useState === 'function' ? React.useState(false) : [true, function noop() {}];
    const useSafeLayoutEffect = React.useLayoutEffect || React.useEffect;
    if (typeof useSafeLayoutEffect === 'function') {
      useSafeLayoutEffect(() => {
        setIsHydrated(true);
        hydrationStats.count += 1;
        hydrationStats.byModule['SideAdHidden'] = (hydrationStats.byModule['SideAdHidden'] || 0) + 1;
      }, []);
    }

    if (!isHydrated) return rendered;

    const bridge = window.FBDietBridge;
    if (!bridge) return rendered;

    const settings = bridge.getSettings();
    if (!settings.enabled || settings.foldAds === false) return rendered;

    // Pure visual hide: independent of restrictFoldScope and never counted or logged
    // (STRATEGY.md decision #26). Empty hidden node, no placeholder, no unfold.
    return createEl('div', { className: 'adhidden fb-diet-side-ad-hidden', style: { display: 'none' } }, []);
  }

  function RightRailUnitWrapper(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietComet ? window.FBDietComet.getReact() : null;
    if (!React || !rendered) return rendered;

    const [isHydrated, setIsHydrated] = typeof React.useState === 'function' ? React.useState(false) : [true, function noop() {}];
    const useSafeLayoutEffect = React.useLayoutEffect || React.useEffect;
    if (typeof useSafeLayoutEffect === 'function') {
      useSafeLayoutEffect(() => {
        setIsHydrated(true);
        hydrationStats.count += 1;
        hydrationStats.byModule['RightRailUnitWrapper'] = (hydrationStats.byModule['RightRailUnitWrapper'] || 0) + 1;
      }, []);
    }

    if (!isHydrated) return rendered;

    return createEl('div', { className: 'CometHomeRightRailUnit' }, [rendered]);
  }

  /**
   * Session-level drift verdict built from the Comet hook's loader counters, the Relay
   * capture state and the fold scope. `seen === 0` while the loader is streaming
   * means no registered module name matched anymore.
   */
  function computeModuleDrift() {
    const comet = window.FBDietComet;
    const health = comet && typeof comet.getModuleHealth === 'function' ? comet.getModuleHealth() : null;
    const relay = window.FBDietRelay;
    const relayReady = Boolean(relay && typeof relay.isReady === 'function' && relay.isReady());

    let scopeAllowed = true;
    try {
      const defaults = window.FB_DIET_DEFAULTS;
      if (defaults && typeof defaults.isFoldScopeAllowed === 'function') {
        scopeAllowed = defaults.isFoldScopeAllowed(window.location ? window.location.pathname : undefined);
      }
    } catch (e) {}

    const report = {
      suspected: false,
      dCalls: health ? health.dCalls : 0,
      hookActive: health ? health.hookActive === true : false,
      registered: health ? health.registered : 0,
      seen: health ? health.seen : 0,
      patched: health ? health.patched : 0,
      hydration: hydrationStats.count,
      relayReady,
      scopeAllowed
    };

    report.suspected = Boolean(
      health &&
      health.dCalls >= DRIFT_MIN_DCALLS &&
      health.seen === 0 &&
      relayReady &&
      scopeAllowed
    );
    return report;
  }

  function isMasterEnabled() {
    try {
      const bridge = window.FBDietBridge;
      if (!bridge || typeof bridge.getSettings !== 'function') return true;
      const settings = bridge.getSettings();
      return !settings || settings.enabled !== false;
    } catch (e) {
      return true;
    }
  }

  /**
   * Without the hook the loader counters never move, so `suspected` can never become true and
   * a hook-less page would look perfectly healthy. This branch is the only verdict that covers
   * it, and it must never be phrased as a module rename: a disabled extension is dormant by
   * design, not stale.
   */
  function checkModuleDrift() {
    const report = computeModuleDrift();

    if (!report.hookActive) {
      if (!driftState.hookWarned && isMasterEnabled()) {
        driftState.hookWarned = true;
        try {
          console.warn(
            '[FB Diet][Drift] The __d hook is not installed on this page load, so folding is ' +
            'inactive (dormant, not stale). Reload the page to arm it.',
            report
          );
        } catch (e) {}
      }
      return report;
    }

    if (report.suspected && !driftState.warned) {
      driftState.warned = true;
      try {
        console.warn(
          '[FB Diet][Drift] No feed unit module matched after ' + report.dCalls +
          ' module definitions (Relay active, scope allowed). FEED_UNIT_MODULES looks stale and folding may be inactive.',
          report
        );
      } catch (e) {}
    }
    return report;
  }

  function scheduleDriftChecks() {
    const schedule = (typeof window !== 'undefined' && typeof window.setTimeout === 'function')
      ? window.setTimeout
      : (typeof setTimeout === 'function' ? setTimeout : null);
    if (!schedule) return;
    for (const delay of DRIFT_CHECK_DELAYS) {
      try { schedule(checkModuleDrift, delay); } catch (e) {}
    }
  }

  const RIGHT_RAIL_STYLE_ID = 'fb-diet-right-rail-style';
  const RIGHT_RAIL_PREHIDE_CSS = `
    /* Pre-hydration first-frame right rail ad suppression (SSR markup) */
    :is(div[role="complementary"], aside, [data-pagelet*="RightRail"]) :is(
      a[attributionsrc],
      a[target^="rhcad"],
      a[href*="fbclid="],
      a[href*="/l.php"]
    ),
    a[target^="rhcad"],
    :is(div[role="complementary"], aside, [data-pagelet*="RightRail"]) :is(div, li):has(> :is(
      a[attributionsrc],
      a[target^="rhcad"],
      a[href*="fbclid="],
      a[href*="/l.php"]
    )),
    .CometHomeRightRailUnit:has(.adhidden, .fb-diet-side-ad-hidden),
    .adhidden,
    .fb-diet-side-ad-hidden {
      display: none !important;
    }
  `;

  function syncRightRailStyle(doc) {
    try {
      const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
      if (!targetDoc || typeof targetDoc.createElement !== 'function') return false;

      const bridge = window.FBDietBridge;
      const settings = bridge && typeof bridge.getSettings === 'function' ? bridge.getSettings() : null;
      const shouldHide = !settings || (settings.enabled !== false && settings.foldAds !== false);

      let style = targetDoc.getElementById ? targetDoc.getElementById(RIGHT_RAIL_STYLE_ID) : null;
      if (!shouldHide) {
        if (style && style.parentNode) {
          style.parentNode.removeChild(style);
        }
        return false;
      }

      if (!style) {
        style = targetDoc.createElement('style');
        style.id = RIGHT_RAIL_STYLE_ID;
        style.textContent = RIGHT_RAIL_PREHIDE_CSS;
        (targetDoc.head || targetDoc.documentElement).appendChild(style);
      }
      return true;
    } catch (e) {
      // Non-fatal
      return false;
    }
  }

  function install(doc) {
    syncRightRailStyle(doc);

    const comet = window.FBDietComet;
    if (!comet || typeof comet.registerComponent !== 'function') return false;

    let registered = 0;
    for (const item of FEED_UNIT_MODULES) {
      const moduleName = item.name;
      const category = item.category;
      const definerPath = item.definerPath || DEFAULT_DEFINER_PATH;

      let componentToRegister;
      if (moduleName === 'CometAdsSideFeedUnitItem.react') {
        componentToRegister = SideAdHidden;
      } else if (moduleName === 'CometHomeRightRailUnit.react') {
        componentToRegister = RightRailUnitWrapper;
      } else {
        componentToRegister = function SpecificFold(props) {
          return FoldUnit(Object.assign({ entryCategory: category, moduleName }, props));
        };
      }

      if (comet.registerComponent(moduleName, { component: componentToRegister, definerPath })) {
        registered += 1;
      }
    }

    if (window.FBDietBridge) window.FBDietBridge.announceReady('fold-installed');
    return registered > 0;
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('fb-diet:settings-changed', () => {
      syncRightRailStyle();
    });
  }

  install();
  scheduleDriftChecks();

  return {
    FEED_UNIT_MODULES: withDefaultDefinerPath(),
    HIDE_MODE,
    FoldUnit,
    // Pure: takes the props and both DOM verdicts, returns the reconciled one. Exported so the
    // DOM-override rule can be tested without mounting a feed unit (STRATEGY.md decision #39).
    resolveVerdict,
    install,
    syncRightRailStyle,
    checkModuleDrift,
    getStatus: () => ({
      hideMode: HIDE_MODE,
      modules: withDefaultDefinerPath(),
      hydration: hydrationStats,
      drift: computeModuleDrift(),
      registered: window.FBDietComet ? window.FBDietComet.listRegistered() : null,
      settings: window.FBDietBridge ? window.FBDietBridge.getSettings() : null
    })
  };
})();
