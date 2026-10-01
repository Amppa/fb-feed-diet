/**
 * FB Diet - Probe Diagnostics Module (MAIN world)
 *
 * Provides per-unit unified lifecycle JSON diagnostic reports (comet + relay +
 * dom phases), keyword signal discovery, copy-to-clipboard interactions, and
 * in-place tooltip popups.
 *
 * Public API: window.FBDietProbe
 */
window.FBDietProbe = (() => {
  'use strict';

  const PROBE_MAX_CHARS = 30000;
  // v6: the store phase is reported as `relay` (it always meant the store), the store's own
  // counters are folded into that block instead of a nested `relay.relay`, the Comet module
  // hook's health moves to its own `comet` block, and `detectionSource` reports `relay`
  // where it used to report `proxy`. Schema 5 is the last version that says `proxy` for the
  // store (STRATEGY.md decision #46).
  const PROBE_SCHEMA_VERSION = 6;
  // The report contract is two levels deep everywhere except the per-detector explanation block
  // (three), so this bound is not reached by any block the report builds. It exists so recursive
  // compaction degrades to "kept whole" on a pathological value instead of overflowing the stack.
  const PROBE_MAX_COMPACT_DEPTH = 12;
  // Relay's normalized cache keys a record's fields by its client id — `$1`, `$2`, … — so a key
  // matching this is a storage slot on every record rather than a name on this one.
  const RELAY_PLACEHOLDER_KEY_RE = /^\$\d+$/;
  const defaults = window.FB_DIET_DEFAULTS || globalThis.FB_DIET_DEFAULTS || {};
  const keywords = defaults.KEYWORDS || {};
  const DIAGNOSTIC_KEYWORDS = Array.isArray(keywords.DIAGNOSTIC) ? keywords.DIAGNOSTIC : [];

  // The report states the *current* mode name, so a profile stored under a retired value still
  // shows "relay" / "dom" rather than the legacy value it actually holds.
  function normalizeDetectionMode(value) {
    return typeof defaults.normalizeDetectionMode === 'function'
      ? defaults.normalizeDetectionMode(value)
      : 'relay';
  }
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

  /**
   * Page locale as declared by Facebook (`<html lang>`). Keyword and string based
   * classification is locale-sensitive (STRATEGY.md decision #6), so every report
   * records the locale the rules actually ran against.
   */
  function resolvePageLang() {
    try {
      const doc = (typeof window !== 'undefined' && window.document)
        || (typeof document !== 'undefined' ? document : null);
      return (doc && doc.documentElement && doc.documentElement.lang) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * A detector is a diagnostic helper now, and a diagnostic must not be able to break the report.
   * A missing container, a stub detector that never loaded, or a throw inside `explain` all yield a
   * named outcome rather than null — the same rule every other probe read follows.
   *
   * Returning null here was a mistake, and a real page caught it: a field report showed the
   * suggested half of the block and no sponsored half, with nothing to say why. "No explanation"
   * and "the detector module is not on the page" are the two states a person most needs told
   * apart — the first means the detector ran and declined, the second means it never ran at all,
   * and the second usually means a stale extension that was not reloaded. A silent null collapses
   * them back into the ambiguity this block exists to remove.
   */
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

  /**
   * Which MAIN-world modules are missing from `window` right now, if any.
   *
   * A per-unit report is the wrong place to discover that a whole module never loaded, and until
   * this existed there was nowhere in a report that could say so: a detector that answered nothing
   * and a detector that was never on the page both surfaced as the same absent key. That is not
   * hypothetical — `dom-sponsored.js` was committed, syntactically valid, listed in the manifest,
   * loading correctly in isolation, and still reporting `module_unavailable` on a real page for
   * several rounds. The file was right every time; the answer had to come from the page, so the
   * page is where the probe now looks.
   *
   * Reported as the modules that did NOT load, and only when at least one is missing. The previous
   * shape listed the twelve that did, which is the same 12 names on every unit of a page load and
   * is information exactly when nothing is wrong. The absence is the signal, so the absence is what
   * is printed — and it names the file, which is what a reader has to go and look at.
   */
  function missingModuleList() {
    const expected = [
      'FBDietComet', 'FBDietRelay', 'FBDietRelayMetadata', 'FBDietRelayClassify', 'FBDietBridge',
      'FBDietDOMSurface', 'FBDietDOMSuggested', 'FBDietDOMSponsored', 'FBDietUI', 'FBDietProbe',
      'FBDietFold', 'FBDietDOMMetadata'
    ];
    const missing = expected.filter((name) => window[name] === undefined || window[name] === null);
    return missing.length ? missing : null;
  }

  /** The store read, taken for the report alone.
   *
   * The probe is a neutral observer. It reports what the data layer holds AND what the page shows,
   * and which of the two the active mode consults is the report's `verdict` block's business, not
    * its own. So the probe does not take the classifier's word for what the store contains: it
    * performs its own `classify` pass, purely to populate `relay.initialClassify` and
    * `relay.reads`.
   *
   * This existed only as a by-product before, because `fold.js` happened to call the classifier and
   * passed the result down as a parameter. That made the report's fidelity depend on the mode: in
   * DOM-only mode `resolveVerdict` skips the data engine entirely (decision #40 — the skip is a
   * skip, not an out-vote), so `classifyResult` and `relayReads` arrived empty and the report showed
   * `isReady: true` next to no reads at all. A diagnostic that goes blind in one of the two
   * configurations it exists to compare cannot do its job.
   *
   * The verdict is untouched by this. The result is reported as `dataEngine` alongside the existing
   * `initialClassify` rather than in place of it, because `initialClassify` means "what the render
   * path actually decided" — which in DOM-only mode genuinely is nothing, and reporting that as
   * missing would hide the very fact being investigated.
   */
  function readDataEngineForReport(props) {
    const classify = window.FBDietRelayClassify;
    if (!classify || typeof classify.classify !== 'function') return null;
    try {
      const result = classify.classify(props && props.payload, {
        moduleName: (props && props.moduleName) || null,
        lastCmp: props && props.lastCmp
      });
      const reads = typeof classify.getLastRelayReads === 'function' ? classify.getLastRelayReads() : null;
      return { result: result, reads: reads };
    } catch (e) {
      return null;
    }
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
  function collectProbeContext(props, classifyResult, relayReads, container, renderedAt, holder) {
    const nowIso = new Date().toISOString();
    const renderIso = renderedAt || nowIso;
    let probeAgeMs = null;
    if (renderedAt) {
      try {
        const diff = new Date(nowIso).getTime() - new Date(renderedAt).getTime();
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

    // Structured context from Props / Relay store (initial)
    //
    // `FBDietRelayMetadata.collect` derives the record ids it reads from the classify result it is
    // given. A verdict in `dom` mode has a `unitId` derived from props — it is not a record id — and
    // no store result at all, so handing it over would issue real store reads against a key that
    // never existed. A verdict names its `source`; a bare classify result does not, and is one.
    const storeResult = classifyResult && classifyResult.source ? classifyResult.store : classifyResult;
    let enrichment = null;
    try {
      const metadata = window.FBDietRelayMetadata;
      if (storeResult && metadata && typeof metadata.collect === 'function') {
        enrichment = metadata.collect(storeResult, props);
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

    const verdictCategory = (classifyResult && classifyResult.category) || null;
    const baseCategory = verdictCategory || (props && props.entryCategory) || 'regular';
    // What the render path says produced the category, read from the one place that knows. A
    // module-declared category is structural rather than a detection, so it names no source:
    // crediting an engine there would claim a scanner reasoned its way to 'stories'.
    const renderSource = (classifyResult && classifyResult.source) || null;
    // Verdict fidelity (decision #53): a live hit never becomes the verdict. Where the engine
    // already decided, the detection is still reported (dom.extracted.suggested) — "this looks
    // like a suggestion" is worth saying either way — but it is not what decided the category.
    // A module-declared category counts as decided: it is structural, and the live hit is not going
    // to overturn "this module IS the Stories tray".

    const hadInitialDomEvidence = Boolean(classifyResult && classifyResult.domEvidence);
    // The render-time evidence is whichever DOM capability produced it, and the three shapes are
    // distinguishable by their own hit flag. Seeding the suggested block from any domEvidence object
    // used to paste the sponsorship — or the surface — verdict under `extracted.suggested`, which is
    // a label the reader has no way to question from inside the report.
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

    // DOM sponsorship, mirrored from the suggested block: the render-time verdict carries the
    // evidence when the DOM overruled the store, and a live re-scan fills it in otherwise so a
    // missed ad is still visible in the report (STRATEGY.md decision #39).
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

    // Why each detector answered as it did, reported whether or not it fired. A detector that
    // returns null and a detector that was never asked are indistinguishable in a report, and that
    // is exactly the ambiguity that made the real-page sessions undiagnosable: "regular" could mean
    // the DOM saw nothing, or that it saw plenty and every rule declined. `explain` reuses each
    // detector's own scan helpers, so this cannot drift from what `detect` decides.
    // Both halves are always attempted and always named, so a report never shows one detector's
    // verdict and leaves the other's absence unexplained. `module_unavailable` is the case worth
    // seeing: it means the extension was not reloaded, not that the page was clean.
    const suggestedExplanation = callExplain(detector, container, 'suggested');
    const sponsorExplanation = callExplain(sponsorDetector, container, 'sponsored');
    // The surface detector has no scanner in the daily modes, so its explanation is the only place
    // a reader can see what the DOM would have said about reels / stories / group trays. `explain`
    // reports the tray marker, the label it read and the link counts, which is what a renamed
    // surface shows up as before it shows up as "the feed stopped folding".
    const surfaceExplanation = callExplain(window.FBDietDOMSurface, container, 'surface');

    // Render-time surface evidence exists only where the surface rules have authority, so its
    // presence is the attribution: no separate mode test needed.
    const domSurfaceEvidence = (classifyResult && classifyResult.domEvidence && classifyResult.domEvidence.isSurface)
      ? classifyResult.domEvidence
      : null;

    // "Did the DOM decide this?" used to need three separate questions answered from the report's
    // own inputs: whether the store named a category, read off a `dom:` reason prefix; whether the
    // mode skipped the data engine; and whether the render-time evidence carried sponsorship's own
    // flag. A field report on 2026-09-28 showed what reading a prefix as provenance costs —
    // `reason: "dom:no-verdict"` beside `detectionSource: "dom_sponsorship"`, crediting to a scan
    // this probe had just run, on a unit that stayed unfolded. The render path now names what decided,
    // so none of it is re-derived here.
    //
    // A live sponsorship hit is never what decided the verdict, and no longer tries to be: `relay`
    // mode mounts no container, so the probe cannot see one at all, and in `dom` mode a label present
    // at render time is already `renderSource === 'dom_sponsorship'`. What a live hit is worth is the
    // report — a label on the page now, on a unit the engine had not folded, is the fact a field
    // report needs — so it populates `dom.extracted.sponsored` and its detector block, and stops there.
    // The verdict strictly reflects what the active engine decided at render time.
    // Click-time DOM scans never alter category, reason, or detectionSource: a live hit
    // populates `dom.extracted.suggested` and its detector block, and stops there.
    const effectiveCategory = baseCategory;
    const effectiveReason = classifyResult ? classifyResult.reason : null;

    // Attribution, read rather than re-derived. The render path owns which engine produced the
    // category. A module-declared category is not a
    // detection and reports no source, which is what the field name being absent has always meant.
    const detectionSource = renderSource === 'entry' ? null : renderSource;

    // What the mounted UI shows, and that it may not be what was decided. A `dom`-mode unit the
    // engine examined and did not fold displays as `regular` because that is the group it counts
    // towards; without this the report shows a category the reader has no way to tell apart from a
    // classifier result.
    const display = (classifyResult && classifyResult.display) || null;
    const displayNote = display && display.substituted
      ? 'The ' + activeMode + ' engine examined this unit and decided nothing, so it is displayed as ' + display.category + '.'
      : null;

    // Live UI reflection from DOM
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

  /**
   * Drops a cue list in which no cue fired.
   *
   * `explain()` records every cue it ran, fired or not, because a reader needs to know what the
   * detector read off the page. That is the right contract for the function and the wrong shape for
   * a report: five `{cue, fired: false}` entries cost 665 characters on a page where nothing matched,
   * and `outcome: "no_cue_matched"` already carries the finding.
   *
   * A veto loses the array too, and must stay distinguishable without it. `vetoed_as_tray` and
   * `no_cue_matched` are different outcomes reached by different paths — one before any cue ran,
   * the other after every cue declined — so the outcome name is what separates "the DOM was stopped
   * before it looked" from "the DOM looked and found nothing" (decision #44). It is the name, not
   * the array, that carries that, and printing an empty list here would be the report asserting
   * something the rest of the block already states.
   */
  function trimUnfiredCues(explanation) {
    if (!explanation || !Array.isArray(explanation.cues)) return explanation || null;
    if (explanation.cues.some((cue) => cue && cue.fired)) return explanation;
    const trimmed = Object.assign({}, explanation);
    delete trimmed.cues;
    return trimmed;
  }

  /**
   * Whether the store capture is worth reporting.
   *
   * The counters exist to answer one question: with no sources, which link in the capture chain
   * broke? That question is only asked when the capture did not get there — thirteen resolved
   * counters on a store with six sources is the same thirteen names on every unit of the page load,
   * and none of them is the answer to anything.
   *
   * So the block reports when `applied` is false, when there is no source, when the capture recorded
   * an error, or when a record's accessor shape disagreed with the field the reader expects
   * (`shapeMismatch`, which is the counter that names a Relay path to fix). `alreadyWrapped` /
   * `alreadyPatched` are counted as unhealthy too: they mean a second install wrapped the same
   * module, which is a real finding and not a healthy steady state.
   */
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

  /**
   * Top-level keys of the Relay record for this unit, when the store can describe it.
   *
   * Relay's normalized cache stores a record's own data under its client ID — `$1`, `$2`, `$3` on
   * every record it has ever written — and `describe()` returns that shape. Those keys are the same
   * on every record, so a report carrying `["$1","$2","$3"]` tells a reader nothing about this unit.
   * They are dropped for exactly the reason `evidence.id` is: the value is a placeholder, not a
   * finding.
   *
   * A key that is a real field name means `describe()` returned something other than a normalized
   * record, which is itself worth seeing, so the block survives when any such key is present.
   */
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

  /**
   * Drops members that carry nothing: null, undefined, empty arrays, empty objects, and strings
   * that are empty after trimming.
   *
   * RECURSIVE, because the shallow version shipped whole blocks of nulls. `compact` removed null
   * members from the object it was handed and stopped there, so `enrichment.group` arrived as
   * `{id: null, name: null, joinState: null, permalink: null}` — four keys and no information — and
   * the assembly site already called that shape noise. One real field report carried 899 characters
   * of it, 13% of the report. The same held for `enrichment.media`, `viewer`, `surface.labels` and
   * every `detail` on an unfired cue.
   *
   * A number `0` and a boolean `false` are values, not absences. `surface.links: {reels: 0}` means
   * "counted, found none", which is a different claim from the block being absent, and that count
   * is what decision #43's threshold is measured against.
   *
   * Depth is bounded rather than unlimited so a cyclic value degrades to "kept whole" instead of
   * overflowing the stack. `serializeReport` already survives a cycle, and a diagnostic that
   * throws on the way to producing the report is worse than a verbose one.
   */
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
      for (const [k, v] of Object.entries(value)) {
        const kept = compactValue(v, depth + 1);
        if (kept !== undefined) out[k] = kept;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return value;
  }

  /** Recursive compaction. An all-null block returns `{}`; callers drop it by testing emptiness. */
  function compact(obj) {
    const kept = compactValue(obj, 0);
    return kept === undefined ? {} : kept;
  }

  /**
   * Evidence, cleaned for the report: null members dropped, the unit id removed when it is merely
   * the same value the report's `unit.unitId` already carries, and the typenames removed when they
   * merely repeat the one the same block already reports.
   *
   * The unit id is a ~400-character base64 Relay key, and it appeared twice in a report — once as
   * `unit.unitId` and once inside every evidence block that carried it. The unit block is the
   * canonical place, and `docs/debugging.md` tells a reader to paste that value into
   * `FBDietRelay.describe()`. Printing it again inside evidence adds a wall of text to every report
   * and invites the reader to wonder which of the two is the real id.
   *
   * The typenames need the same rule for the opposite reason. `ownTypename` and `nestedTypename` are
   * distinct facts, and pitfall 3 is entirely about them differing: a friend sharing a Reel nests
   * `ShowcaseFeedUnit` inside an ordinary `Story`. But when one of them equals the `unitTypename`
   * the block already reports (`ownTypename || nestedTypename`), it is a third copy of the same
   * string, so it goes — and the block whose typename is *not* the reported one keeps both.
   *
   * One rule, one place: this was previously inline for `initialClassify` only, so evidence added
   * afterwards started reprinting the id. Every evidence block in the report goes through here.
   */
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

  /**
   * Unified lifecycle probe report (schema v6): parser contract, then `env` (what
   * produced it) → `unit` (which unit) → `verdict` (what was decided, incl. the
   * fold-scope gate) → the three phases, `comet` (which Facebook modules the hook
   * intercepted), `relay` (Props/Relay state captured at render time) and `dom` (live
   * mounted-DOM extraction at click time).
   */
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
        // `moduleName` is not repeated here: the report's `unit` block already carries it, and
        // `ctx.moduleName` falls back to this very value when the props did not supply one.
        evidence: rawEvidence
      });
    }

    // The probe's own store read, independent of what the render path did. Present in every mode —
    // that independence is the whole point (see readDataEngineForReport).
    const storeRead = readDataEngineForReport(props);
    const storeResult = storeRead && storeRead.result;
    // The render path's read log, when it produced one. In DOM-only mode there is none, and the
    // probe's own read is the only record of what the store holds.
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
        // A store that reports itself ready while showing no reads is the confusing report this
        // fixes, so the reads must not be filtered down to nothing by the mode.
        reads: effectiveReads
          ? effectiveReads.filter((item) => typeof item === 'string' || (item && item.value !== null && item.value !== undefined))
          : null,
        recordKeys: ctx.recordKeys && ctx.recordKeys.length ? ctx.recordKeys : null
      });
    }

    // The structural key lists are a per-page schema, not a per-unit reading: which keys a
    // `feedUnit` carries is a property of the page build, so every unit of a page load would print
    // the same three arrays. They answer one question — "the field this rule reads is not here" —
    // which is only asked when the store named no category for the unit (`regular` / `no-match`, or
    // no unit id at all). A unit the store classified does not need its own key listing to say so.
    const storeNamedNothing = Boolean(
      ctx.classifyResult &&
      (ctx.classifyResult.category === 'regular' || ctx.classifyResult.category === null)
    );
    const feedUnitInfo = compact({
      // `post_id` is not repeated here: `unit.postId` is the report's canonical place for it, and
      // this is the same `ctx.postId` value, so a reader comparing the two finds them identical
      // rather than learning anything.
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
          // The names are the answer only when drift is suspected. `suspected: false` beside eleven
          // unseen names states a verdict and then prints the material that verdict has already
          // dismissed, on every unit of the page. `FBDietComet.getModuleHealth()` still answers the
          // question without a report.
          unseen: suspected && health.unseen && health.unseen.length ? health.unseen : null
        });
      }
    } catch (e) {}

    // What the data layer holds, as read by the probe itself. Deliberately separate from
    // `initialClassify`, which answers a different question — "what did the render path decide" —
    // and in DOM-only mode the honest answer there is "nothing", which is worth seeing rather than
    // papered over with the value below. Comparing the two is how a mode divergence gets read.
    //
    // Present when the two differ, and absent when they agree. In every mode that runs the data
    // engine the two are the same function on the same payload, so the block was a verbatim copy on
    // every unit of the page; the divergence it exists to expose is exactly the case where it is
    // not a copy. DOM-only mode has no `initialClassify` at all, so the block is always there —
    // which is the mode whose whole purpose is the comparison.
    const dataEngineBlock = storeResult
      ? compact({
        category: storeResult.category,
        signal: storeResult.signal || null,
        unitTypename: storeResult.unitTypename,
        reason: storeResult.reason,
        // Through the same cleaner as initialClassify, so neither the unit id nor a typename that
        // merely repeats `unitTypename` is reprinted here — both are already in the `unit` block and
        // in this block's own header, and the two blocks differ in the DOM-only report only by which
        // one the reader happens to look at.
        evidence: cleanEvidence(storeResult.evidence, storeResult.unitId, storeResult.unitTypename)
      })
      : null;
    // Suppressed only when the two genuinely agree. An absent block therefore has to mean "the
    // probe's own read said the same thing", never "the probe could not read": a render-path
    // verdict with no `dataEngine` because `relay-classify.js` was missing or threw would otherwise be
    // indistinguishable from one where the comparison came out clean, which is exactly the
    // ambiguity decision #39 built the block to remove. So a failed read says so in as many words.
    const storeReadFailed = !dataEngineBlock && initialClassify;
    const dataEngine = initialClassify && dataEngineBlock && JSON.stringify(initialClassify) === JSON.stringify(dataEngineBlock)
      ? null
      : (dataEngineBlock || (storeReadFailed ? compact({ scanned: false, outcomeReason: 'no_store_read' }) : null));

    // The store phase. `relay` is this block's own name, so the store's own numbers are folded in
    // here rather than nested under a second `relay` key (which would read as `relay.relay`).
    const relayBlock = compact({
      renderedAt: ctx.renderIso,
      initialClassify: initialClassify,
      // Diagnostic only. Read by the probe, never consulted by the verdict. Reported when it
      // differs from `initialClassify`, when there is no render-path result to compare it against,
      // and when the read itself failed — every case in which it is not saying the same thing twice.
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

    // The interception phase, kept apart from the store: `dCalls` / `patched` / `unseen` describe the
    // Comet module hook (which Facebook modules were ever defined), not what the store holds, so
    // they are not reported as a part of the store (STRATEGY.md decision #46).
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
    // `compact` is recursive, so a nested block whose every member was dropped would collapse into
    // its parent rather than shipping as an empty object. The guard stays because `extracted` and
    // `urls` are handed to the report directly: a `detectors: {}` in a report a person reads is noise
    // that implies a detector ran and stayed silent, which is the opposite of what happened.
    //
    // The cue list is the exception inside those blocks: an explanation that ran every cue and had
    // none fire carries it as five entries of `{cue, fired: false}`, which is 665 characters of
    // nothing — `outcome` already says it. A veto is dropped the same way and stays just as
    // legible, because `vetoed_as_tray` and `no_cue_matched` are different names reached by
    // different paths. A report that claimed cues had been checked after a veto would be the
    // worse lie.
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
      // The detector's own verdict: which signal matched, and the text it matched on. This is
      // the DOM's independent read of the page, reported whether or not it changed the verdict.
      sponsored: ctx.domSponsoredLive || null,
      // …and the same for the surface rules: the category they named, and the reason they named it.
      // Only present when a surface actually decided something, which is the DOM-only pipeline.
      surface: ctx.domSurface || null,
      // …and why each detector answered as it did, on hits and misses alike. This is the block
      // that makes a real page diagnosable: it separates "the DOM never looked" from "the DOM
      // looked and declined", and it shows the label-shaped text it actually read, which is where
      // a renamed or newly obfuscated sponsored label shows up.
      detectors: Object.keys(detectorBlock).length ? detectorBlock : null
    });
    const domBlock = compact({
      urls: Object.keys(urls).length ? urls : null,
      extracted: Object.keys(extracted).length ? extracted : null
    });

    const report = {
      // Parser contract first: it says how to read everything below.
      schemaVersion: PROBE_SCHEMA_VERSION,

      // Part 1: 環境 (What produced this report, and when)
      env: compact({
        extVersion: defaults.VERSION || null,
        dietMode: ctx.activeMode,
        lang: ctx.pageLang,
        probed: ctx.nowIso,
        probeAgeMs: ctx.probeAgeMs,
        // The MAIN-world modules that did NOT load on this page load, and nothing at all when that
        // list is empty. Mode-independent by nature: a reader comparing two reports can tell a
        // module that never loaded from one that declined to answer, which is otherwise the same
        // absent key in both — and only the broken page load pays the twelve names.
        modules: missingModuleList()
      }),

      // Part 2: 單元識別 (Which unit this report is about)
      unit: compact({
        unitId: ctx.unitKey,
        postId: ctx.postId,
        moduleName: ctx.props && ctx.props.moduleName ? ctx.props.moduleName : (cr && cr.moduleName) || null,
        feedPosition: ctx.feedPosition
      }),

      // Part 3: 裁決 (The verdict, with the fold-scope gate that conditioned it)
      verdict: compact({
        category: categorySetting.category,
        reason: ctx.effectiveReason,
        settingKey: categorySetting.key,
        foldMode: categorySetting.foldMode,
        detectionSource: ctx.detectionSource,
        // Present only when the mounted UI shows a category the engine did not decide, so a reader
        // never has to guess whether the badge they see came from a rule or from a default.
        displayNote: ctx.displayNote,
        displayedTag: ctx.displayedTag,
        isFolded: ctx.isFolded,
        // Fold-scope context (STRATEGY.md decision #26)
        scope: resolveProbeScope()
      }),

      // Part 4: 三階段生命週期 (Lifecycle phases: interception, render-time input, click-time DOM)
      ...(cometBlock ? { comet: cometBlock } : {}),
      relay: relayBlock,
      dom: domBlock
    };

    return serializeReport(report);
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

  function renderUnifiedPopup(doc, popup, report, classifyResult, props) {
    const modeStr = (report && report.env && report.env.dietMode ? report.env.dietMode : 'relay').toUpperCase();
    const verdict = (report && report.verdict) || {};
    const category = verdict.category
      || (classifyResult && classifyResult.category)
      || (props && props.entryCategory)
      || 'regular';
    const reason = verdict.reason
      || (classifyResult && classifyResult.reason)
      || (props && props.moduleName ? 'component:' + props.moduleName : 'no-match');

    const evidence = classifyResult && classifyResult.evidence;
    const source = evidence && evidence.source && evidence.source !== 'none' ? evidence.source : null;
    const mod = (classifyResult && classifyResult.moduleName) || (report && report.unit && report.unit.moduleName) || null;
    let evidenceText = source || '';
    if (mod) {
      evidenceText = evidenceText ? evidenceText + ' (' + mod + ')' : mod;
    }
    if (!evidenceText) evidenceText = 'none';

    const ui = window.FBDietUI;
    const userFacingGroup = ui && typeof ui.groupOf === 'function' ? ui.groupOf(category) : 'regular';
    const groupMeta = (ui && ui.GROUP_META && ui.GROUP_META[userFacingGroup]) || { badgeText: 'Other' };

    const foldMode = verdict.foldMode || 'off';
    const statusText = foldMode !== 'off' ? 'ON (' + foldMode + ')' : 'OFF';

    popup.appendChild(popupRow(doc, 'Mode: ' + modeStr + ' · Filter: ' + statusText));
    const uiTagSuffix = verdict.displayedTag && verdict.displayedTag !== groupMeta.badgeText ? ' [UI: ' + verdict.displayedTag + ']' : '';
    popup.appendChild(popupRow(doc, 'Category: ' + groupMeta.badgeText + ' (' + category + ')' + uiTagSuffix));
    popup.appendChild(popupRow(doc, 'Signal: ' + reason));
    const sourceText = verdict.detectionSource ? evidenceText + ' · Detection: ' + verdict.detectionSource : evidenceText;
    popup.appendChild(popupRow(doc, 'Source: ' + sourceText));

    const scope = verdict.scope;
    if (scope) {
      popup.appendChild(popupRow(doc, 'Scope: ' + (scope.allowed ? 'home/search/marketplace' : 'groups/profile')));
    }

    const dom = (report && report.dom) || {};
    const ext = dom.extracted || {};
    const urls = dom.urls || {};

    if (ext.actor || ext.group) {
      popup.appendChild(popupRow(doc, 'Author: ' + (ext.actor || '-') + (ext.group ? ' · Group: ' + ext.group : '')));
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

    const targetUrl = urls.synthesized || urls.primary || urls.ad;
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

    const footer = popupCopiedFooter(doc, '生命週期');
    footer.forEach((node) => popup.appendChild(node));
  }

  function showProbePopup(holder, classifyResult, props, report) {
    try {
      const doc = (typeof document !== 'undefined' ? document : null)
        || (typeof window !== 'undefined' && window.document ? window.document : null)
        || (holder && holder.ownerDocument ? holder.ownerDocument : null);
      if (!holder || !doc || typeof doc.createElement !== 'function') return;

      closeActiveProbePopup();

      const popup = doc.createElement('div');
      popup.className = 'fb-diet-probe-popup';
      popup.title = '點擊外部可關閉提示 (Click outside to dismiss)';

      renderUnifiedPopup(doc, popup, report, classifyResult, props);

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
   * Wraps the unit's render output in a relative holder; the unified lifecycle
   * probe button (🔍) is appended when probe mode is on.
   */
  function addProbe(element, props, classifyResult, relayReads) {
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
    addProbe
  };
})();
