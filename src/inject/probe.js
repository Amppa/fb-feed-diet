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

  function buildUnitProbeReport(props, classifyResult, relayReads, container, renderedAt) {
    const feedUnit = props.payload && props.payload.feedUnit;
    const nowIso = new Date().toISOString();
    const renderIso = renderedAt || nowIso;

    const unitKey = classifyResult && (classifyResult.unitId || (classifyResult.evidence && classifyResult.evidence.id));
    const ui = window.FBDietUI;
    const cached = unitKey && ui && ui.titleBarCache ? ui.titleBarCache.get(unitKey) : null;
    const isMediaGroup = classifyResult && (classifyResult.category === 'reels' || classifyResult.category === 'stories' || classifyResult.category === 'suggestedGroup');
    const domMetadata = window.FBDietDOMMetadata;
    const domLive = container && domMetadata && typeof domMetadata.collect === 'function'
      ? domMetadata.collect(container, isMediaGroup, relayPostIdHint(feedUnit))
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

    const postId = (relayPostIdHint(feedUnit) || {}).postId || null;
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

    const baseCategory = (classifyResult && classifyResult.category) || (props && props.entryCategory) || 'regular';
    const isAlreadyClassified = baseCategory && baseCategory !== 'regular';
    const isDomSuggested = !isAlreadyClassified && Boolean(domSuggestedLive && domSuggestedLive.isSuggested);
    const effectiveCategory = isDomSuggested ? 'suggested' : baseCategory;
    const effectiveReason = isDomSuggested ? (domSuggestedLive.reason || 'dom:suggested') : (classifyResult ? classifyResult.reason : null);

    const settingKey = (classifyModule && classifyModule.SETTING_BY_CATEGORY && classifyModule.SETTING_BY_CATEGORY[effectiveCategory]) || null;
    let foldMode = 'off';
    if (bridge && typeof bridge.getFoldMode === 'function') {
      foldMode = bridge.getFoldMode(effectiveCategory);
    } else if (classifyModule && typeof classifyModule.getCategoryFoldMode === 'function') {
      foldMode = classifyModule.getCategoryFoldMode(effectiveCategory, currentSettings);
    }
    const isCategoryOn = foldMode !== 'off';

    const activeMode = currentSettings ? (currentSettings.dietMode || 'full') : 'full';

    const report = {
      schemaVersion: PROBE_SCHEMA_VERSION,
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
      urls: (domLive && domLive.urls) || null,
      title: (domLive && domLive.title) || null,
      reshare: (domLive && domLive.reshare) || null,
      textCandidates: (domLive && domLive.textCandidates) || [],
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
    report.scope = resolveProbeScope();

    let text = null;
    try {
      text = JSON.stringify(report, null, 2);
    } catch (e) {
      text = '{"error":"probe serialization failed: ' + String(e && e.message ? e.message : e) + '"}';
    }
    if (text.length > PROBE_MAX_CHARS) text = text.slice(0, PROBE_MAX_CHARS) + '\n…[truncated]';
    return { text, report };
  }

  function buildProxyProbeReport(props, classifyResult, relayReads, renderedAt) {
    const full = buildUnitProbeReport(props, classifyResult, relayReads, null, renderedAt);
    const rep = full.report;
    const feedUnit = props && props.payload && props.payload.feedUnit;
    const postId = (feedUnit && (feedUnit.post_id || feedUnit.clip_id || (feedUnit.story && feedUnit.story.post_id) || feedUnit.mf_story_key)) || null;
    const unitId = classifyResult && (classifyResult.unitId || (classifyResult.evidence && classifyResult.evidence.id));
    const feedPosition = props && props.payload && typeof props.payload.position === 'number' ? props.payload.position : null;

    let cleanClassify = null;
    if (rep.classify) {
      cleanClassify = {
        category: rep.classify.category,
        unitTypename: rep.classify.unitTypename,
        reason: rep.classify.reason
      };
      if (rep.classify.signal) {
        cleanClassify.signal = rep.classify.signal;
      }
      if (rep.classify.evidence) {
        const cleanEvidence = {};
        for (const [k, v] of Object.entries(rep.classify.evidence)) {
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
    if (rep.memory) {
      if (rep.memory.enrichment) {
        cleanMemory.enrichment = rep.memory.enrichment;
      }
      if (rep.memory.relayStatus) {
        const rs = {
          isReady: rep.memory.relayStatus.isReady,
          sourceCount: rep.memory.relayStatus.sourceCount
        };
        if (rep.memory.relayStatus.lastError) {
          rs.lastError = rep.memory.relayStatus.lastError;
        }
        cleanMemory.relayStatus = rs;
      }
    }

    const cleanPayload = {};
    if (rep.payload) {
      if (rep.payload.feedUnit) {
        const fu = { post_id: postId };
        if (rep.payload.feedUnit.debug_info) fu.debug_info = rep.payload.feedUnit.debug_info;
        if (rep.payload.feedUnit.th_dat_spo !== null && rep.payload.feedUnit.th_dat_spo !== undefined) fu.th_dat_spo = rep.payload.feedUnit.th_dat_spo;
        cleanPayload.feedUnit = fu;
      }
      if (rep.payload.payloadKeys && rep.payload.payloadKeys.length) cleanPayload.payloadKeys = rep.payload.payloadKeys;
      if (rep.payload.feedUnitKeys && rep.payload.feedUnitKeys.length) cleanPayload.feedUnitKeys = rep.payload.feedUnitKeys;
      if (rep.payload.childrenKeys && rep.payload.childrenKeys.length) cleanPayload.childrenKeys = rep.payload.childrenKeys;
    }

    let activeRelayReads = null;
    if (Array.isArray(rep.relayReads) && rep.relayReads.length > 0) {
      activeRelayReads = rep.relayReads.filter((item) => {
        if (typeof item === 'string') return true;
        return item && item.value !== null && item.value !== undefined;
      });
    }

    const proxyReport = {
      // Part 1: 環境 (Environment)
      schemaVersion: PROBE_SCHEMA_VERSION,
      type: 'proxy',
      dietMode: rep.dietMode,
      scope: rep.scope,
      at: rep.at,

      // Part 2: 輸入 (Input Context)
      feedPosition: feedPosition,
      postId: postId || null,
      ...(rep.moduleName ? { moduleName: rep.moduleName } : {}),
      unitId: unitId || null,

      // Part 3: 分類與策略結果 (Classification & Policy)
      classify: cleanClassify,
      categorySetting: rep.categorySetting,

      // Part 4: 底層除錯數據 (Raw Diagnostics)
      memory: cleanMemory,
      payload: cleanPayload
    };

    if (rep.entryCategory !== undefined) proxyReport.entryCategory = rep.entryCategory;
    if (rep.signals && rep.signals.length) proxyReport.signals = rep.signals;
    if (activeRelayReads && activeRelayReads.length) proxyReport.relayReads = activeRelayReads;
    if (rep.recordKeys && rep.recordKeys.length) proxyReport.recordKeys = rep.recordKeys;
    if (rep.url && (rep.url.post || rep.url.ad)) {
      proxyReport.url = {};
      if (rep.url.post) proxyReport.url.post = rep.url.post;
      if (rep.url.ad) proxyReport.url.ad = rep.url.ad;
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

    let text = null;
    try {
      text = JSON.stringify(proxyReport, null, 2);
    } catch (e) {
      text = '{"error":"proxy probe serialization failed: ' + String(e && e.message ? e.message : e) + '"}';
    }
    if (text.length > PROBE_MAX_CHARS) text = text.slice(0, PROBE_MAX_CHARS) + '\n…[truncated]';
    return { text, report: proxyReport };
  }

  function buildDomProbeReport(container, props, classifyResult, renderedAt) {
    const nowIso = new Date().toISOString();
    const renderIso = renderedAt || nowIso;
    const feedUnit = props && props.payload && props.payload.feedUnit;
    const postId = (relayPostIdHint(feedUnit) || {}).postId || null;
    const unitId = classifyResult && (classifyResult.unitId || (classifyResult.evidence && classifyResult.evidence.id));
    const feedPosition = props && props.payload && typeof props.payload.position === 'number' ? props.payload.position : null;
    const moduleName = (props && props.moduleName) || (classifyResult && classifyResult.moduleName) || null;

    const extVersion = (typeof window !== 'undefined' && window.FB_DIET_DEFAULTS && window.FB_DIET_DEFAULTS.VERSION)
      || (typeof globalThis !== 'undefined' && globalThis.FB_DIET_DEFAULTS && globalThis.FB_DIET_DEFAULTS.VERSION);
    const bridge = window.FBDietBridge;
    const currentSettings = bridge && typeof bridge.getSettings === 'function' ? bridge.getSettings() : null;
    const activeMode = currentSettings ? (currentSettings.dietMode || 'full') : 'full';
    const scope = resolveProbeScope();

    const isMediaGroup = classifyResult && (classifyResult.category === 'reels' || classifyResult.category === 'stories' || classifyResult.category === 'suggestedGroup');
    const domMetadata = window.FBDietDOMMetadata;
    const domLive = container && domMetadata && typeof domMetadata.collect === 'function'
      ? domMetadata.collect(container, isMediaGroup, relayPostIdHint(feedUnit))
      : null;

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

    const liveUrls = (domLive && domLive.urls) || {};
    let cleanUrls = null;
    if (liveUrls.synthesized) {
      cleanUrls = cleanUrls || {};
      cleanUrls.synthesized = liveUrls.synthesized;
    }
    const primaryUrl = (domLive && domLive.postUrl) || liveUrls.primary || null;
    if (primaryUrl) {
      cleanUrls = cleanUrls || {};
      cleanUrls.primary = primaryUrl;
    }

    const domReport = {
      // Part 1: 環境 (Environment)
      schemaVersion: PROBE_SCHEMA_VERSION,
      type: 'dom',
      dietMode: activeMode,
      scope: scope,
      at: {
        rendered: renderIso,
        probed: nowIso
      },

      // Part 2: 輸入 (Input Context)
      feedPosition: feedPosition,
      postId: postId || null,
      ...(moduleName ? { moduleName } : {}),
      unitId: unitId || null,

      // Part 3: 已過濾結構化資料 (Filtered / Extracted)
      extracted: {
        ...(cleanUrls ? { urls: cleanUrls } : {}),
        ...((domLive && domLive.actor) ? { actor: domLive.actor } : {}),
        ...((domLive && domLive.group) ? { group: domLive.group } : {}),
        ...((domLive && domLive.title) ? { title: domLive.title } : {}),
        ...((domLive && domLive.snippet) ? { snippet: domLive.snippet } : {}),
        ...((domLive && domLive.media) ? { media: domLive.media } : {}),
        ...((domLive && domLive.reshare) ? { reshare: domLive.reshare } : {}),
        ...(domSuggestedLive ? { suggested: domSuggestedLive } : {})
      }
    };

    let text = null;
    try {
      text = JSON.stringify(domReport, null, 2);
    } catch (e) {
      text = '{"error":"dom probe serialization failed: ' + String(e && e.message ? e.message : e) + '"}';
    }
    if (text.length > PROBE_MAX_CHARS) text = text.slice(0, PROBE_MAX_CHARS) + '\n…[truncated]';
    return { text, report: domReport };
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

      const modeStr = (report && (report.dietMode || report.mode) ? (report.dietMode || report.mode).toUpperCase() : 'FULL');

      if (mode === 'dom') {
        const ext = (report && report.extracted) || report || {};
        // DOM Probe Popup
        const headerRow = doc.createElement('div');
        headerRow.className = 'fb-diet-probe-popup-row';
        headerRow.textContent = 'DOM Probe (' + modeStr + ')';
        popup.appendChild(headerRow);

        if (ext.actor) {
          const actorRow = doc.createElement('div');
          actorRow.className = 'fb-diet-probe-popup-row';
          actorRow.textContent = 'Author: ' + ext.actor + (ext.group ? ' · Group: ' + ext.group : '');
          popup.appendChild(actorRow);
        }

        if (ext.title && ext.title.text) {
          const titleRow = doc.createElement('div');
          titleRow.className = 'fb-diet-probe-popup-row';
          titleRow.textContent = 'Title: ' + (ext.title.text.length > 40 ? ext.title.text.slice(0, 40) + '…' : ext.title.text);
          popup.appendChild(titleRow);
        }

        if (ext.snippet) {
          const snipRow = doc.createElement('div');
          snipRow.className = 'fb-diet-probe-popup-row';
          snipRow.textContent = 'Snippet: ' + (ext.snippet.length > 40 ? ext.snippet.slice(0, 40) + '…' : ext.snippet);
          popup.appendChild(snipRow);
        }

        if (ext.media) {
          const mediaRow = doc.createElement('div');
          mediaRow.className = 'fb-diet-probe-popup-row';
          mediaRow.textContent = 'Media: ' + ext.media;
          popup.appendChild(mediaRow);
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

        const spacer = doc.createElement('div');
        spacer.className = 'fb-diet-probe-popup-spacer';
        popup.appendChild(spacer);

        const copiedRow = doc.createElement('div');
        copiedRow.className = 'fb-diet-probe-popup-row';
        copiedRow.textContent = '已複製 DOM 診斷 JSON 到剪貼簿 (Copied)';
        popup.appendChild(copiedRow);
      } else {
        // Proxy Probe Popup
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

        const modeRow = doc.createElement('div');
        modeRow.className = 'fb-diet-probe-popup-row';
        modeRow.textContent = 'Mode: ' + modeStr + ' · Filter: ' + statusText;
        popup.appendChild(modeRow);

        const catRow = doc.createElement('div');
        catRow.className = 'fb-diet-probe-popup-row';
        catRow.textContent = 'Category: ' + groupMeta.badgeText + ' (' + category + ')';
        popup.appendChild(catRow);

        const signalRow = doc.createElement('div');
        signalRow.className = 'fb-diet-probe-popup-row';
        signalRow.textContent = 'Signal: ' + reason;
        popup.appendChild(signalRow);

        const sourceRow = doc.createElement('div');
        sourceRow.className = 'fb-diet-probe-popup-row';
        sourceRow.textContent = 'Source: ' + evidenceText;
        popup.appendChild(sourceRow);

        if (report && report.scope) {
          const scopeRow = doc.createElement('div');
          scopeRow.className = 'fb-diet-probe-popup-row';
          scopeRow.textContent = 'Scope: ' + (report.scope.allowed ? 'home/search/marketplace' : 'groups/profile');
          popup.appendChild(scopeRow);
        }

        const postUrl = report && report.url && (report.url.post || report.url.ad);
        if (postUrl) {
          const linkRow = doc.createElement('div');
          linkRow.className = 'fb-diet-probe-popup-row';
          linkRow.textContent = 'Link: ' + (postUrl.length > 50 ? postUrl.slice(0, 50) + '…' : postUrl);
          popup.appendChild(linkRow);
        }

        const spacer = doc.createElement('div');
        spacer.className = 'fb-diet-probe-popup-spacer';
        popup.appendChild(spacer);

        const copiedRow = doc.createElement('div');
        copiedRow.className = 'fb-diet-probe-popup-row';
        copiedRow.textContent = '已複製 Proxy 診斷 JSON 到剪貼簿 (Copied)';
        popup.appendChild(copiedRow);
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
