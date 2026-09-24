/**
 * FB Diet - Probe Diagnostics Module (MAIN world)
 *
 * Provides per-unit JSON diagnostic reports, keyword signal discovery,
 * copy-to-clipboard interactions, and in-place tooltip popups.
 *
 * Public API: window.FBDietProbe
 */
window.FBDietProbe = (() => {
  'use strict';

  const PROBE_MAX_CHARS = 30000;
  let activeProbePopup = null;

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

  function buildUnitProbeReport(props, classifyResult, relayReads, container, renderedAt) {
    const feedUnit = props.payload && props.payload.feedUnit;
    const nowIso = new Date().toISOString();
    const renderIso = renderedAt || nowIso;

    const unitKey = classifyResult && (classifyResult.unitId || (classifyResult.evidence && classifyResult.evidence.id));
    const ui = window.FBDietUI;
    const cached = unitKey && ui && ui.titleBarCache ? ui.titleBarCache.get(unitKey) : null;
    const isMediaGroup = classifyResult && (classifyResult.category === 'reels' || classifyResult.category === 'stories');
    const domMetadata = window.FBDietDOMMetadata;
    const domLive = container && domMetadata && typeof domMetadata.collect === 'function'
      ? domMetadata.collect(container, isMediaGroup)
      : null;

    // Structured context from Props / Relay store (initial)
    let initialEnrichment = null;
    try {
      const metadata = window.FBDietMetadata;
      if (metadata && typeof metadata.collect === 'function') {
        initialEnrichment = metadata.collect(classifyResult, props);
      }
    } catch (e) {}

    // URLs: extract postUrl & adUrl
    const adUrl = (domLive && domLive.adUrl) || (cached && cached.adUrl) || (initialEnrichment && initialEnrichment.content && initialEnrichment.content.permalink && initialEnrichment.content.permalink.indexOf('/ads/') !== -1 ? initialEnrichment.content.permalink : null);
    let postUrl = (domLive && domLive.postUrl) || (cached && cached.postUrl) || (initialEnrichment && initialEnrichment.content && initialEnrichment.content.permalink && initialEnrichment.content.permalink.indexOf('/ads/') === -1 ? initialEnrichment.content.permalink : null);

    const postId = (feedUnit && (feedUnit.post_id || feedUnit.clip_id || (feedUnit.story && feedUnit.story.post_id) || feedUnit.mf_story_key)) || null;
    const authorHandle = (initialEnrichment && initialEnrichment.actor && (initialEnrichment.actor.username || initialEnrichment.actor.id)) || null;
    if (!postUrl && postId && authorHandle) {
      postUrl = 'https://www.facebook.com/' + authorHandle + '/posts/' + postId;
    }

    const extVersion = (typeof window !== 'undefined' && window.FB_DIET_DEFAULTS && window.FB_DIET_DEFAULTS.VERSION)
      || (typeof globalThis !== 'undefined' && globalThis.FB_DIET_DEFAULTS && globalThis.FB_DIET_DEFAULTS.VERSION)
    const bridge = window.FBDietBridge;
    const currentSettings = bridge && typeof bridge.getSettings === 'function' ? bridge.getSettings() : null;
    const classifyModule = window.FBDietClassify;

    let domSuggestedLive = (classifyResult && classifyResult.domEvidence) || null;
    const detector = window.FBDietDOMSuggested;
    if ((!domSuggestedLive || !domSuggestedLive.debug) && container && detector && typeof detector.detect === 'function') {
      try {
        const live = detector.detect(container);
        if (live) {
          domSuggestedLive = domSuggestedLive ? Object.assign({}, live, domSuggestedLive) : live;
        }
      } catch (e) {}
    }

    const isDomSuggested = Boolean(domSuggestedLive && domSuggestedLive.isSuggested);
    const effectiveCategory = isDomSuggested ? 'suggested' : ((classifyResult && classifyResult.category) || (props && props.entryCategory) || 'regular');
    const effectiveReason = isDomSuggested ? (domSuggestedLive.reason || 'dom:suggested') : (classifyResult ? classifyResult.reason : null);

    const settingKey = (classifyModule && classifyModule.SETTING_BY_CATEGORY && classifyModule.SETTING_BY_CATEGORY[effectiveCategory]) || null;
    let foldMode = 'off';
    if (bridge && typeof bridge.getFoldMode === 'function') {
      foldMode = bridge.getFoldMode(effectiveCategory);
    } else if (classifyModule && typeof classifyModule.getCategoryFoldMode === 'function') {
      foldMode = classifyModule.getCategoryFoldMode(effectiveCategory, currentSettings);
    }
    const isCategoryOn = foldMode !== 'off';

    const activeMode = currentSettings ? (currentSettings.dietMode || 'lite') : 'lite';

    const report = {
      version: extVersion,
      mode: activeMode,
      dietMode: activeMode,
      categorySetting: {
        category: effectiveCategory,
        key: settingKey,
        enabled: isCategoryOn,
        foldMode: foldMode
      },
      at: {
        rendered: renderIso,
        probed: nowIso
      },
      url: {
        post: postUrl || null,
        ad: adUrl || null
      },
      moduleName: props.moduleName || null,
      position: props.payload && typeof props.payload.position === 'number' ? props.payload.position : null
    };

    if (props && props.entryCategory !== null && props.entryCategory !== undefined) {
      report.entryCategory = props.entryCategory;
    }

    let normalizedEvidence = classifyResult && classifyResult.evidence ? Object.assign({}, classifyResult.evidence) : null;
    if (normalizedEvidence && normalizedEvidence.id && classifyResult && normalizedEvidence.id === classifyResult.unitId) {
      delete normalizedEvidence.id;
    }
    if (domSuggestedLive && normalizedEvidence) {
      normalizedEvidence.domSignal = domSuggestedLive.text || domSuggestedLive.reason;
    }

    const liveSignal = (domSuggestedLive && domSuggestedLive.signal) ||
                       (classifyResult && (classifyResult.signal || (classifyResult.domEvidence && classifyResult.domEvidence.signal))) ||
                       null;

    report.classify = classifyResult
      ? {
          category: effectiveCategory,
          signal: liveSignal,
          categoryEnabled: isCategoryOn,
          foldMode: foldMode,
          unitId: classifyResult.unitId,
          unitTypename: classifyResult.unitTypename,
          reason: effectiveReason,
          evidence: normalizedEvidence,
          moduleName: classifyResult.moduleName
        }
      : null;

    // Dual-track: (1) memory (Props & Relay store in memory), (2) dom (live rendered DOM)
    report.memory = {
      enrichment: initialEnrichment,
      relayStatus: null
    };
    try {
      const relay = window.FBDietRelay;
      if (relay) {
        report.memory.relayStatus = {
          isReady: typeof relay.isReady === 'function' ? relay.isReady() : false,
          sourceCount: typeof relay.getSourceCount === 'function' ? relay.getSourceCount() : 0,
          lastError: typeof relay.getLastError === 'function' ? relay.getLastError() : null
        };
      }
    } catch (e) {}

    report.dom = {
      actor: (domLive && domLive.actor) || (cached && cached.actorName) || null,
      snippet: (domLive && domLive.snippet) || (cached && cached.snippetText) || null,
      group: (domLive && domLive.group) || (cached && cached.groupName) || null,
      postUrl: postUrl || null,
      adUrl: adUrl || null,
      media: (domLive && domLive.media) || null,
      suggested: domSuggestedLive || null,
      debug: (domSuggestedLive && domSuggestedLive.debug) || null
    };

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

    // Diagnostic signals found in props
    report.signals = findDiagnosticSignals(props.payload, props.lastCmp);

    // The exact Relay paths the classifier tried for THIS unit
    report.relayReads = Array.isArray(relayReads) && relayReads.length ? relayReads : null;

    // Top-level keys of the Relay record
    let recordKeys = null;
    try {
      const relay = window.FBDietRelay;
      if (relay && typeof relay.describe === 'function' && unitKey) {
        const record = relay.describe(unitKey);
        if (record && typeof record === 'object') {
          recordKeys = Object.keys(record);
        }
      }
    } catch (e) {}
    report.recordKeys = recordKeys;

    // Fold-scope context (STRATEGY.md decision #26): was folding restricted for this
    // report, what is the runtime verdict, and on which path.
    let scopePath = null;
    let scopeRestricted = false;
    let scopeAllowed = true;
    try {
      scopePath = (window.location && window.location.pathname) || null;
      const scopeSettings = window.FBDietBridge && window.FBDietBridge.getSettings ? window.FBDietBridge.getSettings() : null;
      scopeRestricted = Boolean(scopeSettings && scopeSettings.restrictFoldScope !== false);
      const scopeDefaults = window.FB_DIET_DEFAULTS;
      const isScopeAllowed = scopeDefaults && typeof scopeDefaults.isFoldScopeAllowed === 'function'
        ? scopeDefaults.isFoldScopeAllowed
        : null;
      scopeAllowed = !scopeRestricted || !isScopeAllowed || isScopeAllowed(scopePath);
    } catch (e) {
      // Diagnostics must never break the report
    }
    report.scope = { restricted: scopeRestricted, allowed: scopeAllowed, path: scopePath };

    let text = null;
    try {
      text = JSON.stringify(report, null, 2);
    } catch (e) {
      text = '{"error":"probe serialization failed: ' + String(e && e.message ? e.message : e) + '"}';
    }
    if (text.length > PROBE_MAX_CHARS) text = text.slice(0, PROBE_MAX_CHARS) + '\n…[truncated]';
    return { text, report };
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

  function showProbePopup(holder, classifyResult, props, report) {
    try {
      if (!holder || typeof document === 'undefined' || typeof document.createElement !== 'function') return;

      closeActiveProbePopup();

      const popup = document.createElement('div');
      popup.className = 'fb-diet-probe-popup';
      popup.title = '點擊外部可關閉提示 (Click outside to dismiss)';

      const category = (report && report.classify && report.classify.category)
        || (report && report.categorySetting && report.categorySetting.category)
        || (classifyResult && classifyResult.category)
        || (props && props.entryCategory)
        || 'regular';
      const reason = (report && report.classify && report.classify.reason)
        || (report && report.dom && report.dom.suggested && report.dom.suggested.reason)
        || (classifyResult && classifyResult.reason)
        || (props && props.moduleName ? 'component:' + props.moduleName : 'no-match');

      const evidence = classifyResult && classifyResult.evidence;
      const source = evidence && evidence.source && evidence.source !== 'none' ? evidence.source : null;
      const mod = (classifyResult && classifyResult.moduleName) || (props && props.moduleName) || null;
      let evidenceText = source || '';
      if (mod) {
        evidenceText = evidenceText ? evidenceText + ' (' + mod + ')' : mod;
      }
      if (!evidenceText) evidenceText = 'none';

      const ui = window.FBDietUI;
      const userFacingGroup = ui && typeof ui.groupOf === 'function' ? ui.groupOf(category) : 'regular';
      const groupMeta = (ui && ui.GROUP_META && ui.GROUP_META[userFacingGroup]) || { badgeText: 'Other' };

      // Mode & Category switch status
      const modeStr = (report && (report.dietMode || report.mode) ? (report.dietMode || report.mode).toUpperCase() : 'LITE');
      const catSetting = report && report.categorySetting;
      const statusText = catSetting ? (catSetting.enabled ? 'ON (' + catSetting.foldMode + ')' : 'OFF') : 'OFF';

      const modeRow = document.createElement('div');
      modeRow.className = 'fb-diet-probe-popup-row';
      modeRow.textContent = 'Mode: ' + modeStr + ' · Filter: ' + statusText;
      popup.appendChild(modeRow);

      // Category: Ads (sponsored)
      const catRow = document.createElement('div');
      catRow.className = 'fb-diet-probe-popup-row';
      catRow.textContent = 'Category: ' + groupMeta.badgeText + ' (' + category + ')';
      popup.appendChild(catRow);

      // Signal: th_dat_spo
      const signalRow = document.createElement('div');
      signalRow.className = 'fb-diet-probe-popup-row';
      signalRow.textContent = 'Signal: ' + reason;
      popup.appendChild(signalRow);

      // Source: props (CometFeedUnitErrorBoundary.react)
      const sourceRow = document.createElement('div');
      sourceRow.className = 'fb-diet-probe-popup-row';
      sourceRow.textContent = 'Source: ' + evidenceText;
      popup.appendChild(sourceRow);

      // Scope: fold-scope verdict (STRATEGY.md decision #26)
      if (report && report.scope) {
        const scopeRow = document.createElement('div');
        scopeRow.className = 'fb-diet-probe-popup-row';
        scopeRow.textContent = 'Scope: ' + (report.scope.allowed ? 'home/search/marketplace' : 'groups/profile');
        popup.appendChild(scopeRow);
      }

      // Link: article or ad URL (if found)
      const postUrl = report && report.url && (report.url.post || report.url.ad);
      if (postUrl) {
        const linkRow = document.createElement('div');
        linkRow.className = 'fb-diet-probe-popup-row';
        linkRow.textContent = 'Link: ' + (postUrl.length > 50 ? postUrl.slice(0, 50) + '…' : postUrl);
        popup.appendChild(linkRow);
      }

      // Spacer
      const spacer = document.createElement('div');
      spacer.className = 'fb-diet-probe-popup-spacer';
      popup.appendChild(spacer);

      // Copied notice
      const copiedRow = document.createElement('div');
      copiedRow.className = 'fb-diet-probe-popup-row';
      copiedRow.textContent = '已複製診斷 JSON 到剪貼簿 (Copied)';
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
      const ui = window.FBDietUI;
      if (!element || !bridge || !React) return element;

      const settings = bridge.getSettings ? bridge.getSettings() : null;
      const isProbeOn = bridge.isDebugEnabled() || (settings && settings.debugProbe === true);
      if (!isProbeOn) return element;

      const renderedAt = new Date().toISOString();
      const onProbeClick = (event) => {
        try {
          if (event) {
            if (typeof event.stopPropagation === 'function') event.stopPropagation();
            if (typeof event.preventDefault === 'function') event.preventDefault();
          }
        } catch (e) {
          // Facebook's own handlers must keep working
        }

        const btn = event && (event.currentTarget || event.target);
        const holder = btn && typeof btn.closest === 'function'
          ? btn.closest('.fb-diet-probe-holder')
          : (btn ? btn.parentElement : null);
        const container = holder
          ? (holder.querySelector('.fb-diet-fold-hidden, .fb-diet-expand-body') || holder)
          : null;

        const liveProbe = buildUnitProbeReport(props, classifyResult, relayReads, container, renderedAt);
        const reportText = liveProbe.text;

        try {
          console.info('[FB Diet][Probe]', JSON.parse(reportText));
        } catch (e) {
          // Cannot happen for our own JSON, but never break the click
        }
        copyProbeReport(reportText);

        try {
          if (holder) showProbePopup(holder, classifyResult, props, liveProbe.report);
        } catch (e) {
          // Non-fatal
        }
      };

      const createEl = (ui && ui.createEl) || function fallbackCreateEl(type, p, c) {
        return window.FBDietProxy ? window.FBDietProxy.createElement(React, type, p, c) : null;
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

  return {
    PROBE_MAX_CHARS,
    findDiagnosticSignals,
    buildUnitProbeReport,
    promptFallbackCopy,
    copyProbeReport,
    closeActiveProbePopup,
    showProbePopup,
    addProbe
  };
})();
