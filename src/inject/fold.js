/**
 * FB Diet - React fold wrapper (MAIN world)
 *
 * Decorates Facebook feed units instead of deleting them:
 *   - nothing matched or the category is disabled -> the original element tree is returned untouched
 *   - matched -> a compact notice bar plus the original tree hidden
 *     with display:none / 1x1 squash
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

  // Two-layer classification (STRATEGY.md, decision #8): categories are folded as
  // before, but the bar shows the user-facing GROUP. Kept local (like classify.js
  // keeps its own maps) so the MAIN-world module stays self-contained.
  const GROUP_BY_CATEGORY = {
    sponsored: 'ads',
    marketAds: 'ads',
    searchingAds: 'ads',
    regular: 'regular',
    suggested: 'suggested',
    reels: 'media',
    stories: 'media',
    suggestedGroup: 'other'
  };

  const GROUP_META = {
    ads: {
      badgeClass: 'fb-diet-badge-ads',
      badgeText: 'Ads'
    },
    regular: {
      badgeClass: 'fb-diet-badge-regular',
      badgeText: 'Regular'
    },
    suggested: {
      badgeClass: 'fb-diet-badge-suggested',
      badgeText: 'Suggested'
    },
    media: {
      badgeClass: 'fb-diet-badge-media',
      badgeText: 'Reels & Stories'
    },
    other: {
      badgeClass: 'fb-diet-badge-other',
      badgeText: 'Other'
    }
  };

  function groupOf(category) {
    return GROUP_BY_CATEGORY[category] || 'regular';
  }

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
    const meta = GROUP_META[groupOf(props.category)] || GROUP_META.other;

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
   * a small copy button. Clicking it copies a compact JSON report of the unit: the
   * classification result (category / reason / evidence), the unit identity, the
   * structured enrichment (author / group / content / media / viewer, metadata.js)
   * and the relay read log — everything needed to diagnose a wrong or a missed fold.
   * ------------------------------------------------------------------ */

  const PROBE_MAX_CHARS = 30000;

  function findDiagnosticSignals(payload, lastCmp) {
    if ((!payload || typeof payload !== 'object') && (!lastCmp || typeof lastCmp !== 'object')) return null;
    const matches = [];
    const visited = new Set();
    const keywords = ['追蹤', '加入', '推薦', 'SUBSCRIBE', 'JOIN', 'FOLLOW', 'SUGGEST'];

    function walk(current, path, depth) {
      if (depth > 14 || current === null || current === undefined) return;
      if (typeof current === 'string') {
        const upper = current.toUpperCase();
        for (const kw of keywords) {
          if (upper.indexOf(kw.toUpperCase()) !== -1) {
            matches.push({ path, value: current.length > 80 ? current.slice(0, 80) + '…' : current });
            break;
          }
        }
        return;
      }
      if (typeof current !== 'object') return;
      if (visited.has(current)) return;
      visited.add(current);

      if (Array.isArray(current)) {
        for (let i = 0; i < Math.min(current.length, 10); i++) {
          walk(current[i], path ? path + '.' + i : String(i), depth + 1);
        }
      } else {
        const keys = Object.keys(current);
        for (const key of keys) {
          if (
            key.startsWith('_') ||
            key.startsWith('__react') ||
            key === 'type' ||
            key === '$$typeof' ||
            key === 'SourceCmp' ||
            key === 'lastCmp'
          ) continue;
          walk(current[key], path ? path + '.' + key : key, depth + 1);
        }
      }
    }

    try {
      if (payload) walk(payload, '', 0);
      if (lastCmp) walk(lastCmp, 'render', 0);
    } catch (e) {}
    return matches.length ? matches : null;
  }

  function buildUnitProbeReport(props, classifyResult, relayReads) {
    const feedUnit = props.payload && props.payload.feedUnit;
    const bridge = window.FBDietBridge;
    const settings = bridge && typeof bridge.getSettings === 'function' ? bridge.getSettings() : null;

    const report = {
      at: new Date().toISOString(),
      version: typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '1.4.0',
      href: typeof window !== 'undefined' && window.location ? window.location.href : null,
      lang: typeof navigator !== 'undefined' && navigator.language ? navigator.language : null,
      moduleName: props.moduleName || null,
      position: props.payload && typeof props.payload.position === 'number' ? props.payload.position : null
    };

    if (props && props.entryCategory !== null && props.entryCategory !== undefined) {
      report.entryCategory = props.entryCategory;
    }

    report.classify = classifyResult
      ? {
          category: classifyResult.category,
          unitId: classifyResult.unitId,
          unitTypename: classifyResult.unitTypename,
          reason: classifyResult.reason,
          evidence: classifyResult.evidence,
          moduleName: classifyResult.moduleName
        }
      : null;

    const postId = (feedUnit && (feedUnit.post_id || feedUnit.clip_id || (feedUnit.story && feedUnit.story.post_id) || feedUnit.mf_story_key)) || null;
    const payloadKeys = props.payload && typeof props.payload === 'object' ? Object.keys(props.payload) : null;
    const feedUnitKeys = feedUnit && typeof feedUnit === 'object' ? Object.keys(feedUnit) : null;
    const childrenProps = props.payload && props.payload.children && typeof props.payload.children === 'object'
      ? (props.payload.children.props || (Array.isArray(props.payload.children) && props.payload.children[0] ? props.payload.children[0].props : null))
      : null;
    const childrenKeys = childrenProps && typeof childrenProps === 'object' ? Object.keys(childrenProps) : null;

    report.payload = {
      feedUnit: {
        post_id: postId,
        debug_info: feedUnit && typeof feedUnit.debug_info === 'string' ? (feedUnit.debug_info.length > 200 ? feedUnit.debug_info.slice(0, 200) + '…' : feedUnit.debug_info) : null,
        th_dat_spo: feedUnit && feedUnit.th_dat_spo !== undefined ? feedUnit.th_dat_spo : null
      },
      payloadKeys: payloadKeys && payloadKeys.length ? payloadKeys : null,
      feedUnitKeys: feedUnitKeys && feedUnitKeys.length ? feedUnitKeys : null,
      childrenKeys: childrenKeys && childrenKeys.length ? childrenKeys : null
    };

    // Relay store capture health
    let relayStatus = null;
    try {
      const relay = window.FBDietRelay;
      if (relay) {
        relayStatus = {
          isReady: typeof relay.isReady === 'function' ? relay.isReady() : false,
          sourceCount: typeof relay.getSourceCount === 'function' ? relay.getSourceCount() : 0,
          lastError: typeof relay.getLastError === 'function' ? relay.getLastError() : null
        };
      }
    } catch (e) {}
    report.relayStatus = relayStatus;

    // Diagnostic signals found in props: follow/join action buttons or suggested headers
    report.signals = findDiagnosticSignals(props.payload, props.lastCmp);

    // Structured context: author / group / content / media / viewer (metadata.js).
    let enrichment = null;
    try {
      const metadata = window.FBDietMetadata;
      if (metadata && typeof metadata.collect === 'function') {
        enrichment = metadata.collect(classifyResult, props);
      }
    } catch (e) {
      // Optional module; a failure must never break the probe
    }
    report.enrichment = enrichment;

    // The exact Relay paths the classifier tried for THIS unit, with the values.
    report.relayReads = Array.isArray(relayReads) && relayReads.length ? relayReads : null;

    // Top-level keys of the Relay record for this unit (essential for discovering new fields on FB updates)
    let recordKeys = null;
    try {
      const relay = window.FBDietRelay;
      const unitId = classifyResult && (classifyResult.unitId || (classifyResult.evidence && classifyResult.evidence.id));
      if (relay && typeof relay.describe === 'function' && unitId) {
        const record = relay.describe(unitId);
        if (record && typeof record === 'object') {
          recordKeys = Object.keys(record);
        }
      }
    } catch (e) {}
    report.recordKeys = recordKeys;

    let text = null;
    try {
      text = JSON.stringify(report, null, 2);
    } catch (e) {
      text = '{"error":"probe serialization failed: ' + String(e && e.message ? e.message : e) + '"}';
    }
    if (text.length > PROBE_MAX_CHARS) text = text.slice(0, PROBE_MAX_CHARS) + '\n…[truncated]';
    return { text, enrichment, report };
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

  let activeProbePopup = null;

  function closeActiveProbePopup() {
    if (!activeProbePopup) return;
    const popup = activeProbePopup;
    activeProbePopup = null;
    try {
      if (typeof document !== 'undefined') {
        document.removeEventListener('click', onOutsideProbeClick, true);
      }
      popup.classList.add('fb-diet-probe-popup-fadeout');
      setTimeout(() => {
        try { popup.remove(); } catch (e) {}
      }, 200);
    } catch (e) {}
  }

  function onOutsideProbeClick(e) {
    if (!activeProbePopup) return;
    if (e && e.target && activeProbePopup.contains(e.target)) {
      return;
    }
    closeActiveProbePopup();
  }

  function showProbePopup(holder, classifyResult, props, enrich) {
    try {
      if (!holder || typeof document === 'undefined' || typeof document.createElement !== 'function') return;

      closeActiveProbePopup();

      const popup = document.createElement('div');
      popup.className = 'fb-diet-probe-popup';
      popup.title = '點擊外部可關閉提示 (Click outside to dismiss)';

      const category = (classifyResult && classifyResult.category) || (props && props.entryCategory) || 'regular';
      const reason = (classifyResult && classifyResult.reason) || (props && props.moduleName ? 'component:' + props.moduleName : 'no-match');

      const evidence = classifyResult && classifyResult.evidence;
      const source = evidence && evidence.source && evidence.source !== 'none' ? evidence.source : null;
      const mod = (classifyResult && classifyResult.moduleName) || (props && props.moduleName) || null;
      let evidenceText = source || '';
      if (mod) {
        evidenceText = evidenceText ? evidenceText + ' (' + mod + ')' : mod;
      }
      if (!evidenceText) evidenceText = 'none';

      // 類型：sponsored
      const typeRow = document.createElement('div');
      typeRow.className = 'fb-diet-probe-popup-row';
      typeRow.textContent = '類型：' + category;
      popup.appendChild(typeRow);

      // 群組：ads（第二階層的使用者分組，STRATEGY.md 決策 #8）
      const groupRow = document.createElement('div');
      groupRow.className = 'fb-diet-probe-popup-row';
      groupRow.textContent = '群組：' + groupOf(category);
      popup.appendChild(groupRow);

      // 作者：Sunny Lin (@happylearningJapanese)（Page）
      const enrichment = enrich || null;
      const actorName = enrichment && enrichment.actor && enrichment.actor.name;
      const actorType = enrichment && enrichment.actor && enrichment.actor.typename;
      const actorId = enrichment && enrichment.actor && (enrichment.actor.username || enrichment.actor.id);
      if (actorName || actorType || actorId) {
        const actorRow = document.createElement('div');
        actorRow.className = 'fb-diet-probe-popup-row';
        actorRow.textContent = '作者：' + (actorName || actorId || '?') + (actorId && actorName && actorId !== actorName ? ' (@' + actorId + ')' : '') + (actorType ? '（' + actorType + '）' : '');
        popup.appendChild(actorRow);
      }

      // 社團：某社團（單一行，有值才顯示）
      const groupName = enrichment && enrichment.group && enrichment.group.name;
      if (groupName) {
        const groupNameRow = document.createElement('div');
        groupNameRow.className = 'fb-diet-probe-popup-row';
        groupNameRow.textContent = '社團：' + groupName;
        popup.appendChild(groupNameRow);
      }

      // 關係：CAN_SUBSCRIBE / CAN_JOIN（無值顯示 NULL）
      const subStatus = (enrichment && enrichment.actor && enrichment.actor.subscribeStatus) ||
        (evidence && evidence.subscribeStatus) ||
        'NULL';
      const joinState = (enrichment && enrichment.group && enrichment.group.joinState) ||
        (evidence && evidence.joinState) ||
        'NULL';
      const relRow = document.createElement('div');
      relRow.className = 'fb-diet-probe-popup-row';
      relRow.textContent = '關係：' + subStatus + ' / ' + joinState;
      popup.appendChild(relRow);

      // 標題：message 優先前 40 字，無則取 title，皆無為 NULL
      let titleSnippet = null;
      const msg = enrichment && enrichment.content && enrichment.content.message;
      const storyTitle = enrichment && enrichment.content && enrichment.content.title;
      if (msg && typeof msg === 'string' && msg.trim()) {
        titleSnippet = msg.trim().slice(0, 40);
      } else if (storyTitle && typeof storyTitle === 'string' && storyTitle.trim()) {
        titleSnippet = storyTitle.trim().slice(0, 40);
      } else {
        titleSnippet = 'NULL';
      }
      const titleRow = document.createElement('div');
      titleRow.className = 'fb-diet-probe-popup-row';
      titleRow.textContent = '標題：' + titleSnippet;
      popup.appendChild(titleRow);

      // 判斷：sponsored_data.ad_id
      const judgeRow = document.createElement('div');
      judgeRow.className = 'fb-diet-probe-popup-row';
      judgeRow.textContent = '判斷：' + reason;
      popup.appendChild(judgeRow);

      // 依據：props (CometFeedUnitErrorBoundary.react)
      const basisRow = document.createElement('div');
      basisRow.className = 'fb-diet-probe-popup-row';
      basisRow.textContent = '依據：' + evidenceText;
      popup.appendChild(basisRow);

      // 空行
      const spacer = document.createElement('div');
      spacer.className = 'fb-diet-probe-popup-spacer';
      popup.appendChild(spacer);

      // 已複製json到剪貼簿
      const copiedRow = document.createElement('div');
      copiedRow.className = 'fb-diet-probe-popup-row';
      copiedRow.textContent = '已複製json到剪貼簿';
      popup.appendChild(copiedRow);

      holder.appendChild(popup);
      activeProbePopup = popup;

      // Close on subsequent outside click
      setTimeout(() => {
        if (activeProbePopup === popup && typeof document !== 'undefined') {
          document.addEventListener('click', onOutsideProbeClick, true);
        }
      }, 0);
    } catch (e) {
      // Non-fatal
    }
  }

  /**
   * Wraps the unit's render output in a relative holder; the copy button is only
   * appended when probe mode is on (debug URL / debugProbe setting).
   */
  function addProbe(element, props, classifyResult, relayReads) {
    try {
      const bridge = window.FBDietBridge;
      const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
      if (!element || !bridge || !React) return element;

      const settings = bridge.getSettings ? bridge.getSettings() : null;
      const isProbeOn = bridge.isDebugEnabled() || (settings && settings.debugProbe === true);
      if (!isProbeOn) return element;

      const probe = buildUnitProbeReport(props, classifyResult, relayReads);
      const reportText = probe.text;
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

        try {
          const btn = event && (event.currentTarget || event.target);
          const holder = btn && typeof btn.closest === 'function'
            ? btn.closest('.fb-diet-probe-holder')
            : (btn ? btn.parentElement : null);
          if (holder) showProbePopup(holder, classifyResult, props, probe.enrichment);
        } catch (e) {
          // Non-fatal
        }
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

      const defaultFolded = Boolean(bridge.isEnabled(category));
      const isFolded = bridge.isUnitFolded ? bridge.isUnitFolded(unitId, defaultFolded) : defaultFolded;

      // Report counters
      if (defaultFolded) {
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

      if (!isFolded) {
        const meta = GROUP_META[groupOf(category)] || GROUP_META.other;
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
        return addProbe(output, props, classifyResult, relayReads);
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
        .fb-diet-probe-popup {
          position: absolute;
          top: 0;
          left: 2px;
          z-index: 10000;
          min-width: 240px;
          max-width: 480px;
          padding: 12px 16px;
          background: rgba(20, 21, 23, 0.95);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
          color: #e4e6eb;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 16px;
          line-height: 1.55;
          cursor: pointer;
          user-select: none;
          animation: fb-diet-popup-in 0.2s ease-out forwards;
        }
        .fb-diet-probe-popup-row {
          word-break: break-all;
          white-space: pre-wrap;
        }
        .fb-diet-probe-popup-spacer {
          height: 10px;
        }
        .fb-diet-probe-popup-fadeout {
          opacity: 0;
          transform: translateY(-4px) scale(0.96);
          transition: opacity 0.25s ease, transform 0.25s ease;
        }
        @keyframes fb-diet-popup-in {
          from {
            opacity: 0;
            transform: translateY(-4px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
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
    GROUP_META,
    GROUP_BY_CATEGORY,
    groupOf,
    HIDE_MODE,
    FBDietFold,
    FBDietBar,
    buildUnitProbeReport,
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
