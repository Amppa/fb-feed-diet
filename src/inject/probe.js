/**
 * FB Diet - Probe Diagnostics Module (MAIN world).
 * Public API: window.FBDietProbe
 */
window.FBDietProbe = (() => {
  'use strict';

  const PROBE_MAX_CHARS = 30000;
  // v6: store phase is `relay`, not `proxy` (v5 was last `proxy`).
  // store. // per docs/debugging.md
  const PROBE_SCHEMA_VERSION = 6;
  // Compaction depth bound; pathological values degrade to "kept whole".
  const PROBE_MAX_COMPACT_DEPTH = 12;
  // `$N` keys are Relay storage slots, not field names.
  const RELAY_PLACEHOLDER_KEY_RE = /^\$\d+$/;
  const defaults = window.FB_DIET_DEFAULTS || globalThis.FB_DIET_DEFAULTS || {};
  const keywords = defaults.KEYWORDS || {};
  const DIAGNOSTIC_KEYWORDS = Array.isArray(keywords.DIAGNOSTIC) ? keywords.DIAGNOSTIC : [];
  const UPPER_DIAGNOSTIC_KEYWORDS = DIAGNOSTIC_KEYWORDS
    .map(kw => (typeof kw === 'string' ? kw.toUpperCase() : ''))
    .filter(Boolean);

  // Report states current mode name, not retired stored value.
  function normalizeDetectionMode(value) {
    return typeof defaults.normalizeDetectionMode === 'function'
      ? defaults.normalizeDetectionMode(value)
      : 'relay';
  }

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
    const keywords = UPPER_DIAGNOSTIC_KEYWORDS;

    function walk(current, path, depth) {
      if (depth > 14 || current === null || current === undefined) return;
      if (typeof current === 'string') {
        const upper = current.toUpperCase();
        for (const kw of keywords) {
          if (upper.indexOf(kw) !== -1) {
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
    }
    return { restricted: scopeRestricted, allowed: scopeAllowed, path: scopePath };
  }

  /** Page locale from `<html lang>`. // per docs/debugging.md */
  function resolvePageLang() {
    try {
      const doc = (typeof window !== 'undefined' && window.document)
        || (typeof document !== 'undefined' ? document : null);
      return (doc && doc.documentElement && doc.documentElement.lang) || null;
    } catch (e) {
      return null;
    }
  }

  /** `explain` never returns null; missing/throw yields a named outcome. */
  function callExplain(detector, container, label) {
    if (!detector || typeof detector.explain !== 'function') {
      return { scanned: false, outcome: 'module_unavailable', outcomeReason: label + '_module_missing' };
    }
    if (!container) {
      return { scanned: false, outcome: 'not_scanned', outcomeReason: 'no_container' };
    }
    try {
      return detector.explain(container) || null;
    } catch (e) {
      return { scanned: true, outcome: 'scan_error', outcomeReason: String(e && e.message ? e.message : e) };
    }
  }

  /** Modules absent from `window`, reported only when non-empty. */
  function missingModuleList() {
    const expected = [
      'FBDietComet', 'FBDietRelay', 'FBDietRelayMetadata', 'FBDietRelayClassify', 'FBDietBridge',
      'FBDietDOMSurface', 'FBDietDOMSuggested', 'FBDietDOMSponsored', 'FBDietUI', 'FBDietProbe',
      'FBDietFold', 'FBDietDOMMetadata'
    ];
    const missing = expected.filter((name) => window[name] === undefined || window[name] === null);
    return missing.length ? missing : null;
  }

  /** Probe-owned store read for the report, independent of render path. // per STRATEGY.md §1 */
  function readDataEngineForReport(props) {
    const classify = window.FBDietRelayClassify;
    if (!classify || typeof classify.classify !== 'function') return null;
    try {
      const result = classify.classify(props && props.payload, {
        moduleName: (props && props.moduleName) || null,
        lastCmp: props && props.lastCmp
      });
      const relayReads = typeof classify.getLastRelayReads === 'function' ? classify.getLastRelayReads() : null;
      return { result: result, reads: relayReads };
    } catch (e) {
      return null;
    }
  }

  function relayPostIdHint(feedUnit) {
    const postId = (feedUnit && (feedUnit.post_id || feedUnit.clip_id || (feedUnit.story && feedUnit.story.post_id) || feedUnit.mf_story_key)) || null;
    return postId ? { postId } : null;
  }

  const TITLE_BAR_TEXT_MAX = 200;

  function capTitleBarText(value) {
    if (typeof value !== 'string') return null;
    const collapsed = value.replace(/\s+/g, ' ').trim();
    if (!collapsed) return null;
    return collapsed.length > TITLE_BAR_TEXT_MAX
      ? collapsed.slice(0, TITLE_BAR_TEXT_MAX) + '…'
      : collapsed;
  }

  /** TitleBar preview; mirrors `TitleBar` in `ui.js`. */
  function collectTitleBarInfo(enrichment, domLive, cached, displayedTag) {
    const actorVal = (enrichment && enrichment.actor && enrichment.actor.name)
      || (domLive && domLive.actor)
      || (cached && cached.actorName)
      || null;
    const groupVal = (enrichment && enrichment.group && enrichment.group.name)
      || (domLive && domLive.group)
      || (cached && cached.groupName)
      || null;
    const fromEnrichment = enrichment && enrichment.content
      && (enrichment.content.message || enrichment.content.title);
    const rawMsg = fromEnrichment
      || (domLive && domLive.snippet)
      || (cached && cached.snippetText)
      || null;
    if (!actorVal && !groupVal && !rawMsg) return null;
    const source = fromEnrichment ? 'enrichment'
      : ((domLive && domLive.snippet) ? 'dom'
        : ((cached && cached.snippetText) ? 'cache' : null));

    let snippet = null;
    try {
      const domMeta = window.FBDietDOMMetadata;
      if (rawMsg && domMeta && typeof domMeta.cleanPostSnippet === 'function') {
        snippet = domMeta.cleanPostSnippet(rawMsg, actorVal, groupVal) || null;
      } else if (typeof rawMsg === 'string') {
        snippet = rawMsg.trim() || null;
      }
    } catch (e) {
      snippet = null;
    }
    if (!snippet) {
      try {
        const media = enrichment && enrichment.media;
        if (media && media.hasVideo) snippet = '🎬 [影片]';
        else if (media && (media.count > 0 || media.isMultiImage)) snippet = media.isMultiImage ? '📷 [多張相片]' : '📷 [相片]';
        else if (enrichment && enrichment.content && enrichment.content.callToAction) snippet = '👉 [' + enrichment.content.callToAction + ']';
      } catch (e) {}
    }

    const parts = [];
    if (displayedTag) parts.push('[' + displayedTag + ']');
    if (groupVal) parts.push('[' + groupVal + ']');
    if (actorVal) parts.push(actorVal + ':');
    if (snippet) parts.push(snippet);
    const text = parts.length ? capTitleBarText(parts.join(' ')) : null;

    return compact({
      source: source,
      author: actorVal,
      group: groupVal,
      text: text
    });
  }

  /** Shared live collection so report builders cannot drift. */
  function collectProbeContext(props, classifyResult, relayReads, container, renderedAt, holder) {
    const now = new Date();
    const nowIso = now.toISOString();
    const renderIso = renderedAt || nowIso;
    let probeAgeMs = null;
    if (renderedAt) {
      try {
        const diff = now.getTime() - new Date(renderedAt).getTime();
        if (!isNaN(diff) && diff >= 0) probeAgeMs = diff;
      } catch (e) {}
    }

    const feedUnit = props && props.payload && props.payload.feedUnit;
    const ui = window.FBDietUI;
    const bridge = window.FBDietBridge;
    const currentSettings = bridge && typeof bridge.getSettings === 'function' ? bridge.getSettings() : null;
    const activeMode = normalizeDetectionMode(currentSettings && currentSettings.dietMode);

    const unitKey = classifyResult && (classifyResult.unitId || (classifyResult.evidence && classifyResult.evidence.id));
    const cached = unitKey && ui && ui.titleBarCache ? ui.titleBarCache.get(unitKey) : null;

    const isMediaGroup = classifyResult && (classifyResult.category === 'reels' || classifyResult.category === 'stories' || classifyResult.category === 'suggestedGroup');
    const domMetadata = window.FBDietDOMMetadata;
    const domLive = container && domMetadata && typeof domMetadata.collect === 'function'
      ? domMetadata.collect(container, isMediaGroup, relayPostIdHint(feedUnit))
      : null;

    // `dom`-mode verdict `unitId` is not a record id; never hand it to the store read.
    const storeResult = classifyResult && classifyResult.source ? classifyResult.store : classifyResult;
    let enrichment = null;
    try {
      const metadata = window.FBDietRelayMetadata;
      if (storeResult && metadata && typeof metadata.collect === 'function') {
        enrichment = metadata.collect(storeResult, props);
      }
    } catch (e) {}

    const adUrl = (domLive && domLive.adUrl) || (cached && cached.adUrl) || (enrichment && enrichment.content && enrichment.content.permalink && enrichment.content.permalink.indexOf('/ads/') !== -1 ? enrichment.content.permalink : null);
    let postUrl = (domLive && domLive.postUrl) || (cached && cached.postUrl) || (enrichment && enrichment.content && enrichment.content.permalink && enrichment.content.permalink.indexOf('/ads/') === -1 ? enrichment.content.permalink : null);

    const postId = (relayPostIdHint(feedUnit) || {}).postId || null;
    const authorHandle = (enrichment && enrichment.actor && (enrichment.actor.username || enrichment.actor.id)) || null;
    if (!postUrl && postId && authorHandle) {
      postUrl = 'https://www.facebook.com/' + authorHandle + '/posts/' + postId;
    }

    const verdictCategory = (classifyResult && classifyResult.category) || null;
    const baseCategory = verdictCategory || (props && props.entryCategory) || 'regular';
    // Module-declared categories name no source (structural, not detected).
    const renderSource = (classifyResult && classifyResult.source) || null;
    // A live hit never becomes the verdict.

    const hadInitialDomEvidence = Boolean(classifyResult && classifyResult.domEvidence);
    // Seed the suggested block only from its own hit flag.
    let domSuggestedLive = (classifyResult && classifyResult.domEvidence && classifyResult.domEvidence.isSuggested)
      ? classifyResult.domEvidence
      : null;
    const detector = window.FBDietDOMSuggested;
    if ((!domSuggestedLive || !domSuggestedLive.debug) && container && detector && typeof detector.detect === 'function') {
      try {
        const live = detector.detect(container);
        if (live) {
          domSuggestedLive = domSuggestedLive ? Object.assign({}, live, domSuggestedLive) : live;
        }
      } catch (e) {}
    }

    // DOM sponsorship mirrors the suggested block; live re-scan fills gaps. // per STRATEGY.md §3.1
    let domSponsoredLive = (classifyResult && classifyResult.domEvidence && classifyResult.domEvidence.isSponsored)
      ? classifyResult.domEvidence
      : null;
    const sponsorDetector = window.FBDietDOMSponsored;
    if ((!domSponsoredLive || !domSponsoredLive.debug) && container && sponsorDetector && typeof sponsorDetector.detect === 'function') {
      try {
        const live = sponsorDetector.detect(container);
        if (live) domSponsoredLive = domSponsoredLive ? Object.assign({}, live, domSponsoredLive) : live;
      } catch (e) {}
    }

    // `explain` states why each detector answered, hits and misses alike.
    // `module_unavailable` means the extension was not reloaded.
    const suggestedExplanation = callExplain(detector, container, 'suggested');
    const sponsorExplanation = callExplain(sponsorDetector, container, 'sponsored');
    // Surface `explain` is the only read of tray markers/labels/link counts.
    const surfaceExplanation = callExplain(window.FBDietDOMSurface, container, 'surface');

    // Surface evidence presence is the attribution.
    const domSurfaceEvidence = (classifyResult && classifyResult.domEvidence && classifyResult.domEvidence.isSurface)
      ? classifyResult.domEvidence
      : null;

    // Provenance is read from the render path, never re-derived here.
    // Live hits populate `dom.extracted` only; they never decide the verdict.
    const effectiveCategory = baseCategory;
    const effectiveReason = classifyResult ? classifyResult.reason : null;

    // Attribution is read from the render path; `entry` source reports none.
    const detectionSource = renderSource === 'entry' ? null : renderSource;

    // Reports what the mounted UI shows, which may differ from the verdict.
    const display = (classifyResult && classifyResult.display) || null;
    const displayNote = display && display.substituted
      ? 'The ' + activeMode + ' engine examined this unit and decided nothing, so it is displayed as ' + display.category + '.'
      : null;

    const probeHolder = holder
      || (container && container.closest && container.closest('.fb-diet-probe-holder'))
      || (container && container.parentElement)
      || container;
    const badgeEl = (probeHolder && probeHolder.querySelector && probeHolder.querySelector('.fb-diet-badge'))
      || (container && container.querySelector && container.querySelector('.fb-diet-badge'))
      || null;
    const displayedTag = badgeEl ? (badgeEl.textContent || '').trim() : null;
    let isFolded = null;
    if (probeHolder && probeHolder.querySelector) {
      isFolded = Boolean(
        probeHolder.querySelector('.fb-diet-fold-hidden')
        || (container && container.classList && container.classList.contains && container.classList.contains('fb-diet-fold-hidden'))
      );
    }

    const titleBar = collectTitleBarInfo(enrichment, domLive, cached, displayedTag);

    const payloadKeys = props && props.payload && typeof props.payload === 'object' ? Object.keys(props.payload) : null;
    const feedUnitKeys = feedUnit && typeof feedUnit === 'object' ? Object.keys(feedUnit) : null;
    const childrenProps = props && props.payload && props.payload.children && typeof props.payload.children === 'object'
      ? (props.payload.children.props || (Array.isArray(props.payload.children) && props.payload.children[0] ? props.payload.children[0].props : null))
      : null;
    const childrenKeys = childrenProps && typeof childrenProps === 'object' ? Object.keys(childrenProps) : null;

    return {
      nowIso,
      renderIso,
      probeAgeMs,
      props,
      classifyResult,
      hadInitialDomEvidence,
      detectionSource,
      displayNote,
      displayedTag,
      isFolded,
      titleBar,
      relayReads,
      feedUnit,
      bridge,
      currentSettings,
      activeMode,
      unitKey,
      cached,
      domLive,
      domSuggestedLive,
      domSponsoredLive,
      suggestedExplanation,
      sponsorExplanation,
      surfaceExplanation,
      domSurface: domSurfaceEvidence,
      enrichment,
      adUrl,
      postUrl,
      postId,
      effectiveCategory,
      effectiveReason,
      feedPosition: props && props.payload && typeof props.payload.position === 'number' ? props.payload.position : null,
      moduleName: (props && props.moduleName) || (classifyResult && classifyResult.moduleName) || null,
      signals: findDiagnosticSignals(props && props.payload, props && props.lastCmp),
      pageLang: resolvePageLang(),
      relayStatus: buildRelayStatus(),
      recordKeys: resolveRecordKeys(unitKey),
      payloadKeys,
      feedUnitKeys,
      childrenKeys
    };
  }

  /** Relay store health snapshot, shared by the unit and relay reports. */
  function buildRelayStatus() {
    let relayStatus = null;
    try {
      const relay = window.FBDietRelay;
      if (relay) {
        relayStatus = {
          isReady: typeof relay.isReady === 'function' ? relay.isReady() : false,
          sourceCount: typeof relay.getSourceCount === 'function' ? relay.getSourceCount() : 0,
          lastError: typeof relay.getLastError === 'function' ? relay.getLastError() : null,
          capture: typeof relay.getCaptureStats === 'function' ? relay.getCaptureStats() : null
        };
      }
    } catch (e) {}
    return relayStatus;
  }

  /** Drops unfired cue lists; `outcome` already carries the finding. // per docs/debugging.md */
  function trimUnfiredCues(explanation) {
    if (!explanation || !Array.isArray(explanation.cues)) return explanation || null;
    if (explanation.cues.some((cue) => cue && cue.fired)) return explanation;
    const trimmed = Object.assign({}, explanation);
    delete trimmed.cues;
    return trimmed;
  }

  /** Reports capture counters only when the capture did not get there. */
  function captureIsUnhealthy(relayStatus) {
    const capture = relayStatus && relayStatus.capture;
    if (!capture) return false;
    if (capture.applied === false) return true;
    if (!relayStatus.sourceCount) return true;
    if (relayStatus.lastError) return true;
    if (capture.shapeMismatch) return true;
    if (capture.alreadyWrapped || capture.alreadyPatched) return true;
    return false;
  }

  /** Relay record keys, dropping `$N` placeholders. */
  function resolveRecordKeys(unitKey) {
    let recordKeys = null;
    try {
      const relay = window.FBDietRelay;
      if (relay && typeof relay.describe === 'function' && unitKey) {
        const record = relay.describe(unitKey);
        if (record && typeof record === 'object') {
          const meaningful = Object.keys(record).filter((key) => !RELAY_PLACEHOLDER_KEY_RE.test(key));
          recordKeys = meaningful.length ? meaningful : null;
        }
      }
    } catch (e) {}
    return recordKeys;
  }

  /** Fold policy for the effective category: { category, key, enabled, foldMode }. */
  function resolveCategorySetting(ctx) {
    const classifyModule = window.FBDietRelayClassify;
    const settingKey = (defaults.SETTING_BY_CATEGORY && defaults.SETTING_BY_CATEGORY[ctx.effectiveCategory]) || null;
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

  /** Drops empty members recursively; `0`/`false` are values. // per STRATEGY.md §3.2 */
  function compactValue(value, depth) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return value.trim() ? value : undefined;
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) {
        const kept = compactValue(item, depth + 1);
        if (kept !== undefined) items.push(kept);
      }
      return items.length ? items : undefined;
    }
    if (typeof value === 'object') {
      if (depth >= PROBE_MAX_COMPACT_DEPTH) return value;
      const out = {};
      const keys = Object.keys(value);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const kept = compactValue(value[k], depth + 1);
        if (kept !== undefined) out[k] = kept;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return value;
  }

  function compact(obj) {
    const kept = compactValue(obj, 0);
    return kept === undefined ? {} : kept;
  }

  /** Drops nulls, duplicate unit id, and repeated typenames. */
  function cleanEvidence(evidence, unitId, unitTypename) {
    if (!evidence) return null;
    const out = {};
    for (const [k, v] of Object.entries(evidence)) {
      if (v === null || v === undefined) continue;
      if (k === 'id' && unitId && v === unitId) continue;
      if ((k === 'ownTypename' || k === 'nestedTypename') && unitTypename && v === unitTypename) continue;
      out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  }

  /** Unified lifecycle report (schema v6): env → unit → verdict → comet/relay/dom. */
  function buildProbeReport(props, classifyResult, relayReads, container, renderedAt, holder) {
    const ctx = collectProbeContext(props, classifyResult, relayReads, container, renderedAt, holder);
    const categorySetting = resolveCategorySetting(ctx);
    const cr = ctx.classifyResult;

    let initialClassify = null;
    let rawEvidence = cleanEvidence(cr && cr.evidence, cr && cr.unitId, cr && cr.unitTypename);
    if (rawEvidence && ctx.hadInitialDomEvidence && ctx.domSuggestedLive) {
      rawEvidence.domSignal = ctx.domSuggestedLive.text || ctx.domSuggestedLive.reason;
    }
    if (cr) {
      initialClassify = compact({
        category: cr.category,
        signal: (cr.signal || (cr.domEvidence && cr.domEvidence.signal)) || null,
        unitTypename: cr.unitTypename,
        reason: cr.reason,
        evidence: rawEvidence
      });
    }

    // Probe-owned store read, present in every mode (see readDataEngineForReport).
    const storeRead = readDataEngineForReport(props);
    const storeResult = storeRead && storeRead.result;
    // Render-path read log, absent in DOM-only mode.
    const readsFromRender = Array.isArray(relayReads) && relayReads.length ? relayReads : null;
    const readsFromProbe = storeRead && Array.isArray(storeRead.reads) && storeRead.reads.length ? storeRead.reads : null;
    const effectiveReads = readsFromRender || readsFromProbe;

    let relayStatus = null;
    if (ctx.relayStatus) {
      relayStatus = compact({
        isReady: ctx.relayStatus.isReady,
        sourceCount: ctx.relayStatus.sourceCount,
        lastError: ctx.relayStatus.lastError,
        capture: captureIsUnhealthy(ctx.relayStatus) ? ctx.relayStatus.capture || null : null,
        // A ready store with no reads is confusing; never filter reads to nothing.
        reads: effectiveReads
          ? effectiveReads.filter((item) => typeof item === 'string' || (item && item.value !== null && item.value !== undefined))
          : null,
        recordKeys: ctx.recordKeys && ctx.recordKeys.length ? ctx.recordKeys : null
      });
    }

    // Key lists are per-page schema; print only when the store named nothing.
    const storeNamedNothing = Boolean(
      ctx.classifyResult &&
      (ctx.classifyResult.category === 'regular' || ctx.classifyResult.category === null)
    );
    const feedUnitInfo = compact({
      debug_info: ctx.feedUnit && typeof ctx.feedUnit.debug_info === 'string' && ctx.feedUnit.debug_info
        ? (ctx.feedUnit.debug_info.length > 200 ? ctx.feedUnit.debug_info.slice(0, 200) + '…' : ctx.feedUnit.debug_info)
        : null,
      th_dat_spo: ctx.feedUnit && ctx.feedUnit.th_dat_spo !== null && ctx.feedUnit.th_dat_spo !== undefined ? ctx.feedUnit.th_dat_spo : null,
      payloadKeys: storeNamedNothing && ctx.payloadKeys && ctx.payloadKeys.length ? ctx.payloadKeys : null,
      feedUnitKeys: storeNamedNothing && ctx.feedUnitKeys && ctx.feedUnitKeys.length ? ctx.feedUnitKeys : null,
      childrenKeys: storeNamedNothing && ctx.childrenKeys && ctx.childrenKeys.length ? ctx.childrenKeys : null
    });

    let moduleHealth = null;
    try {
      const comet = window.FBDietComet;
      if (comet && typeof comet.getModuleHealth === 'function') {
        const health = comet.getModuleHealth();
        const fold = window.FBDietFold;
        const drift = fold && typeof fold.checkModuleDrift === 'function' ? fold.checkModuleDrift() : null;
        const suspected = Boolean(drift && drift.suspected);
        moduleHealth = compact({
          dCalls: health.dCalls,
          registered: health.registered,
          seen: health.seen,
          patched: health.patched,
          suspected: suspected === true,
          // `unseen` names print only when drift is suspected.
          unseen: suspected && health.unseen && health.unseen.length ? health.unseen : null
        });
      }
    } catch (e) {}

    // Probe read (`dataEngine`) stays separate from render-path `initialClassify`.
    // Present when they differ; absent when they agree.
    const dataEngineBlock = storeResult
      ? compact({
        category: storeResult.category,
        signal: storeResult.signal || null,
        unitTypename: storeResult.unitTypename,
        reason: storeResult.reason,
        // Same cleaner as initialClassify; no duplicate id/typename reprints.
        evidence: cleanEvidence(storeResult.evidence, storeResult.unitId, storeResult.unitTypename)
      })
      : null;
    // Absent means agreement, never an unreadable store; failures say so.
    // // per STRATEGY.md §3.1
    const storeReadFailed = !dataEngineBlock && initialClassify;
    const dataEngine = initialClassify && dataEngineBlock && JSON.stringify(initialClassify) === JSON.stringify(dataEngineBlock)
      ? null
      : (dataEngineBlock || (storeReadFailed ? compact({ scanned: false, outcomeReason: 'no_store_read' }) : null));

    // `relay` block folds the store's own numbers in (no `relay.relay`).
    const relayBlock = compact({
      renderedAt: ctx.renderIso,
      initialClassify: initialClassify,
      // Diagnostic only; reported when not repeating `initialClassify`.
      dataEngine: dataEngine,
      entryCategory: ctx.props && ctx.props.entryCategory !== null && ctx.props.entryCategory !== undefined ? ctx.props.entryCategory : null,
      isReady: relayStatus ? relayStatus.isReady : null,
      sourceCount: relayStatus ? relayStatus.sourceCount : null,
      lastError: relayStatus ? relayStatus.lastError : null,
      capture: relayStatus ? relayStatus.capture : null,
      reads: relayStatus ? relayStatus.reads : null,
      recordKeys: relayStatus ? relayStatus.recordKeys : null,
      enrichment: ctx.enrichment,
      payload: feedUnitInfo,
      signals: ctx.signals && ctx.signals.length ? ctx.signals : null
    });

    // Interception phase, apart from the store. // per docs/debugging.md
    const cometBlock = moduleHealth ? { moduleHealth: moduleHealth } : null;

    const domLive = ctx.domLive;
    const cached = ctx.cached;
    const liveUrls = (domLive && domLive.urls) || {};
    const primaryUrl = (domLive && domLive.postUrl) || liveUrls.primary || null;
    const urls = compact({
      primary: primaryUrl,
      synthesized: liveUrls.synthesized || null,
      ad: ctx.adUrl
    });
    // Empty blocks collapse via `compact`; guards keep `extracted`/`urls` honest.
    // Unfired cue lists drop; `outcome` names the path.
    const detectorBlock = compact({
      suggested: trimUnfiredCues(ctx.suggestedExplanation),
      sponsored: ctx.sponsorExplanation || null,
      surface: ctx.surfaceExplanation || null
    });
    const extracted = compact({
      actor: (domLive && domLive.actor) || (cached && cached.actorName) || null,
      group: (domLive && domLive.group) || (cached && cached.groupName) || null,
      title: (domLive && domLive.title) || null,
      snippet: (domLive && domLive.snippet) || (cached && cached.snippetText) || null,
      media: (domLive && domLive.media) || null,
      reshare: (domLive && domLive.reshare) || null,
      suggested: ctx.domSuggestedLive || null,
      // DOM's independent read, verdict or not.
      sponsored: ctx.domSponsoredLive || null,
      // Surface verdict, present only when a surface decided.
      surface: ctx.domSurface || null,
      // Detector rationales, separating "never looked" from "looked and declined".
      detectors: Object.keys(detectorBlock).length ? detectorBlock : null
    });
    const domBlock = compact({
      urls: Object.keys(urls).length ? urls : null,
      extracted: Object.keys(extracted).length ? extracted : null
    });

    const report = {
      schemaVersion: PROBE_SCHEMA_VERSION,

      // Part 1: 環境
      env: compact({
        extVersion: defaults.VERSION || null,
        dietMode: ctx.activeMode,
        lang: ctx.pageLang,
        probed: ctx.nowIso,
        probeAgeMs: ctx.probeAgeMs,
        // Absent modules only; empty list reports nothing.
        modules: missingModuleList()
      }),

      // Part 2: 單元識別
      unit: compact({
        unitId: ctx.unitKey,
        postId: ctx.postId,
        moduleName: ctx.props && ctx.props.moduleName ? ctx.props.moduleName : (cr && cr.moduleName) || null,
        feedPosition: ctx.feedPosition
      }),

      // Part 3: 裁決
      verdict: compact({
        category: categorySetting.category,
        reason: ctx.effectiveReason,
        settingKey: categorySetting.key,
        foldMode: categorySetting.foldMode,
        detectionSource: ctx.detectionSource,
        // Present only when the mounted UI differs from the verdict.
        displayNote: ctx.displayNote,
        displayedTag: ctx.displayedTag,
        isFolded: ctx.isFolded,
        // TitleBar preview; absent when no title source exists.
        titleBar: ctx.titleBar && Object.keys(ctx.titleBar).length ? ctx.titleBar : null,
        // Fold-scope context (per docs/architecture.md)
        scope: resolveProbeScope()
      }),

      // Part 4: 三階段生命週期
      ...(cometBlock ? { comet: cometBlock } : {}),
      relay: relayBlock,
      dom: domBlock
    };

    return serializeReport(report);
  }

  /** Popup delegation to probe-popup.js; missing popup is a safe no-op. */
  function getPopup() {
    return (typeof window !== 'undefined' && window.FBDietProbePopup) || null;
  }

  function promptFallbackCopy(payload) {
    const popup = getPopup();
    if (popup && typeof popup.promptFallbackCopy === 'function') {
      return popup.promptFallbackCopy(payload);
    }
    try {
      window.prompt('FB Diet diagnostics - select all & copy (Ctrl+C / Cmd+C):', payload);
    } catch (e) {
    }
  }

  function copyProbeReport(text) {
    const popup = getPopup();
    if (popup && typeof popup.copyProbeReport === 'function') {
      return popup.copyProbeReport(text);
    }
    try {
      if (typeof console !== 'undefined' && typeof console.info === 'function') {
        console.info('[FB Diet][Probe] popup module missing; report not copied.');
      }
    } catch (e) {}
  }

  function closeActiveProbePopup() {
    const popup = getPopup();
    if (popup && typeof popup.closeActiveProbePopup === 'function') {
      return popup.closeActiveProbePopup();
    }
  }

  function showProbePopup(holder, classifyResult, props, report) {
    const popup = getPopup();
    if (popup && typeof popup.showProbePopup === 'function') {
      return popup.showProbePopup(holder, classifyResult, props, report);
    }
  }

  function mountProbe(element, props, classifyResult, relayReads) {
    try {
      const bridge = window.FBDietBridge;
      const React = window.FBDietComet ? window.FBDietComet.getReact() : null;
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
        } catch (e) {}

        const btn = event && (event.currentTarget || event.target);
        const holder = btn && typeof btn.closest === 'function'
          ? btn.closest('.fb-diet-probe-holder')
          : (btn ? btn.parentElement : null);
        const container = holder
          ? (holder.querySelector('.fb-diet-fold-hidden, .fb-diet-expand-body') || holder)
          : null;

        const liveProbe = buildProbeReport(props, classifyResult, relayReads, container, renderedAt, holder);
        const reportText = liveProbe.text;

        try {
          console.info('[FB Diet][Probe] Copied lifecycle diagnostics to clipboard.');
        } catch (e) {}
        copyProbeReport(reportText);

        try {
          if (holder) showProbePopup(holder, classifyResult, props, liveProbe.report);
        } catch (e) {}
      };

      const createEl = (ui && ui.createEl) || function fallbackCreateEl(type, p, c) {
        return window.FBDietComet ? window.FBDietComet.createElement(React, type, p, c) : null;
      };

      const buttonProbe = createEl(
        'button',
        { className: 'fb-diet-probe-btn fb-diet-probe-btn-unified', type: 'button', title: 'FB Diet: copy lifecycle diagnostics (JSON)', onClick: onProbeClick },
        ['🔍']
      );
      const buttonGroup = createEl('div', { className: 'fb-diet-probe-group' }, [buttonProbe]);
      return createEl('div', { className: 'fb-diet-probe-holder' }, [buttonGroup, element]);
    } catch (e) {
      return element;
    }
  }

  return {
    PROBE_MAX_CHARS,
    SCHEMA_VERSION: PROBE_SCHEMA_VERSION,
    findDiagnosticSignals,
    buildProbeReport,
    promptFallbackCopy,
    copyProbeReport,
    closeActiveProbePopup,
    showProbePopup,
    mountProbe,
    addProbe: mountProbe, // deprecated alias, remove next minor release
  };
})();
