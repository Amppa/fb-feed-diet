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

  // Autonomously inject probe CSS styles into the page
  function injectProbeStyles() {
    try {
      if (typeof document === 'undefined') return;
      if (document.getElementById('fb-diet-probe-styles')) return;

      const style = document.createElement('style');
      style.id = 'fb-diet-probe-styles';
      style.textContent = `
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
  }

  injectProbeStyles();

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
    const domLive = container && ui && typeof ui.extractFullDomSnapshot === 'function'
      ? ui.extractFullDomSnapshot(container, isMediaGroup)
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

    const report = {
      version: '1.4.2',
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

    report.classify = classifyResult
      ? {
          category: classifyResult.category,
          unitId: classifyResult.unitId,
          unitTypename: classifyResult.unitTypename,
          reason: classifyResult.reason,
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
      media: (domLive && domLive.media) || null
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

      const ui = window.FBDietUI;
      const userFacingGroup = ui && typeof ui.groupOf === 'function' ? ui.groupOf(category) : 'regular';
      const groupMeta = (ui && ui.GROUP_META && ui.GROUP_META[userFacingGroup]) || { badgeText: 'Other' };

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
    addProbe,
    injectProbeStyles
  };
})();
