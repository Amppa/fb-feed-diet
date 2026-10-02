/**
 * FB Diet - fold verdicts (MAIN world)
 *
 * Owns the question "what is this unit?" and nothing else: the fold-scope gate, the
 * title-visibility rule, the detection-mode resolution, the DOM staged pipeline
 * (props ad -> surface -> suggested, plus the unconditional sponsorship override) and
 * the counter report shape. Split out of fold.js; this file renders nothing and
 * registers nothing.
 *
 * Siblings it calls: none. Every other module reads it (`window.FBDietFoldVerdict`)
 * and it reads only `window.FB_DIET_DEFAULTS`, so it declares no load order.
 * Members are not prefixed with the module's own name, so the module reads
 * window.FBDietFoldVerdict.resolveVerdict rather than
 * window.FBDietFoldVerdict.FBDietResolveVerdict.
 */
window.FBDietFoldVerdict = (() => {
  'use strict';

  /**
   * Resolves whether the fold bar renders its title text for the current state
   * (STRATEGY.md decisions #27 and #36). `showTitleMode` is the only source; FB_DIET_DEFAULTS owns
   * its normalization and an unknown/missing value falls back to 'whenFolded'. 'whenFolded'
   * shows the title while the post is folded (a summary of the hidden content) and hides it
   * once expanded, where the post itself is visible.
   */
  function resolveShowTitle(settings, expanded) {
    if (!settings) return false;
    const defaults = window.FB_DIET_DEFAULTS;
    const mode = defaults && typeof defaults.normalizeTitleMode === 'function'
      ? defaults.normalizeTitleMode(settings.showTitleMode)
      : (settings.showTitleMode === 'always' || settings.showTitleMode === 'never' ? settings.showTitleMode : 'whenFolded');
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    return !expanded;
  }

  /**
   * Resolves the detection mode from settings, folding a stored value that is no longer a
   * mode ('lite' / 'full' / 'relay+dom') onto its current name. The two strategies are named
   * for where their evidence comes from, not for page weight, and each runs one engine.
   */
  function detectionMode(settings) {
    const defaults = window.FB_DIET_DEFAULTS;
    // The fallback cannot fire under manifest load order (defaults.js is listed first), but it
    // must not collapse 'dom' into 'relay': that would re-enable the data engine this mode
    // exists to bypass and silently report a DOM verdict as a Relay one.
    if (defaults && typeof defaults.normalizeDetectionMode === 'function') {
      return defaults.normalizeDetectionMode(settings && settings.dietMode);
    }
    const raw = settings && settings.dietMode;
    return raw === 'relay' || raw === 'dom' ? raw : 'relay';
  }

  /**
   * Fold-scope gate (STRATEGY.md decision #26): outside the allowlisted surfaces the unit
   * keeps its native render and takes part in no counters, logs or fold bars. Fails open
   * when the defaults module or the pathname is unavailable.
   */
  function isFoldScopeBlocked(settings) {
    if (settings.restrictFoldScope === false) return false;
    const defaults = window.FB_DIET_DEFAULTS;
    const isAllowed = defaults && typeof defaults.isFoldScopeAllowed === 'function' ? defaults.isFoldScopeAllowed : null;
    if (!isAllowed) return false;
    const pathname = window.location ? window.location.pathname : undefined;
    return !isAllowed(pathname);
  }

  /**
   * DOM stage 1 — the free props ad. `dom` mode skips the STORE, not the props: a feed unit's
   * ad field is often a plain prop (`feedUnit.th_dat_spo`), so skipping the whole classifier
   * would throw away a signal that costs nothing and needs no store capture.
   * Sponsorship only — the one category where a false negative is expensive enough to pay
   * redundancy for. `adVerdictFromProps` consults no Relay reader, so the `dom` verdict never
   * depends on store capture.
   */
  function domStagePropsAd(props) {
    const classify = window.FBDietRelayClassify;
    if (!props.payload || !classify || typeof classify.adVerdictFromProps !== 'function') return null;
    const propsAd = classify.adVerdictFromProps(props.payload);
    if (!propsAd) return null;
    return { category: propsAd.category, reason: 'props:' + propsAd.reason, signal: null, source: 'props', propsEvidence: propsAd, domEvidence: null };
  }

  /**
   * DOM stage 2 — structural surface. "This IS a Reels tray" precedes the button heuristics
   * below (STRATEGY.md, misclassification 8).
   */
  function domStageSurface(domSurface) {
    if (!domSurface || !domSurface.isSurface || !domSurface.category) return null;
    return { category: domSurface.category, reason: domSurface.reason || 'dom:surface', signal: null, source: 'dom_surface', propsEvidence: null, domEvidence: domSurface };
  }

  /** DOM stage 3 — content cues (follow/join buttons, recommendation headers). */
  function domStageSuggested(domSuggested) {
    if (!domSuggested || !domSuggested.isSuggested) return null;
    return { category: 'suggested', reason: domSuggested.reason || 'dom:suggested', signal: domSuggested.signal || 'Other', source: 'dom_scanner', propsEvidence: null, domEvidence: domSuggested };
  }

  /**
   * DOM stage 4 — the rendered sponsorship label. Not gated on the category, unlike the
   * stages above: a label on screen is the strongest single piece of evidence on the page,
   * so a unit whose props looked like an ad, or whose buttons looked like a suggestion,
   * still folds as an ad when the byline says so (decision #39).
   */
  function domStageSponsoredOverride(domSponsored) {
    if (!domSponsored || !domSponsored.isSponsored) return null;
    return { category: 'sponsored', reason: domSponsored.reason || 'dom:sponsored', signal: domSponsored.signal || 'Sponsored', source: 'dom_sponsorship', propsEvidence: null, domEvidence: domSponsored };
  }

  /**
   * One unit, one verdict. Returns null only when classification is impossible (no classifier
   * module), which the caller answers by leaving the render untouched.
   *
   * The two engines are mutually exclusive, so this is a linear scan in precedence order rather
   * than an arbitration between two opinions: whatever decides first ends the scan and the rest
   * never runs. Nothing here outranks another engine — `store` is the Relay classify result in
   * `relay` mode and null in `dom` mode, where no store is read at all.
   *
   * `opts.skipDataEngine` is `dom` mode (decision #40): the data engine is not merely out-voted,
   * it is never consulted, so the DOM detectors are the only authority. The free props the
   * classifier would have read first are the one exception, and only for sponsorship.
   *
   * `opts.domSurface` travels inside the options bag rather than beside the other two detectors
   * because it is DOM evidence that never applies in `relay` mode: that mode keeps deciding
   * reels / stories / suggestedGroup from the store, so it should not have to carry it.
   *
   * In `dom` mode the scan below is staged like the Relay pipeline (`classify()`): each stage
   * returns a partial verdict or null, and the convergence order is
   * `sponsored ?? surface ?? suggested`. Sponsorship is unconditional (decision #39); surface
   * precedes suggested because a tray tile satisfies every "looks like a cue" heuristic at
   * once (misclassification #8).
   */
  function resolveVerdict(props, domSuggested, domSponsored, opts) {
    const skipDataEngine = Boolean(opts && opts.skipDataEngine);
    const domSurface = (opts && opts.domSurface) || null;
    let category = props.entryCategory || null;
    let reason = 'component:' + (props.moduleName || 'unknown');
    let source = category ? 'entry' : null;
    let signal = null;
    let unitId = null;
    let unitTypename = null;
    let store = null;
    let reads = null;
    let domEvidence = null;
    let propsEvidence = null;

    // A module-declared category is structural (this IS the Reels tray, this IS a side ad), not
    // a store read, so it applies in both modes.
    if (!category && !skipDataEngine) {
      const classify = window.FBDietRelayClassify;
      if (!classify) return null;

      // The module name is part of the classification context: the Reels attachment
      // style wrapper, for example, must never fold as Reels (see STRATEGY.md).
      const result = classify.classify(props.payload, { moduleName: props.moduleName || null, lastCmp: props.lastCmp });
      store = result;
      reads = typeof classify.getLastRelayReads === 'function' ? classify.getLastRelayReads() : null;
      category = result.category;
      reason = result.reason;
      signal = result.signal || null;
      unitId = result.unitId;
      unitTypename = result.unitTypename;
      source = 'relay';
    }

    // The whole block is gated on the mode rather than on what the store said. That is also what
    // stops a DOM hit carried across a live switch out of `dom` from being applied in `relay`,
    // where no DOM engine is mounted.
    //
    // Staged like the Relay pipeline: each stage returns a partial verdict or null, and the
    // first stages to answer win — except sponsorship, which overrides unconditionally.
    // Convergence: `sponsored ?? surface ?? suggested`.
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
        // The props signal did not decide this verdict, so it stops being reported as if it had.
        propsEvidence = null;
      }
      // An undecided unit here has no store result to carry a reason into the report. `source:
      // 'dom'` with a null category says the engine looked at the unit and fired nothing, which is
      // the fact the diagnostic mode exists to surface; the reason is the marker for readers who
      // only read that field. A non-detection carries no evidence, which is what says so.
      if (!category) {
        reason = 'dom:no-verdict';
      }
    }

    if (!unitId) {
      // The fallback key must identify ONE unit, because ui.js keys its titleBarCache by unitId.
      // The old shape (moduleName + typename) is constant across the whole feed, so in the
      // DOM-only pipeline — where no store id is ever read — every unit shared one key and the
      // second post's author and snippet were served to all of them. Prefer the post id that is
      // already sitting in the props, which needs no store read; feedPosition keeps two posts
      // apart when even that is missing.
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
      // What produced the category, named explicitly and in one place — including when that answer
      // was "nothing": 'entry' (structural, declared by the module), 'relay' (the store), 'dom'
      // (the DOM engine examined the unit and fired nothing), 'props', 'dom_surface', 'dom_scanner',
      // 'dom_sponsorship'. Consumers read this instead of inferring provenance from a reason-string
      // prefix, which is the mistake that made a DOM-driven ad report as a store verdict once.
      source,
      // The Relay classify result, or null in `dom` mode. Nothing is manufactured to fill it: a
      // consumer that needs store data has to cope with there being none, which is the point.
      store,
      // The store evidence, and the only thing `FBDietRelayMetadata.collect` derives record ids
      // from. Null in `dom` mode is what stops that collector issuing a store read with a key that
      // was never a record id.
      evidence: store ? store.evidence : null,
      reads,
      // What decided, when a DOM or props capability did. The two are kept apart so nothing has to
      // read provenance off the `dom:` / `props:` reason prefix.
      domEvidence,
      propsEvidence,
      // What the mounted UI shows, kept apart from the verdict itself: an undecided unit displays as
      // `regular` because that is the group it counts towards, and the two must never be confused.
      display: { category: category || 'regular', substituted: !category }
    };
  }

  /** Counter report shape. The same payload is reported as blocked, allowed or regular. */
  function verdictReport(props, verdict) {
    return {
      category: verdict.category,
      unitId: verdict.unitId,
      reason: verdict.reason,
      unitTypename: verdict.unitTypename || (props.payload && typeof props.payload.unitTypename === 'string' ? props.payload.unitTypename : null),
      moduleName: props.moduleName || null
    };
  }

  return {
    resolveShowTitle,
    detectionMode,
    isFoldScopeBlocked,
    resolveVerdict,
    verdictReport
  };
})();