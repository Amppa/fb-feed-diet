/**
 * FB Diet - React fold wrapper (MAIN world)
 *
 * Decorates Facebook feed units instead of deleting them:
 *   - nothing matched or the category is disabled -> the original element tree is returned untouched
 *   - matched -> a compact notice bar plus the original tree hidden
 *     with display:none (strategy A: Facebook's own render, commit and visibility
 *     bookkeeping keep working, only the layout box disappears)
 *   - expanded by the user      -> the original tree is returned untouched again
 *
 * Expand/collapse state is keyed by the Relay feed unit id and lives in bridge.js, so it
 * survives re-renders and virtualised scrolling.
/**
 * FB Diet - React fold wrapper (MAIN world)
 *
 * Decorates Facebook feed units instead of deleting them:
 *   - nothing matched or the category is disabled -> the original element tree is returned untouched
 *   - matched -> a compact notice bar plus the original tree hidden
 *     with display:none (strategy A: Facebook's own render, commit and visibility
 *     bookkeeping keep working, only the layout box disappears)
 *   - expanded by the user      -> the original tree is returned untouched again
 *
 * Expand/collapse state is keyed by the Relay feed unit id and lives in bridge.js, so it
 * survives re-renders and virtualised scrolling.
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
      badgeText: 'Sponsored',
      label: 'Sponsored content folded by FB Diet'
    },
    suggested: {
      badgeClass: 'fb-diet-badge-suggested',
      badgeText: 'Suggested',
      label: 'Suggested for you folded by FB Diet'
    },
    suggestedGroup: {
      badgeClass: 'fb-diet-badge-group',
      badgeText: 'Group suggestion',
      label: 'Suggested group folded by FB Diet'
    },
    reels: {
      badgeClass: 'fb-diet-badge-reels',
      badgeText: 'Reels',
      label: 'Reels folded by FB Diet'
    },
    stories: {
      badgeClass: 'fb-diet-badge-stories',
      badgeText: 'Stories',
      label: 'Stories folded by FB Diet'
    },
    marketAds: {
      badgeClass: 'fb-diet-badge-market',
      badgeText: 'Marketplace ad',
      label: 'Marketplace ad folded by FB Diet'
    },
    searchingAds: {
      badgeClass: 'fb-diet-badge-search',
      badgeText: 'Search ad',
      label: 'Search ad folded by FB Diet'
    }
  };

  function createEl(type, props, children) {
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
    const proxy = window.FBDietProxy;
    if (!React || !proxy) return null;
    return proxy.createElement(React, type, props, children);
  }

  /**
   * The collapsed notice bar.
   */
  function FBDietBar(props) {
    const meta = CATEGORY_META[props.category] || CATEGORY_META.sponsored;

    const left = createEl('div', { className: 'fb-diet-placeholder-left' }, [
      createEl('span', { className: 'fb-diet-badge ' + meta.badgeClass }, [meta.badgeText]),
      createEl('span', { className: 'fb-diet-label' }, [meta.label])
    ]);

    const button = createEl(
      'button',
      {
        type: 'button',
        className: 'fb-diet-toggle-btn',
        title: 'Show the original post',
        onClick: props.onToggle
      },
      ['Show post']
    );

    return createEl('div', { className: 'fb-diet-placeholder' }, [left, button]);
  }

  /**
   * The component that replaces a matched feed unit.
   */
  function FBDietFold(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;

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
        const refoldBar = createEl('div', { className: 'fb-diet-placeholder fb-diet-state-expanded' }, [
          createEl('span', { className: 'fb-diet-label' }, ['Post restored by FB Diet']),
          createEl('button', { type: 'button', className: 'fb-diet-toggle-btn', onClick: onToggle }, ['Re-fold'])
        ]);
        const Fragment = React.Fragment || null;
        return Fragment ? createEl(Fragment, null, [refoldBar, rendered]) : [refoldBar, rendered];
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

      const Fragment = React.Fragment || null;
      return Fragment ? createEl(Fragment, null, [bar, hidden]) : [bar, hidden];
    } catch (e) {
      return rendered;
    }
  }

  function install() {
    const proxy = window.FBDietProxy;
    if (!proxy || typeof proxy.registerComponent !== 'function') return false;

    let registered = 0;
    for (const item of FEED_UNIT_MODULES) {
      const moduleName = item.name;
      const category = item.category;
      const definerPath = item.definerPath || '[6].default';

      function SpecificFold(props) {
        return FBDietFold(Object.assign({ entryCategory: category, moduleName }, props));
      }

      if (proxy.registerComponent(moduleName, { component: SpecificFold, definerPath })) {
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
