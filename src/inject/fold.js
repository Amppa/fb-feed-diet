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

  /* ------------------------------------------------------------------ *
   * Feed probe (per-unit diagnostics)
   *
   * When debugging is on (URL fb_diet_debug=1, console __fbDietDebug(true)) or
   * the debugProbe setting is enabled, every unit flowing through FBDietFold gets
   * a small copy button. Clicking it copies a JSON report of the unit: the
   * classification result (category / reason / evidence), the component module
   * that produced the decision, and a depth-limited snapshot of the payload plus
   * the Relay record — everything needed to diagnose a wrong or a missed fold.
   * ------------------------------------------------------------------ */

  const PROBE_MAX_DEPTH = 5;
  const PROBE_MAX_KEYS = 60;
  const PROBE_MAX_CHARS = 30000;

  /** Depth-limited, JSON-safe serializer: functions / DOM nodes / cycles become markers. */
  function safeSerialize(value, depth) {
    try {
      if (value === null) return null;
      const kind = typeof value;
      if (kind === 'string' || kind === 'number' || kind === 'boolean') return value;
      if (kind === 'undefined') return null;
      if (kind === 'function') return '[fn' + (value.name ? ' ' + value.name : '') + ']';
      if (kind === 'symbol' || kind === 'bigint') return value.toString();
      if (typeof Node !== 'undefined' && value instanceof Node) return '[' + (value.nodeName || 'node') + ']';
      if (value instanceof Error) return 'Error: ' + value.message;
      if (depth >= PROBE_MAX_DEPTH) return '[depth]';
      if (Array.isArray(value)) {
        return value.slice(0, PROBE_MAX_KEYS).map((item) => safeSerialize(item, depth + 1));
      }
      const out = {};
      const keys = Object.keys(value);
      for (let i = 0; i < keys.length && i < PROBE_MAX_KEYS; i += 1) {
        out[keys[i]] = safeSerialize(value[keys[i]], depth + 1);
      }
      if (keys.length > PROBE_MAX_KEYS) out['…'] = '[more keys]';
      return out;
    } catch (e) {
      return '[unserializable]';
    }
  }

  function buildUnitProbeReport(props, classifyResult) {
    const report = {
      at: new Date().toISOString(),
      href: typeof window !== 'undefined' && window.location ? window.location.href : null,
      moduleName: props.moduleName || null,
      entryCategory: props.entryCategory || null,
      classify: classifyResult
        ? {
            category: classifyResult.category,
            unitId: classifyResult.unitId,
            unitTypename: classifyResult.unitTypename,
            reason: classifyResult.reason,
            evidence: classifyResult.evidence,
            moduleName: classifyResult.moduleName
          }
        : null,
      payload: safeSerialize(props.payload, 0)
    };

    // Best-effort Relay record snapshot for the unit id (the fields the classifier reads).
    try {
      const relay = window.FBDietRelay;
      const ids = classifyResult && classifyResult.evidence && classifyResult.evidence.ids;
      if (relay && typeof relay.describe === 'function' && ids && ids.length) {
        const record = relay.describe(ids[0]);
        if (record) report.relayRecord = safeSerialize(record, 0);
      }
    } catch (e) {
      // Relay probing is optional
    }

    let text = null;
    try {
      text = JSON.stringify(report, null, 2);
    } catch (e) {
      text = '{"error":"probe serialization failed: ' + String(e && e.message ? e.message : e) + '"}';
    }
    if (text.length > PROBE_MAX_CHARS) text = text.slice(0, PROBE_MAX_CHARS) + '\n…[truncated]';
    return text;
  }

  function promptFallbackCopy(payload) {
    try {
      window.prompt('FB Diet diagnostics - select all & copy (Ctrl+C / Cmd+C):', payload);
    } catch (e) {
      // Last resort: the console already carries the same report
    }
  }

  function copyProbeReport(text) {
    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        const request = navigator.clipboard.writeText(text);
        if (request && typeof request.then === 'function') {
          request.then(
            () => console.info('[FB Diet][Probe] Diagnostics copied to clipboard.'),
            () => promptFallbackCopy(text)
          );
          copied = true;
        }
      }
    } catch (e) {
      // Fall through to the prompt
    }
    if (!copied) promptFallbackCopy(text);
  }

  /**
   * Wraps the unit's render output in a relative holder; the copy button is only
   * appended when probe mode is on (debug URL / debugProbe setting).
   */
  function addProbe(element, props, classifyResult) {
    try {
      const bridge = window.FBDietBridge;
      const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
      if (!element || !bridge || !React) return element;

      const settings = bridge.getSettings ? bridge.getSettings() : null;
      const isProbeOn = bridge.isDebugEnabled() || (settings && settings.debugProbe === true);
      if (!isProbeOn) return element;

      const reportText = buildUnitProbeReport(props, classifyResult);
      const onProbeClick = (event) => {
        try {
          if (event) {
            if (typeof event.stopPropagation === 'function') event.stopPropagation();
            if (typeof event.preventDefault === 'function') event.preventDefault();
          }
        } catch (e) {
          // Facebook's own handlers must keep working
        }
        try {
          console.info('[FB Diet][Probe]', JSON.parse(reportText));
        } catch (e) {
          // Cannot happen for our own JSON, but never break the click
        }
        copyProbeReport(reportText);
      };

      const button = createEl(
        'button',
        { className: 'fb-diet-probe-btn', type: 'button', title: 'FB Diet: copy unit diagnostics (JSON)', onClick: onProbeClick },
        ['🔍']
      );
      return createEl('div', { className: 'fb-diet-probe-holder' }, [button, element]);
    } catch (e) {
      return element;
    }
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

      let category = props.entryCategory || null;
      let reason = 'component:' + (props.moduleName || 'unknown');
      let unitId = null;
      let unitTypename = null;
      let classifyResult = null;

      if (!category) {
        const classify = window.FBDietClassify;
        if (!classify) return rendered;

        // The module name is part of the classification context: the Reels attachment
        // style wrapper, for example, must never fold as Reels (see STRATEGY.md).
        const result = classify.classifyFeedUnit(props.payload, { moduleName: props.moduleName || null });
        classifyResult = result;
        if (!result.category) {
          bridge.reportUnknown(result);
          return addProbe(rendered, props, classifyResult);
        }

        category = result.category;
        reason = result.reason;
        unitId = result.unitId;
        unitTypename = result.unitTypename;
      }

      if (!bridge.isEnabled(category)) return addProbe(rendered, props, classifyResult);

      if (!unitId) {
        const mod = props.moduleName || 'unit';
        const type = (props.payload && props.payload.unitTypename) || 'ad';
        unitId = mod + '_' + type;
      }

      // unitTypename / moduleName ride along so the diagnostic log shows which
      // component produced the fold decision.
      bridge.reportBlocked({
        category,
        unitId,
        reason,
        unitTypename:
          unitTypename ||
          (props.payload && typeof props.payload.unitTypename === 'string' ? props.payload.unitTypename : null),
        moduleName: props.moduleName || null
      });

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

        // The unfolded tree goes inside its own wrapper so the CSS can draw
        // the shared group frame around the bar + post (sibling selector).
        // Wrapping in a plain div (instead of tagging the FB element) works no
        // matter whether Facebook's element is a host node, Fragment or array.
        const expandedBody = createEl('div', { className: 'fb-diet-expand-body' }, [rendered]);

        const content = [refoldBar, expandedBody];
        const Fragment = React.Fragment || null;
        const output = FoldContext && FoldContext.Provider
          ? createEl(FoldContext.Provider, { value: true }, content)
          : (Fragment ? createEl(Fragment, null, content) : content);
        return addProbe(output, props, classifyResult);
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
      const Fragment = React.Fragment || null;
      const output = FoldContext && FoldContext.Provider
        ? createEl(FoldContext.Provider, { value: true }, foldContent)
        : (Fragment ? createEl(Fragment, null, foldContent) : foldContent);
      return addProbe(output, props, classifyResult);
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

    bridge.reportBlocked({ category: 'sponsored', unitId: 'side_ad', reason: 'right-rail-sponsored' });

    // Directly hide right sidebar ad: return an empty hidden node (no placeholder, no unfold)
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
        .fb-diet-probe-holder {
          position: relative;
        }
        .fb-diet-probe-btn {
          position: absolute;
          top: 4px;
          left: -26px;
          z-index: 9999;
          width: 22px;
          height: 22px;
          line-height: 20px;
          padding: 0;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.4);
          background: rgba(0, 0, 0, 0.5);
          color: #fff;
          font-size: 11px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0.55;
        }
        .fb-diet-probe-btn:hover {
          opacity: 1;
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
      hydration: hydrationStats,
      registered: window.FBDietProxy ? window.FBDietProxy.listRegistered() : null,
      settings: window.FBDietBridge ? window.FBDietBridge.getSettings() : null
    })
  };
})();
