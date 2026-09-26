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
  const PROBE_SCHEMA_VERSION = 3;
  const defaults = window.FB_DIET_DEFAULTS || globalThis.FB_DIET_DEFAULTS || {};
  const keywords = defaults.KEYWORDS || {};
  const DIAGNOSTIC_KEYWORDS = Array.isArray(keywords.DIAGNOSTIC) ? keywords.DIAGNOSTIC : [];
  let activeProbePopup = null;

  /** Serialize a report with a circular-safe fallback and a hard size cap. */
  function serializeReport(report) {
    let text = null;
    try {
      text = JSON.stringify(report, null, 2);
    } catch (e) {
      text = '{"error":"probe serialization failed: ' + String(e && e.message ? e.message : e) + '"}';
    }
    if (text.length > PROBE_MAX_CHARS) text = text.slice(0, PROBE_MAX_CHARS) + '\n…[truncated]';
    return { text, report };
  }

  function findDiagnosticSignals(payload, lastCmp) {
    if ((!payload || typeof payload !== 'object') && (!lastCmp || typeof lastCmp !== 'object')) return null;
    const matches = [];
    const visited = new Set();
    const keywords = DIAGNOSTIC_KEYWORDS;

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

  function resolveProbeScope() {
    let scopePath = null;
    let scopeRestricted = false;
    let scopeAllowed = true;
    try {
      scopePath = (typeof window !== 'undefined' && window.location && window.location.pathname) || null;
      const bridge = typeof window !== 'undefined' ? window.FBDietBridge : null;
      const scopeSettings = bridge && bridge.getSettings ? bridge.getSettings() : null;
      scopeRestricted = Boolean(scopeSettings && scopeSettings.restrictFoldScope !== false);
      const scopeDefaults = (typeof window !== 'undefined' && window.FB_DIET_DEFAULTS) || (typeof globalThis !== 'undefined' && globalThis.FB_DIET_DEFAULTS);
      const isScopeAllowed = scopeDefaults && typeof scopeDefaults.isFoldScopeAllowed === 'function'
        ? scopeDefaults.isFoldScopeAllowed
        : null;
      scopeAllowed = !scopeRestricted || !isScopeAllowed || isScopeAllowed(scopePath);
    } catch (e) {
      // Diagnostics must never break the report
    }
    return { restricted: scopeRestricted, allowed: scopeAllowed, path: scopePath };
  }

  /** Relay post id of the unit, handed to the DOM collector so it can synthesize a permalink. */
  function relayPostIdHint(feedUnit) {
    const postId = (feedUnit && (feedUnit.post_id || feedUnit.clip_id || (feedUnit.story && feedUnit.story.post_id) || feedUnit.mf_story_key)) || null;
    return postId ? { postId } : null;
  }

  /**
   * Shared live collection layer for the three report builders: memory enrichment,
   * DOM metadata, suggested detection and the effective-category verdict are each
   * gathered once per report so the builders can never drift apart.
   */
  function collectProbeContext(props, classifyResult, relayReads, container, renderedAt) {
    const nowIso = new Date().toISOString();
    const renderIso = renderedAt || nowIso;

    const feedUnit = props && props.payload && props.payload.feedUnit;
    const ui = window.FBDietUI;
    const bridge = window.FBDietBridge;
    const currentSettings = bridge && typeof bridge.getSettings === 'function' ? bridge.getSettings() : null;
    const activeMode = currentSettings ? (currentSettings.dietMode || 'full') : 'full';

    const unitKey = classifyResult && (classifyResult.unitId || (classifyResult.evidence && classifyResult.evidence.id));
    const cached = unitKey && ui && ui.titleBarCache ? ui.titleBarCache.get(unitKey) : null;

    const isMediaGroup = classifyResult && (classifyResult.category === 'reels' || classifyResult.category === 'stories' || classifyResult.category === 'suggestedGroup');
    const domMetadata = window.FBDietDOMMetadata;
    const domLive = container && domMetadata && typeof domMetadata.collect === 'function'
      ? domMetadata.collect(container, isMediaGroup, relayPostIdHint(feedUnit))
      : null;

    // Structured context from Props / Relay store (initial)
    let enrichment = null;
    try {
      const metadata = window.FBDietMetadata;
      if (metadata && typeof metadata.collect === 'function') {
        enrichment = metadata.collect(classifyResult, props);
      }
    } catch (e) {}

    // URLs: extract postUrl & adUrl
    const adUrl = (domLive && domLive.adUrl) || (cached && cached.adUrl) || (enrichment && enrichment.content && enrichment.content.permalink && enrichment.content.permalink.indexOf('/ads/') !== -1 ? enrichment.content.permalink : null);
    let postUrl = (domLive && domLive.postUrl) || (cached && cached.postUrl) || (enrichment && enrichment.content && enrichment.content.permalink && enrichment.content.permalink.indexOf('/ads/') === -1 ? enrichment.content.permalink : null);

    const postId = (relayPostIdHint(feedUnit) || {}).postId || null;
    const authorHandle = (enrichment && enrichment.actor && (enrichment.actor.username || enrichment.actor.id)) || null;
    if (!postUrl && postId && authorHandle) {
      postUrl = 'https://www.facebook.com/' + authorHandle + '/posts/' + postId;
    }

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

    const baseCategory = (classifyResult && classifyResult.category) || (props && props.entryCategory) || 'regular';
    const isAlreadyClassified = baseCategory && baseCategory !== 'regular';
    const isDomSuggested = !isAlreadyClassified && Boolean(domSuggestedLive && domSuggestedLive.isSuggested);
    const effectiveCategory = isDomSuggested ? 'suggested' : baseCategory;
    const effectiveReason = isDomSuggested ? (domSuggestedLive.reason || 'dom:suggested') : (classifyResult ? classifyResult.reason : null);

    const payloadKeys = props && props.payload && typeof props.payload === 'object' ? Object.keys(props.payload) : null;
    const feedUnitKeys = feedUnit && typeof feedUnit === 'object' ? Object.keys(feedUnit) : null;
    const childrenProps = props && props.payload && props.payload.children && typeof props.payload.children === 'object'
      ? (props.payload.children.props || (Array.isArray(props.payload.children) && props.payload.children[0] ? props.payload.children[0].props : null))
      : null;
    const childrenKeys = childrenProps && typeof childrenProps === 'object' ? Object.keys(childrenProps) : null;

    return {
      nowIso,
      renderIso,
      props,
      classifyResult,
      relayReads,
      feedUnit,
      bridge,
      currentSettings,
      activeMode,
      unitKey,
      cached,
      domLive,
      domSuggestedLive,
      enrichment,
      adUrl,
      postUrl,
      postId,
      effectiveCategory,
      effectiveReason,
      feedPosition: props && props.payload && typeof props.payload.position === 'number' ? props.payload.position : null,
      moduleName: (props && props.moduleName) || (classifyResult && classifyResult.moduleName) || null,
      signals: findDiagnosticSignals(props && props.payload, props && props.lastCmp),
      relayStatus: buildRelayStatus(),
      recordKeys: resolveRecordKeys(unitKey),
      payloadKeys,
      feedUnitKeys,
      childrenKeys
    };
  }

  /** Relay store health snapshot, shared by the unit and proxy reports. */
  function buildRelayStatus() {
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
    return relayStatus;
  }

  /** Top-level keys of the Relay record for this unit, when the store can describe it. */
  function resolveRecordKeys(unitKey) {
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
    return recordKeys;
  }

  /** Fold policy for the effective category: { category, key, enabled, foldMode }. */
  function resolveCategorySetting(ctx) {
    const classifyModule = window.FBDietClassify;
    const settingKey = (classifyModule && classifyModule.SETTING_BY_CATEGORY && classifyModule.SETTING_BY_CATEGORY[ctx.effectiveCategory]) || null;
    let foldMode = 'off';
    if (ctx.bridge && typeof ctx.bridge.getFoldMode === 'function') {
      foldMode = ctx.bridge.getFoldMode(ctx.effectiveCategory);
    } else if (classifyModule && typeof classifyModule.getCategoryFoldMode === 'function') {
      foldMode = classifyModule.getCategoryFoldMode(ctx.effectiveCategory, ctx.currentSettings);
    }
    return {
      category: ctx.effectiveCategory,
      key: settingKey,
      enabled: foldMode !== 'off',
      foldMode: foldMode
    };
  }

  function buildUnitProbeReport(props, classifyResult, relayReads, container, renderedAt) {
    const ctx = collectProbeContext(props, classifyResult, relayReads, container, renderedAt);
    const categorySetting = resolveCategorySetting(ctx);
    const isCategoryOn = categorySetting.enabled;
    const foldMode = categorySetting.foldMode;
    const effectiveCategory = ctx.effectiveCategory;

    const report = {
      schemaVersion: PROBE_SCHEMA_VERSION,
      mode: ctx.activeMode,
      dietMode: ctx.activeMode,
      categorySetting: categorySetting,
      at: {
        rendered: ctx.renderIso,
        probed: ctx.nowIso
      },
      url: {
        post: ctx.postUrl || null,
        ad: ctx.adUrl || null
      },
      moduleName: ctx.props.moduleName || null,
      position: ctx.feedPosition
    };

    if (ctx.props && ctx.props.entryCategory !== null && ctx.props.entryCategory !== undefined) {
      report.entryCategory = ctx.props.entryCategory;
    }

    let normalizedEvidence = ctx.classifyResult && ctx.classifyResult.evidence ? Object.assign({}, ctx.classifyResult.evidence) : null;
    if (normalizedEvidence && normalizedEvidence.id && ctx.classifyResult && normalizedEvidence.id === ctx.classifyResult.unitId) {
      delete normalizedEvidence.id;
    }
    if (ctx.domSuggestedLive && normalizedEvidence) {
      normalizedEvidence.domSignal = ctx.domSuggestedLive.text || ctx.domSuggestedLive.reason;
    }

    const liveSignal = (ctx.domSuggestedLive && ctx.domSuggestedLive.signal) ||
                       (ctx.classifyResult && (ctx.classifyResult.signal || (ctx.classifyResult.domEvidence && ctx.classifyResult.domEvidence.signal))) ||
                       null;

    report.classify = ctx.classifyResult
      ? {
          category: effectiveCategory,
          signal: liveSignal,
          categoryEnabled: isCategoryOn,
          foldMode: foldMode,
          unitId: ctx.classifyResult.unitId,
          unitTypename: ctx.classifyResult.unitTypename,
          reason: ctx.effectiveReason,
          evidence: normalizedEvidence,
          moduleName: ctx.classifyResult.moduleName
        }
      : null;

    // Dual-track: (1) memory (Props & Relay store in memory), (2) dom (live rendered DOM)
    report.memory = {
      enrichment: ctx.enrichment,
      relayStatus: ctx.relayStatus
    };

    const domLive = ctx.domLive;
    const cached = ctx.cached;
    report.dom = {
      actor: (domLive && domLive.actor) || (cached && cached.actorName) || null,
      snippet: (domLive && domLive.snippet) || (cached && cached.snippetText) || null,
      group: (domLive && domLive.group) || (cached && cached.groupName) || null,
      postUrl: ctx.postUrl || null,
      adUrl: ctx.adUrl || null,
      media: (domLive && domLive.media) || null,
      urls: (domLive && domLive.urls) || null,
      title: (domLive && domLive.title) || null,
      reshare: (domLive && domLive.reshare) || null,
      textCandidates: (domLive && domLive.textCandidates) || [],
      suggested: ctx.domSuggestedLive || null,
      debug: (ctx.domSuggestedLive && ctx.domSuggestedLive.debug) || null
    };

    report.payload = {
      feedUnit: {
        post_id: ctx.postId,
        debug_info: ctx.feedUnit && typeof ctx.feedUnit.debug_info === 'string' ? (ctx.feedUnit.debug_info.length > 200 ? ctx.feedUnit.debug_info.slice(0, 200) + '…' : ctx.feedUnit.debug_info) : null,
        th_dat_spo: ctx.feedUnit && ctx.feedUnit.th_dat_spo !== undefined ? ctx.feedUnit.th_dat_spo : null
      },
      payloadKeys: ctx.payloadKeys && ctx.payloadKeys.length ? ctx.payloadKeys : null,
      feedUnitKeys: ctx.feedUnitKeys && ctx.feedUnitKeys.length ? ctx.feedUnitKeys : null,
      childrenKeys: ctx.childrenKeys && ctx.childrenKeys.length ? ctx.childrenKeys : null
    };

    // Diagnostic signals found in props
    report.signals = ctx.signals;

    // The exact Relay paths the classifier tried for THIS unit
    report.relayReads = Array.isArray(ctx.relayReads) && ctx.relayReads.length ? ctx.relayReads : null;

    report.recordKeys = ctx.recordKeys;

    // Fold-scope context (STRATEGY.md decision #26): was folding restricted for this
    // report, what is the runtime verdict, and on which path.
    report.scope = resolveProbeScope();

    return serializeReport(report);
  }

  function buildProxyProbeReport(props, classifyResult, relayReads, renderedAt) {
    const ctx = collectProbeContext(props, classifyResult, relayReads, null, renderedAt);
    const categorySetting = resolveCategorySetting(ctx);

    let cleanClassify = null;
    if (ctx.classifyResult) {
      cleanClassify = {
        category: ctx.effectiveCategory,
        unitTypename: ctx.classifyResult.unitTypename,
        reason: ctx.effectiveReason
      };
      const liveSignal = (ctx.classifyResult.signal || (ctx.classifyResult.domEvidence && ctx.classifyResult.domEvidence.signal)) || null;
      if (liveSignal) {
        cleanClassify.signal = liveSignal;
      }
      const rawEvidence = ctx.classifyResult.evidence ? Object.assign({}, ctx.classifyResult.evidence) : null;
      if (rawEvidence && rawEvidence.id && ctx.classifyResult.unitId && rawEvidence.id === ctx.classifyResult.unitId) {
        delete rawEvidence.id;
      }
      if (rawEvidence) {
        const cleanEvidence = {};
        for (const [k, v] of Object.entries(rawEvidence)) {
          if (v !== null && v !== undefined) {
            cleanEvidence[k] = v;
          }
        }
        if (Object.keys(cleanEvidence).length > 0) {
          cleanClassify.evidence = cleanEvidence;
        }
      }
    }

    const cleanMemory = {};
    if (ctx.enrichment) {
      cleanMemory.enrichment = ctx.enrichment;
    }
    if (ctx.relayStatus) {
      const rs = {
        isReady: ctx.relayStatus.isReady,
        sourceCount: ctx.relayStatus.sourceCount
      };
      if (ctx.relayStatus.lastError) {
        rs.lastError = ctx.relayStatus.lastError;
      }
      cleanMemory.relayStatus = rs;
    }

    const cleanPayload = {
      feedUnit: {
        post_id: ctx.postId
      }
    };
    if (ctx.feedUnit && typeof ctx.feedUnit.debug_info === 'string' && ctx.feedUnit.debug_info) {
      cleanPayload.feedUnit.debug_info = ctx.feedUnit.debug_info.length > 200 ? ctx.feedUnit.debug_info.slice(0, 200) + '…' : ctx.feedUnit.debug_info;
    }
    if (ctx.feedUnit && ctx.feedUnit.th_dat_spo !== null && ctx.feedUnit.th_dat_spo !== undefined) {
      cleanPayload.feedUnit.th_dat_spo = ctx.feedUnit.th_dat_spo;
    }
    if (ctx.payloadKeys && ctx.payloadKeys.length) cleanPayload.payloadKeys = ctx.payloadKeys;
    if (ctx.feedUnitKeys && ctx.feedUnitKeys.length) cleanPayload.feedUnitKeys = ctx.feedUnitKeys;
    if (ctx.childrenKeys && ctx.childrenKeys.length) cleanPayload.childrenKeys = ctx.childrenKeys;

    let activeRelayReads = null;
    if (Array.isArray(relayReads) && relayReads.length > 0) {
      activeRelayReads = relayReads.filter((item) => {
        if (typeof item === 'string') return true;
        return item && item.value !== null && item.value !== undefined;
      });
    }

    const proxyReport = {
      // Part 1: 環境 (Environment)
      schemaVersion: PROBE_SCHEMA_VERSION,
      type: 'proxy',
      dietMode: ctx.activeMode,
      scope: resolveProbeScope(),
      at: {
        rendered: ctx.renderIso,
        probed: ctx.nowIso
      },

      // Part 2: 輸入 (Input Context)
      feedPosition: ctx.feedPosition,
      postId: ctx.postId || null,
      ...(ctx.props && ctx.props.moduleName ? { moduleName: ctx.props.moduleName } : {}),
      unitId: ctx.unitKey || null,

      // Part 3: 分類與策略結果 (Classification & Policy)
      classify: cleanClassify,
      categorySetting: categorySetting,

      // Part 4: 底層除錯數據 (Raw Diagnostics)
      memory: cleanMemory,
      payload: cleanPayload
    };

    if (ctx.props && ctx.props.entryCategory !== null && ctx.props.entryCategory !== undefined) proxyReport.entryCategory = ctx.props.entryCategory;
    if (ctx.signals && ctx.signals.length) proxyReport.signals = ctx.signals;
    if (activeRelayReads && activeRelayReads.length) proxyReport.relayReads = activeRelayReads;
    if (ctx.recordKeys && ctx.recordKeys.length) proxyReport.recordKeys = ctx.recordKeys;
    if (ctx.postUrl || ctx.adUrl) {
      proxyReport.url = {};
      if (ctx.postUrl) proxyReport.url.post = ctx.postUrl;
      if (ctx.adUrl) proxyReport.url.ad = ctx.adUrl;
    }

    // Session-level module drift snapshot: did the hard-coded FEED_UNIT_MODULES names
    // still match Facebook's loader? (FBDietProxy.getModuleHealth / FBDietFold.checkModuleDrift)
    try {
      const proxy = window.FBDietProxy;
      if (proxy && typeof proxy.getModuleHealth === 'function') {
        const health = proxy.getModuleHealth();
        const fold = window.FBDietFold;
        const verdict = fold && typeof fold.checkModuleDrift === 'function' ? fold.checkModuleDrift() : null;
        const snapshot = {
          dCalls: health.dCalls,
          registered: health.registered,
          seen: health.seen,
          patched: health.patched,
          suspected: Boolean(verdict && verdict.suspected)
        };
        if (health.unseen && health.unseen.length) snapshot.unseen = health.unseen;
        proxyReport.moduleHealth = snapshot;
      }
    } catch (e) {}

    return serializeReport(proxyReport);
  }

  function buildDomProbeReport(container, props, classifyResult, renderedAt) {
    const ctx = collectProbeContext(props, classifyResult, null, container, renderedAt);

    const liveUrls = (ctx.domLive && ctx.domLive.urls) || {};
    let cleanUrls = null;
    if (liveUrls.synthesized) {
      cleanUrls = cleanUrls || {};
      cleanUrls.synthesized = liveUrls.synthesized;
    }
    const primaryUrl = (ctx.domLive && ctx.domLive.postUrl) || liveUrls.primary || null;
    if (primaryUrl) {
      cleanUrls = cleanUrls || {};
      cleanUrls.primary = primaryUrl;
    }

    const domLive = ctx.domLive;
    const domReport = {
      // Part 1: 環境 (Environment)
      schemaVersion: PROBE_SCHEMA_VERSION,
      type: 'dom',
      dietMode: ctx.activeMode,
      scope: resolveProbeScope(),
      at: {
        rendered: ctx.renderIso,
        probed: ctx.nowIso
      },

      // Part 2: 輸入 (Input Context)
      feedPosition: ctx.feedPosition,
      postId: ctx.postId || null,
      ...(ctx.moduleName ? { moduleName: ctx.moduleName } : {}),
      unitId: ctx.unitKey || null,

      // Part 3: 已過濾結構化資料 (Filtered / Extracted)
      extracted: {
        ...(cleanUrls ? { urls: cleanUrls } : {}),
        ...((domLive && domLive.actor) ? { actor: domLive.actor } : {}),
        ...((domLive && domLive.group) ? { group: domLive.group } : {}),
        ...((domLive && domLive.title) ? { title: domLive.title } : {}),
        ...((domLive && domLive.snippet) ? { snippet: domLive.snippet } : {}),
        ...((domLive && domLive.media) ? { media: domLive.media } : {}),
        ...((domLive && domLive.reshare) ? { reshare: domLive.reshare } : {}),
        ...(ctx.domSuggestedLive ? { suggested: ctx.domSuggestedLive } : {})
      }
    };

    return serializeReport(domReport);
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
      const doc = (typeof document !== 'undefined' ? document : null) || (typeof window !== 'undefined' && window.document ? window.document : null);
      if (doc && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('click', onOutsideProbeClick, true);
      }
      if (popup.classList && typeof popup.classList.add === 'function') {
        popup.classList.add('fb-diet-probe-popup-fadeout');
      }
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

  function popupRow(doc, text) {
    const row = doc.createElement('div');
    row.className = 'fb-diet-probe-popup-row';
    row.textContent = text;
    return row;
  }

  function popupCopiedFooter(doc, label) {
    const spacer = doc.createElement('div');
    spacer.className = 'fb-diet-probe-popup-spacer';
    return [spacer, popupRow(doc, '已複製 ' + label + ' 診斷 JSON 到剪貼簿 (Copied)')];
  }

  function renderDomPopup(doc, popup, report) {
    const modeStr = (report && (report.dietMode || report.mode) ? (report.dietMode || report.mode).toUpperCase() : 'FULL');
    const ext = (report && report.extracted) || report || {};

    popup.appendChild(popupRow(doc, 'DOM Probe (' + modeStr + ')'));

    if (ext.actor) {
      popup.appendChild(popupRow(doc, 'Author: ' + ext.actor + (ext.group ? ' · Group: ' + ext.group : '')));
    }

    if (ext.title && ext.title.text) {
      popup.appendChild(popupRow(doc, 'Title: ' + (ext.title.text.length > 40 ? ext.title.text.slice(0, 40) + '…' : ext.title.text)));
    }

    if (ext.snippet) {
      popup.appendChild(popupRow(doc, 'Snippet: ' + (ext.snippet.length > 40 ? ext.snippet.slice(0, 40) + '…' : ext.snippet)));
    }

    if (ext.media) {
      popup.appendChild(popupRow(doc, 'Media: ' + ext.media));
    }

    const targetUrl = ext.urls && (ext.urls.synthesized || ext.urls.primary || ext.urls.raw);
    if (targetUrl) {
      const linkRow = doc.createElement('div');
      linkRow.className = 'fb-diet-probe-popup-row';
      const linkPrefix = doc.createElement('span');
      linkPrefix.textContent = 'Link: ';
      linkRow.appendChild(linkPrefix);
      const anchor = doc.createElement('a');
      anchor.href = targetUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = targetUrl.length > 50 ? targetUrl.slice(0, 50) + '…' : targetUrl;
      if (anchor.style) {
        anchor.style.color = '#60a5fa';
        anchor.style.textDecoration = 'underline';
        anchor.style.cursor = 'pointer';
      }
      anchor.title = targetUrl;
      if (typeof anchor.addEventListener === 'function') {
        anchor.addEventListener('click', (e) => {
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        });
      }
      linkRow.appendChild(anchor);
      popup.appendChild(linkRow);
    }

    const footer = popupCopiedFooter(doc, 'DOM');
    footer.forEach((node) => popup.appendChild(node));
  }

  function renderProxyPopup(doc, popup, report, classifyResult, props) {
    const modeStr = (report && (report.dietMode || report.mode) ? (report.dietMode || report.mode).toUpperCase() : 'FULL');

    const category = (report && report.classify && report.classify.category)
      || (report && report.categorySetting && report.categorySetting.category)
      || (classifyResult && classifyResult.category)
      || (props && props.entryCategory)
      || 'regular';
    const reason = (report && report.classify && report.classify.reason)
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

    const catSetting = report && report.categorySetting;
    const statusText = catSetting ? (catSetting.enabled ? 'ON (' + catSetting.foldMode + ')' : 'OFF') : 'OFF';

    popup.appendChild(popupRow(doc, 'Mode: ' + modeStr + ' · Filter: ' + statusText));
    popup.appendChild(popupRow(doc, 'Category: ' + groupMeta.badgeText + ' (' + category + ')'));
    popup.appendChild(popupRow(doc, 'Signal: ' + reason));
    popup.appendChild(popupRow(doc, 'Source: ' + evidenceText));

    if (report && report.scope) {
      popup.appendChild(popupRow(doc, 'Scope: ' + (report.scope.allowed ? 'home/search/marketplace' : 'groups/profile')));
    }

    const postUrl = report && report.url && (report.url.post || report.url.ad);
    if (postUrl) {
      popup.appendChild(popupRow(doc, 'Link: ' + (postUrl.length > 50 ? postUrl.slice(0, 50) + '…' : postUrl)));
    }

    const footer = popupCopiedFooter(doc, 'Proxy');
    footer.forEach((node) => popup.appendChild(node));
  }

  function showProbePopup(holder, classifyResult, props, report, mode) {
    try {
      const doc = (typeof document !== 'undefined' ? document : null)
        || (typeof window !== 'undefined' && window.document ? window.document : null)
        || (holder && holder.ownerDocument ? holder.ownerDocument : null);
      if (!holder || !doc || typeof doc.createElement !== 'function') return;

      closeActiveProbePopup();

      const popup = doc.createElement('div');
      popup.className = 'fb-diet-probe-popup';
      popup.title = '點擊外部可關閉提示 (Click outside to dismiss)';

      if (mode === 'dom') {
        renderDomPopup(doc, popup, report);
      } else {
        renderProxyPopup(doc, popup, report, classifyResult, props);
      }

      holder.appendChild(popup);
      activeProbePopup = popup;

      // Close on subsequent outside click
      setTimeout(() => {
        if (activeProbePopup === popup && doc && typeof doc.addEventListener === 'function') {
          doc.addEventListener('click', onOutsideProbeClick, true);
        }
      }, 0);
    } catch (e) {
      // Non-fatal
    }
  }

  /**
   * Wraps the unit's render output in a relative holder; the dual probe buttons
   * (⚡ Proxy and 🔍 DOM) are appended when probe mode is on.
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

      const onProxyClick = (event) => {
        try {
          if (event) {
            if (typeof event.stopPropagation === 'function') event.stopPropagation();
            if (typeof event.preventDefault === 'function') event.preventDefault();
          }
        } catch (e) {}

        const btn = event && (event.currentTarget || event.target);
        const holder = btn && typeof btn.closest === 'function'
          ? btn.closest('.fb-diet-probe-holder')
          : (btn ? btn.parentElement : null);

        const liveProbe = buildProxyProbeReport(props, classifyResult, relayReads, renderedAt);
        const reportText = liveProbe.text;

        try {
          console.info('[FB Diet][Probe] Copied PROXY diagnostics to clipboard.');
        } catch (e) {}
        copyProbeReport(reportText);

        try {
          if (holder) showProbePopup(holder, classifyResult, props, liveProbe.report, 'proxy');
        } catch (e) {}
      };

      const onDomClick = (event) => {
        try {
          if (event) {
            if (typeof event.stopPropagation === 'function') event.stopPropagation();
            if (typeof event.preventDefault === 'function') event.preventDefault();
          }
        } catch (e) {}

        const btn = event && (event.currentTarget || event.target);
        const holder = btn && typeof btn.closest === 'function'
          ? btn.closest('.fb-diet-probe-holder')
          : (btn ? btn.parentElement : null);
        const container = holder
          ? (holder.querySelector('.fb-diet-fold-hidden, .fb-diet-expand-body') || holder)
          : null;

        const liveProbe = buildDomProbeReport(container, props, classifyResult, renderedAt);
        const reportText = liveProbe.text;

        try {
          console.info('[FB Diet][Probe] Copied DOM diagnostics to clipboard.');
        } catch (e) {}
        copyProbeReport(reportText);

        try {
          if (holder) showProbePopup(holder, classifyResult, props, liveProbe.report, 'dom');
        } catch (e) {}
      };

      const createEl = (ui && ui.createEl) || function fallbackCreateEl(type, p, c) {
        return window.FBDietProxy ? window.FBDietProxy.createElement(React, type, p, c) : null;
      };

      const buttonProxy = createEl(
        'button',
        { className: 'fb-diet-probe-btn fb-diet-probe-btn-proxy', type: 'button', title: 'FB Diet: copy Proxy/Relay diagnostics (JSON)', onClick: onProxyClick },
        ['⚡']
      );
      const buttonDom = createEl(
        'button',
        { className: 'fb-diet-probe-btn fb-diet-probe-btn-dom', type: 'button', title: 'FB Diet: copy DOM diagnostics (JSON)', onClick: onDomClick },
        ['🔍']
      );
      const buttonGroup = createEl('div', { className: 'fb-diet-probe-group' }, [buttonProxy, buttonDom]);
      return createEl('div', { className: 'fb-diet-probe-holder' }, [buttonGroup, element]);
    } catch (e) {
      return element;
    }
  }

  return {
    PROBE_MAX_CHARS,
    SCHEMA_VERSION: PROBE_SCHEMA_VERSION,
    findDiagnosticSignals,
    buildUnitProbeReport,
    buildProxyProbeReport,
    buildDomProbeReport,
    promptFallbackCopy,
    copyProbeReport,
    closeActiveProbePopup,
    showProbePopup,
    addProbe
  };
})();
