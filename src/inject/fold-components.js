/**
 * FB Diet - React fold components (MAIN world)
 *
 * Owns the three components the Comet hook registers - FoldUnit, SideAdHidden and
 * RightRailUnitWrapper - together with the element helpers and the fold-nesting React
 * context they share, and the hydration counters they report. Split out of fold.js;
 * this file decides nothing and registers nothing.
 *
 * Siblings it calls: fold-verdict.js (window.FBDietFoldVerdict) for the scope gate,
 * the title rule, the mode resolution, the verdict and the counter report, and
 * fold-observer.js (window.FBDietFoldObserver) for the shared DOM arm. Every read is
 * resolved at call time, so this file declares no load order.
 * Members are not prefixed with the module own name, so the module reads
 * window.FBDietFoldComponents.FoldUnit rather than
 * window.FBDietFoldComponents.FBDietFoldUnit.
 *
 * FBDietContext lives here and must stay here: FoldUnit reads it and
 * wrapWithFoldContext writes it. That is one React context object - moving either side
 * to another file would leave the provider and the reader holding two different contexts,
 * and the nesting guard would silently stop working.
 */
window.FBDietFoldComponents = (() => {
  'use strict';
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
   * Verdict delegation (fold.js split): the fold-scope gate, the title rule, the mode
   * resolution, the DOM staged pipeline and the counter report shape live in
   * fold-verdict.js (`window.FBDietFoldVerdict`). These wrappers keep the internal call
   * sites in one shape while the split is in flight. Every fallback degrades to "do
   * nothing" and copies no real rule: a missing verdict module must leave the unit
   * rendered untouched rather than classify it against a guessed mode or a guessed title.
   */
  function getVerdict() {
    return window.FBDietFoldVerdict || {};
  }

  function resolveShowTitle(settings, expanded) {
    const verdict = getVerdict();
    if (typeof verdict.resolveShowTitle !== 'function') return !expanded;
    return verdict.resolveShowTitle(settings, expanded);
  }

  function detectionMode(settings) {
    const verdict = getVerdict();
    if (typeof verdict.detectionMode !== 'function') return undefined;
    return verdict.detectionMode(settings);
  }

  function isFoldScopeBlocked(settings) {
    const verdict = getVerdict();
    if (typeof verdict.isFoldScopeBlocked !== 'function') return false;
    return verdict.isFoldScopeBlocked(settings);
  }

  function resolveVerdict(props, domSuggested, domSponsored, opts) {
    const verdict = getVerdict();
    if (typeof verdict.resolveVerdict !== 'function') return null;
    return verdict.resolveVerdict(props, domSuggested, domSponsored, opts);
  }

  function verdictReport(props, verdict) {
    const module = getVerdict();
    if (typeof module.verdictReport !== 'function') return null;
    return module.verdictReport(props, verdict);
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
   * Observer delegation (fold.js split): the shared three-slot DOM observer lives in
   * fold-observer.js (`window.FBDietFoldObserver`). A missing observer module answers
   * undefined, which is the effect's own "nothing was scheduled" contract, so the unit
   * simply keeps its render-time verdict instead of paying for an observer with no
   * schedule behind it.
   */
  function getObserver() {
    return window.FBDietFoldObserver || {};
  }

  function setupDomObserver(containerRef, options) {
    const observer = getObserver();
    if (typeof observer.setupDomObserver !== 'function') return undefined;
    return observer.setupDomObserver(containerRef, options);
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
    // Set when the relay verdict was undecided because the store was not captured yet.
    // The relay-ready broadcast clears it via a re-render; a plain boolean ref (not state)
    // so marking it never schedules a render by itself.
    const pendingStoreRef = (React && typeof React.useRef === 'function') ? React.useRef(false) : { current: false };

    if (typeof React.useEffect === 'function') {
      React.useEffect(() => {
        const refresh = () => setTick((value) => value + 1);
        window.addEventListener('fb-diet:settings-changed', refresh);
        return () => window.removeEventListener('fb-diet:settings-changed', refresh);
      }, []);
    }

    if (typeof React.useEffect === 'function') {
      React.useEffect(() => {
        const onRelayReady = () => {
          if (pendingStoreRef.current) {
            setTick((value) => value + 1);
          }
        };
        window.addEventListener('fb-diet:relay-ready', onRelayReady);
        return () => window.removeEventListener('fb-diet:relay-ready', onRelayReady);
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
            // A module-declared category is structural (this IS the tray / side ad), so the
            // surface and suggested slots can never change the verdict — only the
            // unconditional sponsorship override still can (decision #39). Arm the sponsored
            // slot alone instead of sweeping all three detectors per pass.
            const entryDeclared = Boolean(props.entryCategory);
            const skip = {
              suggested: entryDeclared || Boolean(domScan.suggested && domScan.suggested.isSuggested),
              sponsored: Boolean(domScan.sponsored && domScan.sponsored.isSponsored),
              surface: entryDeclared || Boolean(domScan.surface && domScan.surface.isSurface)
            };
            if (skip.suggested && skip.sponsored && skip.surface) return;
            return setupDomObserver(containerRef, {
              skip,
              // A decided surface IS a tray, so the veto is already proven without a walk.
              // A declared entry category is structural for the same reason.
              vetoYes: entryDeclared || Boolean(domScan.surface && domScan.surface.isSurface),
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
        //
        // Store-not-ready yet (vs genuinely unidentifiable): skip the regular report so the
        // relay-ready wake-up does not double-count regular-then-blocked, and mark the unit
        // pending so the broadcast re-renders it once the store lands.
        const relay = window.FBDietRelay;
        // No relay module (unit-test harness, partially loaded MAIN world): behave as before
        // and report regular — no wake-up will ever arrive, so pending would leak.
        const relayReady = !relay || typeof relay.isReady !== 'function' || relay.isReady();
        if (!relayReady) {
          pendingStoreRef.current = true;
          return addProbe(rendered, props, verdict, reads);
        }
        pendingStoreRef.current = false;
        if (typeof bridge.reportRegular === 'function') bridge.reportRegular(store || verdictReport(props, verdict));
        return addProbe(rendered, props, verdict, reads);
      }

      // A resolved relay verdict clears the pending flag: the wake-up has served its purpose
      // (or was never needed because the store was already captured).
      if (mode === 'relay') {
        pendingStoreRef.current = false;
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
      // Hover tooltip mode for the bar ('off' / 'native' / 'custom', default
      // 'custom'). Normalized here so TitleBar sees one vocabulary; an unknown
      // stored value falls back to the schema default.
      const defaults = window.FB_DIET_DEFAULTS;
      const tooltipMode = defaults && typeof defaults.normalizeTooltipMode === 'function'
        ? defaults.normalizeTooltipMode(settings.tooltipMode)
        : (settings.tooltipMode === 'off' || settings.tooltipMode === 'custom' ? settings.tooltipMode : 'native');
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
          tooltipMode,
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
  return {
    FoldUnit,
    SideAdHidden,
    RightRailUnitWrapper,
    // The live object, not a copy: getStatus().hydration reports what the components
    // have committed so far, so a snapshot would freeze it at the first read.
    get hydration() {
      return hydrationStats;
    }
  };
})();
