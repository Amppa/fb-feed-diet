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

  const FEED_UNIT_MODULES = ['CometFeedUnitErrorBoundary.react'];

  // 'display-none' keeps the original subtree mounted but out of the layout (Phase 1
  // default). 'squash' is the reference implementation's 1x1 absolute overlay, kept as a
  // one-line escape hatch in case Facebook's video/visibility heuristics dislike
  // display:none on a feed unit.
  const HIDE_MODE = 'display-none';

  const CATEGORY_META = {
    sponsored: {
      badgeClass: 'fb-diet-badge-sponsored',
      badgeText: 'Sponsored',
      label: 'Sponsored post folded by FB Diet'
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
    const proxy = window.FBDietProxy;
    if (!proxy) return null;
    const React = proxy.getReact();
    if (!React) return null;
    return proxy.createElement(React, type, props, children);
  }

  /**
   * The collapsed notice bar. Reuses the classes already shipped in src/content/content.css
   * (which Chrome injects into this page), so the placeholder matches the popup theme.
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
   *
   * Receives { payload, SourceCmp, lastCmp } from proxy.js. The state hook is always the
   * first statement so the hook order stays stable, and every other branch is wrapped in
   * try/catch: this component is mounted where Facebook's own feed unit boundary was, so
   * throwing here would take down a chunk of the feed.
   */
  function FBDietFold(props) {
    const rendered = props.lastCmp;
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;

    const [tick, setTick] = React && typeof React.useState === 'function' ? React.useState(0) : [0, function noop() {}];

    // React does not re-render an already mounted feed unit merely because an
    // extension setting changed. Subscribe once so toggling the master switch or a
    // category immediately re-folds or restores already mounted units.
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
      const classify = window.FBDietClassify;
      if (!bridge || !classify) return rendered;

      const settings = bridge.getSettings();
      if (!settings.enabled) return rendered;

      const result = classify.classifyFeedUnit(props.payload);

      if (!result.category) {
        bridge.reportUnknown(result);
        return rendered;
      }
      if (!bridge.isEnabled(result.category)) return rendered;

      if (!result.unitId) return rendered;

      bridge.reportBlocked(result);

      // Already expanded by the user: render the original unit untouched
      if (bridge.isExpanded(result.unitId)) return rendered;

      const onToggle = () => {
        try {
          bridge.toggle(result.unitId);
          setTick(tick + 1);
        } catch (e) {
          // Never let a click handler throw into Facebook's event system
        }
      };

      const bar = createEl(FBDietBar, { category: result.category, unitId: result.unitId, onToggle }, []);
      const hidden = createEl(
        'div',
        {
          className: 'fb-diet-fold-hidden' + (HIDE_MODE === 'squash' ? ' fb-diet-foldsquash' : ''),
          'aria-hidden': 'true'
        },
        [rendered]
      );
      if (!bar || !hidden) return rendered;

      const Fragment = React.Fragment || null;
      return Fragment ? createEl(Fragment, null, [bar, hidden]) : [bar, hidden];
    } catch (e) {
      // Any failure degrades to the untouched unit
      return rendered;
    }
  }

  function install() {
    const proxy = window.FBDietProxy;
    if (!proxy || typeof proxy.registerComponent !== 'function') return false;

    let registered = 0;
    for (const moduleName of FEED_UNIT_MODULES) {
      if (proxy.registerComponent(moduleName, { component: FBDietFold, definerPath: '[6].default' })) {
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
