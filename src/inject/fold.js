/**
 * FB Diet - React fold wrapper coordinator (MAIN world)
 *
 * Decorates Facebook feed units instead of deleting them:
 *   - nothing matched or the category is disabled -> the original element tree is returned untouched
 *   - matched -> a compact notice bar plus the original tree hidden with display:none / 1x1 squash
 *   - expanded by the user -> the original tree is returned with a neutral re-fold bar
 *
 * Public API (window.FBDietFold): install(), FBDietFold, GROUP_META, GROUP_BY_CATEGORY, groupOf, HIDE_MODE, getStatus()
 */
window.FBDietFold = (() => {
  'use strict';

  const FEED_UNIT_MODULES = [
    { name: 'CometFeedUnitErrorBoundary.react', category: null, definerPath: '[6].default' },
    { name: 'CometAdsSideFeedUnitItem.react', category: 'sponsored', definerPath: '[6].default' },
    { name: 'CometHomeRightRailUnit.react', category: 'sponsored', definerPath: '[6].default.render' },
    { name: 'FBReelsTopOfFeedTrayTile.react', category: 'reels', definerPath: '[6].default' },
    { name: 'FBReelsRootWrapper.react', category: 'reels', definerPath: '[6].default' },
    // A Story with a Reels attachment style is used for BOTH the Reels rail and a
    // friend's share of a reel. Routing it through the classifier keeps real reels
    // feed units foldable while friend shares stay visible.
    { name: 'CometFeedStoryFBReelsAttachmentStyle.react', category: null, definerPath: '[6].default' },
    { name: 'StoriesTrayRectangularRoot.react', category: 'stories', definerPath: '[6].default' },
    { name: 'StoriesTray.react', category: 'stories', definerPath: '[6].default' },
    { name: 'StoriesTrayRoot.react', category: 'stories', definerPath: '[6].default' },
    { name: 'CometStoriesTray.react', category: 'stories', definerPath: '[6].default' },
    { name: 'FriendingCometPYMKGrid.react', category: 'suggested', definerPath: '[6].default' },
    { name: 'FriendingCometFeedPYMKHScroll.react', category: 'suggested', definerPath: '[6].default' },
    { name: 'FriendingCometPYMKPanel.react', category: 'suggested', definerPath: '[6].default' },
    { name: 'CometMarketplaceAdCard.react', category: 'marketAds', definerPath: '[6].default' },
    { name: 'SearchCometResultsAd.react', category: 'searchingAds', definerPath: '[6].default' }
  ];

  const HIDE_MODE = 'squash';

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
        // The read log belongs to this unit's classification: capture it right
        // away so later renders cannot pollute the probe report.
        relayReads = typeof classify.getLastRelayReads === 'function' ? classify.getLastRelayReads() : null;
        if (!result.category) {
          if (typeof bridge.reportRegular === 'function') bridge.reportRegular(result);
          return addProbe(rendered, props, classifyResult, relayReads);
        }

        category = result.category;
        reason = result.reason;
        unitId = result.unitId;
        unitTypename = result.unitTypename;
      }

      if (!unitId) {
        const mod = props.moduleName || 'unit';
        const type = (props.payload && props.payload.unitTypename) || 'ad';
        unitId = mod + '_' + type;
      }

      const defaultMode = bridge.getFoldMode ? bridge.getFoldMode(category) : (bridge.isEnabled(category) ? 'mini' : 'off');
      const activeStyle = settings.minimizedFoldMode ? 'mini' : 'title';
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
          bridge.reportRegular(classifyResult || {
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
      const keepBar = settings.alwaysShowFoldBar !== undefined ? settings.alwaysShowFoldBar : (settings.alwaysShowFoldTitle !== false);
      if (!isFolded && !keepBar) {
        return addProbe(rendered, props, classifyResult, relayReads);
      }

      const ui = getUI();
      const isMini = Boolean(settings.minimizedFoldMode);
      const showTitle = settings.showFeedTitle !== undefined ? Boolean(settings.showFeedTitle) : true;

      // Only collect metadata if showTitle is enabled to save work
      const enrichment = (showTitle && window.FBDietMetadata)
        ? window.FBDietMetadata.collect(classifyResult, props)
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
        const expandedBody = createEl('div', { className: 'fb-diet-expand-body' }, [rendered]);
        const content = [bar, expandedBody];
        const Fragment = React.Fragment || null;
        const output = FoldContext && FoldContext.Provider
          ? createEl(FoldContext.Provider, { value: true }, content)
          : (Fragment ? createEl(Fragment, null, content) : content);
        return addProbe(output, props, classifyResult, relayReads);
      }

      // Folded
      const hidden = createEl(
        'div',
        {
          className: 'fb-diet-fold-hidden fb-diet-foldsquash',
          'aria-hidden': 'true'
        },
        [rendered]
      );
      if (!bar || !hidden) return rendered;

      const foldContent = [bar, hidden];
      const Fragment = React.Fragment || null;
      const output = FoldContext && FoldContext.Provider
        ? createEl(FoldContext.Provider, { value: true }, foldContent)
        : (Fragment ? createEl(Fragment, null, foldContent) : foldContent);
      return addProbe(output, props, classifyResult, relayReads);
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
      const definerPath = item.definerPath || '[6].default';

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
    FEED_UNIT_MODULES,
    get GROUP_META() { return (window.FBDietUI && window.FBDietUI.GROUP_META) || {}; },
    get GROUP_BY_CATEGORY() { return (window.FBDietUI && window.FBDietUI.GROUP_BY_CATEGORY) || {}; },
    get groupOf() { return (window.FBDietUI && window.FBDietUI.groupOf) || ((c) => c); },
    HIDE_MODE,
    FBDietFold,
    get FBDietBar() { return window.FBDietUI && window.FBDietUI.FBDietBar; },
    get FBDietTitleBar() { return window.FBDietUI && window.FBDietUI.FBDietTitleBar; },
    get buildUnitProbeReport() { return window.FBDietProbe && window.FBDietProbe.buildUnitProbeReport; },
    install,
    getStatus: () => ({
      hideMode: HIDE_MODE,
      modules: FEED_UNIT_MODULES,
      hydration: hydrationStats,
      registered: window.FBDietProxy ? window.FBDietProxy.listRegistered() : null,
      settings: window.FBDietBridge ? window.FBDietBridge.getSettings() : null
    })
  };
})();
