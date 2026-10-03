/**
 * React fold components: FoldUnit, SideAdHidden, RightRailUnitWrapper.
 * Reads fold-verdict.js / fold-observer.js at call time; FBDietContext stays here for nesting guard.
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

  /** Verdict delegation to fold-verdict.js; missing module degrades to do-nothing. */
  function getVerdict() {
    return window.FBDietFoldVerdict || {};
  }

  function shouldShowTitle(settings, expanded) {
    const verdict = getVerdict();
    if (typeof verdict.shouldShowTitle !== 'function') return !expanded;
    return verdict.shouldShowTitle(settings, expanded);
  }

  function resolveDetectionMode(settings) {
    const verdict = getVerdict();
    if (typeof verdict.resolveDetectionMode !== 'function') return undefined;
    return verdict.resolveDetectionMode(settings);
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

  function buildVerdictReport(props, verdict) {
    const module = getVerdict();
    if (typeof module.buildVerdictReport !== 'function') return null;
    return module.buildVerdictReport(props, verdict);
  }

  function createEl(type, props, children) {
    const ui = getUI();
    if (ui.createEl) return ui.createEl(type, props, children);
    const React = window.FBDietComet ? window.FBDietComet.getReact() : null;
    const comet = window.FBDietComet;
    if (!React || !type) return null;
    return comet.createElement(React, type, props, children);
  }

  function mountProbe(element, props, verdict, relayReads) {
    const probe = getProbe();
    const mount = probe.mountProbe || probe.addProbe;
    if (typeof mount === 'function') {
      return mount.call(probe, element, props, verdict, relayReads);
    }
    return element;
  }

  /** Observer delegation to fold-observer.js; missing answers undefined (nothing scheduled). */
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

  /** Folded: bar + 1x1 squashed tree (never unmounted) so IntersectionObserver stays visible. // per docs/architecture.md */
  /** __fbDietHideMode='none' swaps in display:none for memory comparison. */
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

  /** Replaces a matched feed unit. */
  function FoldUnit(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietComet ? window.FBDietComet.getReact() : null;
    if (!React || !rendered) return rendered;

    // Fixed order: all hooks unconditionally executed
    const FoldContext = getFoldContext(React);
    const isNested = FoldContext && typeof React.useContext === 'function' ? React.useContext(FoldContext) : false;

    const [tick, setTick] = typeof React.useState === 'function' ? React.useState(0) : [0, function noop() {}];
    const [isHydrated, setIsHydrated] = typeof React.useState === 'function' ? React.useState(false) : [true, function noop() {}];
    // Three DOM slots converge in one state; per-detector evidence kept for render/probe.
    const [domScan, setDomScan] = typeof React.useState === 'function' ? React.useState({ suggested: null, sponsored: null, surface: null }) : [{ suggested: null, sponsored: null, surface: null }, function noop() {}];
    const containerRef = (React && typeof React.useRef === 'function') ? React.useRef(null) : { current: null };
    // Pending store-not-ready flag: boolean ref cleared by relay-ready broadcast.
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

    // Merge one detector result; object-spread for test-harness setState shape.
    const mergeScan = (slot, detected) => {
      setDomScan(Object.assign({}, domScan, { [slot]: detected }));
    };

    if (typeof React.useEffect === 'function') {
      React.useEffect(() => {
        // Run after hydration commit (ref mounted); nested units never schedule work.
        if (!isHydrated || isNested) return;
        const bridge = window.FBDietBridge;
        if (bridge && typeof bridge.getSettings === 'function') {
          const currentSettings = bridge.getSettings();
          // 'dom' owns its engine: one observer re-arms for still-open slots. // per STRATEGY.md §1
          const mode = resolveDetectionMode(currentSettings);
          if (mode === 'dom') {
            // Stage-1 short-circuit: props-decided ad never needs an observer.
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
            // Declared category is structural; arm sponsored slot alone. // per STRATEGY.md §1.1
            const entryDeclared = Boolean(props.entryCategory);
            const skip = {
              suggested: entryDeclared || Boolean(domScan.suggested && domScan.suggested.isSuggested),
              sponsored: Boolean(domScan.sponsored && domScan.sponsored.isSponsored),
              surface: entryDeclared || Boolean(domScan.surface && domScan.surface.isSurface)
            };
            if (skip.suggested && skip.sponsored && skip.surface) return;
            return setupDomObserver(containerRef, {
              skip,
              // Decided surface / declared category already proves veto without a walk.
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
      if (!settings.enabled) return rendered;

      // Fold scope: outside allowlist skip everything; probe stays with null. // per docs/architecture.md
      if (isFoldScopeBlocked(settings)) {
        return mountProbe(rendered, props, null, null);
      }

      // Pipeline split: 'dom' skips data engine entirely, no Relay read. // per STRATEGY.md §1
      const mode = resolveDetectionMode(settings);
      const skipDataEngine = mode === 'dom';
      const verdict = resolveVerdict(props, domScan.suggested, domScan.sponsored, { skipDataEngine, domSurface: domScan.surface });
      if (!verdict) return rendered;

      const verdictCategory = verdict.category;
      const unitId = verdict.unitId;
      const store = verdict.store;
      const relayReads = verdict.reads;

      // Only DISPLAYED category substituted; verdict left alone (display-vs-verdict).
      const category = verdict.display.category;

      if (mode === 'relay' && !verdictCategory) {
        // No-unit-id in relay: render untouched, hand verdict to report.
        // Store-not-ready: skip report, mark pending for relay-ready re-render.
        const relay = window.FBDietRelay;
        // No relay module (tests): report regular, pending would leak with no wake-up.
        const relayReady = !relay || typeof relay.isReady !== 'function' || relay.isReady();
        if (!relayReady) {
          pendingStoreRef.current = true;
          return mountProbe(rendered, props, verdict, relayReads);
        }
        pendingStoreRef.current = false;
        if (typeof bridge.reportRegular === 'function') bridge.reportRegular(store || buildVerdictReport(props, verdict));
        return mountProbe(rendered, props, verdict, relayReads);
      }

      // Resolved relay verdict clears pending flag.
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
        bridge.reportBlocked(buildVerdictReport(props, verdict));
      } else if (category === 'regular') {
        if (typeof bridge.reportRegular === 'function') {
          bridge.reportRegular(store || buildVerdictReport(props, verdict));
        }
      } else {
        if (typeof bridge.reportAllowed === 'function') {
          bridge.reportAllowed(buildVerdictReport(props, verdict));
        }
      }

      const onToggle = () => {
        try {
          bridge.toggle(unitId);
          setTick(tick + 1);
        } catch (e) {
        }
      };

      const keepBar = settings.alwaysShowFoldBar !== false;
      if (!isFolded && !keepBar) {
        if (mode === 'dom' && !domScan.suggested) {
          const wrapped = createEl('div', { ref: containerRef, className: 'fb-diet-full-container', style: { display: 'contents' } }, [rendered]);
          return mountProbe(wrapped || rendered, props, verdict, relayReads);
        }
        return mountProbe(rendered, props, verdict, relayReads);
      }

      const ui = getUI();
      const isMini = Boolean(settings.minimizedFoldMode);
      const showTitle = shouldShowTitle(settings, !isFolded);
      // Tooltip mode normalized here for TitleBar.
      const defaults = window.FB_DIET_DEFAULTS;
      const tooltipMode = defaults && typeof defaults.normalizeTooltipMode === 'function'
        ? defaults.normalizeTooltipMode(settings.tooltipMode)
        : (settings.tooltipMode === 'off' || settings.tooltipMode === 'custom' ? settings.tooltipMode : 'native');
      // Relay keeps no-DOM-scan invariant; 'dom' allows title scan. // per docs/architecture.md
      const allowDomScan = mode === 'dom';

      // Enrichment only with store result (record ids); 'dom' reads DOM instead.
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
        return mountProbe(
          renderExpandedView(React, FoldContext, bar, rendered, containerRef),
          props,
          verdict,
          relayReads
        );
      }

      // Folded bar + squashed tree, else untouched render.
      const folded = renderFoldedView(React, FoldContext, bar, rendered, containerRef);
      if (!folded) return rendered;
      return mountProbe(folded, props, verdict, relayReads);
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

    // Pure visual hide, never counted/logged. // per docs/architecture.md
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
    // Live object: hydration reports committed counts so far.
    get hydration() {
      return hydrationStats;
    }
  };
})();
