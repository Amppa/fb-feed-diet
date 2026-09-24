/**
 * FB Diet - React fold wrapper coordinator (MAIN world)
 *
 * Decorates Facebook feed units instead of deleting them:
 *   - nothing matched or the category is disabled -> the original element tree is returned untouched
 *   - matched -> a compact notice bar plus the original tree hidden with display:none / 1x1 squash
 *   - expanded by the user -> the original tree is returned with a neutral re-fold bar
 *
 * Public API (window.FBDietFold): FEED_UNIT_MODULES, HIDE_MODE, FBDietFold, install(), getStatus()
 * Group badges, fold bars and probe reports live in their own modules (window.FBDietUI /
 * window.FBDietProbe) and are always read from there.
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

  // Full Mode DOM suggestion fallback: retry ladder for streaming Suspense renders and the
  // hard timeout after which the MutationObserver is disconnected for good.
  const DOM_SUGGESTED_SCAN_DELAYS = [50, 200, 500, 1200, 2500];
  const DOM_SUGGESTED_SCAN_TIMEOUT_MS = 4000;

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
   * (STRATEGY.md decision #27). `showTitleMode` is the only source; FB_DIET_DEFAULTS owns
   * its normalization and an unknown/missing value falls back to 'whenFolded'. 'whenFolded'
   * shows the title while the post is folded (a summary of the hidden content) and hides it
   * once expanded, where the post itself is visible.
   */
  function resolveShowTitle(settings, expanded) {
    if (!settings || settings.dietMode === 'lite') return false;
    const defaults = window.FB_DIET_DEFAULTS;
    const mode = defaults && typeof defaults.normalizeTitleMode === 'function'
      ? defaults.normalizeTitleMode(settings.showTitleMode)
      : (settings.showTitleMode === 'always' || settings.showTitleMode === 'never' ? settings.showTitleMode : 'whenFolded');
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    return !expanded;
  }

  function createEl(type, props, children) {
    const ui = getUI();
    if (ui.createEl) return ui.createEl(type, props, children);
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
    const proxy = window.FBDietProxy;
    if (!React || !type) return null;
    return proxy.createElement(React, type, props, children);
  }

  function addProbe(element, props, classifyResult, relayReads) {
    const probe = getProbe();
    if (typeof probe.addProbe === 'function') {
      return probe.addProbe(element, props, classifyResult, relayReads);
    }
    return element;
  }

  /**
   * Full Mode only: watches a mounted unit for streaming DOM that reveals a suggested post
   * the Relay props could not classify (Comet renders posts while Suspense resolves them).
   * Returns the effect cleanup function, or undefined when the first synchronous check
   * already detected a suggestion and nothing had to be scheduled.
   */
  function setupDomSuggestedScanner(containerRef, onDetected) {
    let observer = null;

    const check = () => {
      const detector = window.FBDietDOMSuggested;
      const el = containerRef.current;
      if (detector && typeof detector.detect === 'function' && el) {
        const detected = detector.detect(el);
        if (detected && detected.isSuggested) {
          onDetected(detected);
          if (observer) {
            try { observer.disconnect(); } catch (e) {}
          }
          return true;
        }
      }
      return false;
    };

    if (check()) return undefined;

    const el = containerRef.current;
    const MutationObs = window.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    if (el && MutationObs) {
      try {
        observer = new MutationObs(() => {
          check();
        });
        observer.observe(el, { childList: true, subtree: true, characterData: true });
      } catch (e) {}
    }

    // Fallback timer ladder for streaming Suspense
    const timers = DOM_SUGGESTED_SCAN_DELAYS.map((d) => setTimeout(check, d));

    const cleanupTimer = setTimeout(() => {
      if (observer) {
        try { observer.disconnect(); } catch (e) {}
      }
    }, DOM_SUGGESTED_SCAN_TIMEOUT_MS);

    return () => {
      if (observer) {
        try { observer.disconnect(); } catch (e) {}
      }
      timers.forEach((t) => clearTimeout(t));
      clearTimeout(cleanupTimer);
    };
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

  /** Folded unit: notice bar plus the original tree squashed into 1x1 (never unmounted). */
  function renderFoldedView(React, FoldContext, bar, rendered, containerRef) {
    const hidden = createEl(
      'div',
      {
        ref: containerRef,
        className: 'fb-diet-fold-hidden fb-diet-foldsquash',
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
  function FBDietFold(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
    if (!React || !rendered) return rendered;

    // Fixed order: all hooks unconditionally executed
    const FoldContext = getFoldContext(React);
    const isNested = FoldContext && typeof React.useContext === 'function' ? React.useContext(FoldContext) : false;

    const [tick, setTick] = typeof React.useState === 'function' ? React.useState(0) : [0, function noop() {}];
    const [isHydrated, setIsHydrated] = typeof React.useState === 'function' ? React.useState(false) : [true, function noop() {}];
    const [domSuggested, setDomSuggested] = typeof React.useState === 'function' ? React.useState(null) : [null, function noop() {}];
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

        // Full Mode: Post-mount DOM Suggested check for unclassified units
        if (bridge && typeof bridge.getSettings === 'function') {
          const currentSettings = bridge.getSettings();
          if (currentSettings && currentSettings.dietMode === 'full' && !domSuggested) {
            return setupDomSuggestedScanner(containerRef, setDomSuggested);
          }
        }
      }, [isHydrated, domSuggested]);
    }

    if (isNested || !isHydrated) return rendered;

    try {
      if (!React || !rendered) return rendered;

      const bridge = window.FBDietBridge;
      if (!bridge) return rendered;

      const settings = bridge.getSettings();
      // If disabled or in DOM mode, let original render untouched
      if (!settings.enabled || settings.mode === 'dom') return rendered;

      // Fold scope (STRATEGY.md decision #26): outside the allowlisted surfaces skip
      // classification, counters, logs and fold bars entirely. Probe stays available
      // with a null classify result. Fail-open when defaults or the pathname are missing.
      if (settings.restrictFoldScope !== false) {
        const scopeDefaults = window.FB_DIET_DEFAULTS;
        const isScopeAllowed = scopeDefaults && typeof scopeDefaults.isFoldScopeAllowed === 'function'
          ? scopeDefaults.isFoldScopeAllowed
          : null;
        const pathname = window.location ? window.location.pathname : undefined;
        if (isScopeAllowed && !isScopeAllowed(pathname)) {
          return addProbe(rendered, props, null, null);
        }
      }

      let category = props.entryCategory || null;
      let reason = 'component:' + (props.moduleName || 'unknown');
      let unitId = null;
      let unitTypename = null;
      let classifyResult = null;
      let relayReads = null;

      if (!category) {
        const classify = window.FBDietClassify;
        if (!classify) return rendered;

        // The module name is part of the classification context: the Reels attachment
        // style wrapper, for example, must never fold as Reels (see STRATEGY.md).
        const result = classify.classifyFeedUnit(props.payload, { moduleName: props.moduleName || null, lastCmp: props.lastCmp });
        classifyResult = result;
        relayReads = typeof classify.getLastRelayReads === 'function' ? classify.getLastRelayReads() : null;
        category = result.category;
        reason = result.reason;
        unitId = result.unitId;
        unitTypename = result.unitTypename;
      }

      let effectiveClassifyResult = classifyResult;
      const isAlreadyClassified = category && category !== 'regular';
      if (!isAlreadyClassified && domSuggested && domSuggested.isSuggested) {
        category = 'suggested';
        reason = domSuggested.reason || 'dom:suggested';
        if (classifyResult) {
          effectiveClassifyResult = Object.assign({}, classifyResult, {
            category,
            reason,
            signal: domSuggested.signal || 'Other',
            domEvidence: domSuggested
          });
        }
      }

      if (!category) {
        if (settings.dietMode !== 'full') {
          if (typeof bridge.reportRegular === 'function') bridge.reportRegular(classifyResult);
          return addProbe(rendered, props, classifyResult, relayReads);
        }
        const wrapped = createEl('div', { ref: containerRef, className: 'fb-diet-full-container', style: { display: 'contents' } }, [rendered]);
        if (typeof bridge.reportRegular === 'function') bridge.reportRegular(classifyResult);
        return addProbe(wrapped || rendered, props, classifyResult, relayReads);
      }

      if (!unitId) {
        const mod = props.moduleName || 'unit';
        const type = (props.payload && props.payload.unitTypename) || 'ad';
        unitId = mod + '_' + type;
      }

      const defaultMode = bridge.getFoldMode ? bridge.getFoldMode(category) : (bridge.isEnabled(category) ? 'mini' : 'off');
      const isLite = settings.dietMode === 'lite';
      const activeStyle = isLite || settings.minimizedFoldMode ? 'mini' : 'title';
      const visual = bridge.getUnitVisualState
        ? bridge.getUnitVisualState(unitId, defaultMode)
        : { isFolded: defaultMode !== 'off', style: activeStyle };

      const isFolded = visual.isFolded;
      const foldStyle = activeStyle;

      // Report counters: any folded unit counts toward blocked/filtered
      if (isFolded) {
        bridge.reportBlocked({
          category,
          unitId,
          reason,
          unitTypename:
            unitTypename ||
            (props.payload && typeof props.payload.unitTypename === 'string' ? props.payload.unitTypename : null),
          moduleName: props.moduleName || null
        });
      } else if (category === 'regular') {
        if (typeof bridge.reportRegular === 'function') {
          bridge.reportRegular(effectiveClassifyResult || {
            category,
            unitId,
            reason,
            unitTypename:
              unitTypename ||
              (props.payload && typeof props.payload.unitTypename === 'string' ? props.payload.unitTypename : null),
            moduleName: props.moduleName || null
          });
        }
      } else {
        if (typeof bridge.reportAllowed === 'function') {
          bridge.reportAllowed({
            category,
            unitId,
            reason,
            unitTypename:
              unitTypename ||
              (props.payload && typeof props.payload.unitTypename === 'string' ? props.payload.unitTypename : null),
            moduleName: props.moduleName || null
          });
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
        if (settings.dietMode === 'full' && !domSuggested) {
          const wrapped = createEl('div', { ref: containerRef, className: 'fb-diet-full-container', style: { display: 'contents' } }, [rendered]);
          return addProbe(wrapped || rendered, props, effectiveClassifyResult, relayReads);
        }
        return addProbe(rendered, props, effectiveClassifyResult, relayReads);
      }

      const ui = getUI();
      const isMini = Boolean(settings.minimizedFoldMode);
      const showTitle = resolveShowTitle(settings, !isFolded);

      // Only collect metadata if showTitle is enabled to save work
      const enrichment = (showTitle && window.FBDietMetadata)
        ? window.FBDietMetadata.collect(effectiveClassifyResult, props)
        : null;

      const TitleBarComponent = ui.FBDietTitleBar;
      const bar = createEl(
        TitleBarComponent,
        {
          category,
          unitId,
          isExpanded: !isFolded,
          isMini,
          showTitle,
          enrichment,
          onToggle
        },
        []
      );

      if (!isFolded) {
        // Unfolded with top bar
        return addProbe(
          renderExpandedView(React, FoldContext, bar, rendered, containerRef),
          props,
          effectiveClassifyResult,
          relayReads
        );
      }

      // Folded: bar plus the 1x1 squashed original tree, or the untouched render when the
      // bar / squash container could not be created.
      const folded = renderFoldedView(React, FoldContext, bar, rendered, containerRef);
      if (!folded) return rendered;
      return addProbe(folded, props, effectiveClassifyResult, relayReads);
    } catch (e) {
      return rendered;
    }
  }

  function SideAdHidden(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
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
    if (!settings.enabled || settings.foldSponsored === false) return rendered;

    // Pure visual hide: independent of restrictFoldScope and never counted or logged
    // (STRATEGY.md decision #26). Empty hidden node, no placeholder, no unfold.
    return createEl('div', { className: 'adhidden fb-diet-side-ad-hidden', style: { display: 'none' } }, []);
  }

  function RightRailUnitWrapper(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
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

  function install() {
    try {
      const style = document.createElement('style');
      style.textContent = `
        .CometHomeRightRailUnit:has(.adhidden),
        .CometHomeRightRailUnit:has(.fb-diet-side-ad-hidden) {
          display: none !important;
        }
        .adhidden, .fb-diet-side-ad-hidden {
          display: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    } catch (e) {
      // Non-fatal
    }

    const proxy = window.FBDietProxy;
    if (!proxy || typeof proxy.registerComponent !== 'function') return false;

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
          return FBDietFold(Object.assign({ entryCategory: category, moduleName }, props));
        };
      }

      if (proxy.registerComponent(moduleName, { component: componentToRegister, definerPath })) {
        registered += 1;
      }
    }

    if (window.FBDietBridge) window.FBDietBridge.announceReady('fold-installed');
    return registered > 0;
  }

  install();

  return {
    FEED_UNIT_MODULES: withDefaultDefinerPath(),
    HIDE_MODE,
    FBDietFold,
    install,
    getStatus: () => ({
      hideMode: HIDE_MODE,
      modules: withDefaultDefinerPath(),
      hydration: hydrationStats,
      registered: window.FBDietProxy ? window.FBDietProxy.listRegistered() : null,
      settings: window.FBDietBridge ? window.FBDietBridge.getSettings() : null
    })
  };
})();
