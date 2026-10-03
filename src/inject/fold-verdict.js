/**
 * FB Diet - fold verdicts (MAIN world): "what is this unit?"
 * Scope gate, title rule, mode resolution, DOM pipeline, counter shape.
 * Naming: docs/conventions.md
 */
window.FBDietFoldVerdict = (() => {
  'use strict';

  /** // per docs/architecture.md. An unknown or missing mode falls back to 'whenFolded'. */
  function shouldShowTitle(settings, expanded) {
    if (!settings) return false;
    const defaults = window.FB_DIET_DEFAULTS;
    const mode = defaults && typeof defaults.normalizeTitleMode === 'function'
      ? defaults.normalizeTitleMode(settings.showTitleMode)
      : (settings.showTitleMode === 'always' || settings.showTitleMode === 'never' ? settings.showTitleMode : 'whenFolded');
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    return !expanded;
  }

  // Normalizes retired stored values onto current names.
  function resolveDetectionMode(settings) {
    const defaults = window.FB_DIET_DEFAULTS;
    // Must not collapse 'dom' into 'relay': that would re-enable the bypassed data engine.
    if (defaults && typeof defaults.normalizeDetectionMode === 'function') {
      return defaults.normalizeDetectionMode(settings && settings.dietMode);
    }
    const raw = settings && settings.dietMode;
    return raw === 'relay' || raw === 'dom' ? raw : 'relay';
  }

  /** // per docs/architecture.md. Fails open when the defaults module or the pathname is absent. */
  function isFoldScopeBlocked(settings) {
    if (settings.restrictFoldScope === false) return false;
    const defaults = window.FB_DIET_DEFAULTS;
    const isAllowed = defaults && typeof defaults.isFoldScopeAllowed === 'function' ? defaults.isFoldScopeAllowed : null;
    if (!isAllowed) return false;
    const pathname = window.location ? window.location.pathname : undefined;
    return !isAllowed(pathname);
  }

  /** DOM stage 1 — the free props ad. `dom` skips the STORE, not the props; ad only. */
  function domStagePropsAd(props) {
    const classify = window.FBDietRelayClassify;
    if (!props.payload || !classify || typeof classify.adVerdictFromProps !== 'function') return null;
    const propsAd = classify.adVerdictFromProps(props.payload);
    if (!propsAd) return null;
    return { category: propsAd.category, reason: 'props:' + propsAd.reason, signal: null, source: 'props', propsEvidence: propsAd, domEvidence: null };
  }

  /** DOM stage 2 — structural surface. // per STRATEGY.md §1.1 */
  function domStageSurface(domSurface) {
    if (!domSurface || !domSurface.isSurface || !domSurface.category) return null;
    return { category: domSurface.category, reason: domSurface.reason || 'dom:surface', signal: null, source: 'dom_surface', propsEvidence: null, domEvidence: domSurface };
  }

  /** DOM stage 3 — content cues (follow/join buttons, recommendation headers). */
  function domStageSuggested(domSuggested) {
    if (!domSuggested || !domSuggested.isSuggested) return null;
    return { category: 'suggested', reason: domSuggested.reason || 'dom:suggested', signal: domSuggested.signal || 'Other', source: 'dom_scanner', propsEvidence: null, domEvidence: domSuggested };
  }

  /** DOM stage 4 — ungated: a rendered label overrides whatever the earlier stages decided. */
  function domStageSponsoredOverride(domSponsored) {
    if (!domSponsored || !domSponsored.isSponsored) return null;
    return { category: 'sponsored', reason: domSponsored.reason || 'dom:sponsored', signal: domSponsored.signal || 'Sponsored', source: 'dom_sponsorship', propsEvidence: null, domEvidence: domSponsored };
  }

  // One unit, one verdict: a linear precedence scan, since the two engines are mutually
  // exclusive and whatever decides first ends it. // per STRATEGY.md §1.3
  function resolveVerdict(props, domSuggested, domSponsored, opts) {
    const { skipDataEngine: skipFlag, domSurface: surface } = opts || {};
    const skipDataEngine = Boolean(skipFlag);
    const domSurface = surface || null;
    let category = props.entryCategory || null;
    let reason = 'component:' + (props.moduleName || 'unknown');
    let source = category ? 'entry' : null;
    let signal = null;
    let unitId = null;
    let unitTypename = null;
    let store = null;
    let relayReads = null;
    let domEvidence = null;
    let propsEvidence = null;

    // A module-declared category is structural, so it applies in both modes.
    if (!category && !skipDataEngine) {
      const classify = window.FBDietRelayClassify;
      if (!classify) return null;

      // The module name is classification context: the Reels attachment style wrapper
      // must never fold as Reels. // per STRATEGY.md §4
      const result = classify.classify(props.payload, { moduleName: props.moduleName || null, lastCmp: props.lastCmp });
      store = result;
      relayReads = typeof classify.getLastRelayReads === 'function' ? classify.getLastRelayReads() : null;
      category = result.category;
      reason = result.reason;
      signal = result.signal || null;
      unitId = result.unitId;
      unitTypename = result.unitTypename;
      source = 'relay';
    }

    // Gated on the mode, not on what the store said: that also stops a DOM hit carried across a
    // live switch out of `dom` from being applied in `relay`. // per STRATEGY.md §1.1
    if (skipDataEngine) {
      source = 'dom';
      const applyStage = (stage) => {
        if (!stage) return;
        category = stage.category;
        reason = stage.reason;
        if (stage.signal !== null && stage.signal !== undefined) signal = stage.signal;
        source = stage.source;
        if (stage.propsEvidence !== undefined) propsEvidence = stage.propsEvidence;
        if (stage.domEvidence) domEvidence = stage.domEvidence;
      };
      if (!category) applyStage(domStagePropsAd(props));
      if (!category) applyStage(domStageSurface(domSurface));
      if (!category) applyStage(domStageSuggested(domSuggested));
      const sponsored = domStageSponsoredOverride(domSponsored);
      if (sponsored) {
        applyStage(sponsored);
        propsEvidence = null;
      }
      if (!category) {
        reason = 'dom:no-verdict';
      }
    }

    if (!unitId) {
      // Key must identify ONE unit (ui.js titleBarCache). Prefer props post id; else position.
      const payload = props.payload || {};
      const feedUnit = payload.feedUnit || {};
      const postId = feedUnit.post_id || feedUnit.clip_id || feedUnit.__id || null;
      const mod = props.moduleName || 'unit';
      const type = payload.unitTypename || 'ad';
      if (postId) {
        unitId = mod + '_' + postId;
      } else if (typeof payload.position === 'number') {
        unitId = mod + '_pos' + payload.position + '_' + type;
      } else {
        unitId = mod + '_' + type;
      }
    }

    return {
      category,
      reason,
      signal,
      unitId,
      unitTypename,
      moduleName: props.moduleName || null,
      // Provenance in one place; never infer from reason prefix.
      source,
      store,
      // Null in `dom` mode: never a record id, so no store read is issued from it.
      evidence: store ? store.evidence : null,
      reads: relayReads,
      domEvidence,
      propsEvidence,
      // Undecided displays as `regular`; verdict itself stays null.
      display: { category: category || 'regular', substituted: !category }
    };
  }

  /** Counter report shape — the same payload whether blocked, allowed or regular. */
  function buildVerdictReport(props, verdict) {
    return {
      category: verdict.category,
      unitId: verdict.unitId,
      reason: verdict.reason,
      unitTypename: verdict.unitTypename || (props.payload && typeof props.payload.unitTypename === 'string' ? props.payload.unitTypename : null),
      moduleName: props.moduleName || null
    };
  }

  return {
    shouldShowTitle,
    resolveShowTitle: shouldShowTitle, // deprecated alias, remove next minor release
    resolveDetectionMode,
    detectionMode: resolveDetectionMode, // deprecated alias, remove next minor release
    isFoldScopeBlocked,
    resolveVerdict,
    buildVerdictReport,
    verdictReport: buildVerdictReport, // deprecated alias, remove next minor release
  };
})();