/**
 * FB Diet - React fold wrapper (MAIN world)
 *
 * Decorates Facebook feed units instead of deleting them:
 *   - nothing matched or the category is disabled -> the original element tree is returned untouched
 *   - matched -> a compact notice bar plus the original tree hidden
 *     with display:none / 1x1 squash
 *   - expanded by the user -> the original tree is returned with a neutral re-fold bar
 *
 * Public API (window.FBDietFold): install(), FBDietFold, CATEGORY_META, HIDE_MODE, getStatus()
 */
window.FBDietFold = (() => {
  'use strict';

  const FEED_UNIT_MODULES = [
    { name: 'CometFeedUnitErrorBoundary.react', category: null, definerPath: '[6].default' },
    { name: 'CometAdsSideFeedUnitItem.react', category: 'sponsored', definerPath: '[6].default' },
    { name: 'CometHomeRightRailUnit.react', category: 'sponsored', definerPath: '[6].default.render' },
    { name: 'FBReelsTopOfFeedTrayTile.react', category: 'reels', definerPath: '[6].default' },
    { name: 'FBReelsRootWrapper.react', category: 'reels', definerPath: '[6].default' },
    { name: 'CometFeedStoryFBReelsAttachmentStyle.react', category: 'reels', definerPath: '[6].default' },
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

  const CATEGORY_META = {
    sponsored: {
      badgeClass: 'fb-diet-badge-sponsored',
      badgeText: 'Sponsored'
    },
    suggested: {
      badgeClass: 'fb-diet-badge-suggested',
      badgeText: 'Suggested post'
    },
    suggestedGroup: {
      badgeClass: 'fb-diet-badge-group',
      badgeText: 'Suggested group'
    },
    reels: {
      badgeClass: 'fb-diet-badge-reels',
      badgeText: 'Reels'
    },
    stories: {
      badgeClass: 'fb-diet-badge-stories',
      badgeText: 'Stories'
    },
    marketAds: {
      badgeClass: 'fb-diet-badge-market',
      badgeText: 'Market ad'
    },
    searchingAds: {
      badgeClass: 'fb-diet-badge-search',
      badgeText: 'Search ad'
    }
  };

  function createEl(type, props, children) {
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
    const proxy = window.FBDietProxy;
    if (!React || !type) return null;
    return proxy.createElement(React, type, props, children);
  }

  /**
   * The collapsed notice bar (entire strip is clickable).
   */
  function FBDietBar(props) {
    const meta = CATEGORY_META[props.category] || CATEGORY_META.sponsored;

    const left = createEl('div', { className: 'fb-diet-placeholder-left' }, [
      createEl('span', { className: 'fb-diet-badge ' + meta.badgeClass }, [meta.badgeText])
    ]);

    const symbol = createEl('span', { className: 'fb-diet-toggle-symbol' }, ['[+]']);

    return createEl(
      'div',
      {
        className: 'fb-diet-placeholder',
        title: 'Show post',
        onClick: props.onToggle
      },
      [left, symbol]
    );
  }

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

  /**
   * The component that replaces a matched feed unit.
   */
  function FBDietFold(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;

    // Anti-nesting suppression: if this unit is already rendered inside an outer FB Diet fold wrapper,
    // render it untouched to prevent duplicate stacked fold / re-fold bars (e.g. group suggestion carousels).
    const FoldContext = getFoldContext(React);
    const isNested = FoldContext && typeof React.useContext === 'function' ? React.useContext(FoldContext) : false;
    if (isNested) return rendered;

    const [tick, setTick] = React && typeof React.useState === 'function' ? React.useState(0) : [0, function noop() {}];

    if (React && typeof React.useEffect === 'function') {
      React.useEffect(() => {
        const refresh = () => setTick((value) => value + 1);
        window.addEventListener('fb-diet:settings-changed', refresh);
        return () => window.removeEventListener('fb-diet:settings-changed', refresh);
      }, []);
    }

    try {
      if (!React || !rendered) return rendered;

      const bridge = window.FBDietBridge;
      if (!bridge) return rendered;

      const settings = bridge.getSettings();
      // If disabled or in DOM mode, let original render untouched
      if (!settings.enabled || settings.mode === 'dom') return rendered;

      let category = props.entryCategory || null;
      let reason = 'component:' + (props.moduleName || 'unknown');
      let unitId = null;

      if (!category) {
        const classify = window.FBDietClassify;
        if (!classify) return rendered;

        const result = classify.classifyFeedUnit(props.payload);
        if (!result.category) {
          bridge.reportUnknown(result);
          return rendered;
        }

        category = result.category;
        reason = result.reason;
        unitId = result.unitId;
      }

      if (!bridge.isEnabled(category)) return rendered;

      if (!unitId) {
        const mod = props.moduleName || 'unit';
        const type = (props.payload && props.payload.unitTypename) || 'ad';
        unitId = mod + '_' + type;
      }

      bridge.reportBlocked({ category, unitId, reason });

      const isExpanded = bridge.isExpanded(unitId);

      const onToggle = () => {
        try {
          bridge.toggle(unitId);
          setTick(tick + 1);
        } catch (e) {
          // Ignore
        }
      };

      if (isExpanded) {
        const meta = CATEGORY_META[category] || CATEGORY_META.sponsored;
        const refoldLeft = createEl('div', { className: 'fb-diet-placeholder-left' }, [
          createEl('span', { className: 'fb-diet-badge ' + meta.badgeClass }, [meta.badgeText])
        ]);
        const refoldSymbol = createEl('span', { className: 'fb-diet-toggle-symbol' }, ['[-]']);
        const refoldBar = createEl(
          'div',
          {
            className: 'fb-diet-placeholder fb-diet-state-expanded',
            title: 'Re-fold',
            onClick: onToggle
          },
          [refoldLeft, refoldSymbol]
        );
        const content = [refoldBar, rendered];
        if (FoldContext && FoldContext.Provider) {
          return createEl(FoldContext.Provider, { value: true }, content);
        }
        const Fragment = React.Fragment || null;
        return Fragment ? createEl(Fragment, null, content) : content;
      }

      const bar = createEl(FBDietBar, { category, unitId, onToggle }, []);
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
      if (FoldContext && FoldContext.Provider) {
        return createEl(FoldContext.Provider, { value: true }, foldContent);
      }
      const Fragment = React.Fragment || null;
      return Fragment ? createEl(Fragment, null, foldContent) : foldContent;
    } catch (e) {
      return rendered;
    }
  }

  function SideAdHidden(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
    const bridge = window.FBDietBridge;
    if (!bridge || !React || !rendered) return rendered;

    const settings = bridge.getSettings();
    if (!settings.enabled || settings.removeSponsored === false) return rendered;

    bridge.reportBlocked({ category: 'sponsored', unitId: 'side_ad', reason: 'right-rail-sponsored' });

    // Directly hide right sidebar ad: return an empty hidden node (no placeholder, no unfold)
    return createEl('div', { className: 'adhidden fb-diet-side-ad-hidden', style: { display: 'none' } }, []);
  }

  function RightRailUnitWrapper(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
    if (!React || !rendered) return rendered;

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
    CATEGORY_META,
    HIDE_MODE,
    FBDietFold,
    FBDietBar,
    install,
    getStatus: () => ({
      hideMode: HIDE_MODE,
      modules: FEED_UNIT_MODULES,
      registered: window.FBDietProxy ? window.FBDietProxy.listRegistered() : null,
      settings: window.FBDietBridge ? window.FBDietBridge.getSettings() : null
    })
  };
})();
