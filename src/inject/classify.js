/**
 * FB Diet - Feed unit classifier (MAIN world, pure functions)
 *
 * Turns the props of a Facebook feed unit plus a Relay reader into one of FB Diet's
 * categories. Everything here is side effect free and dependency injected, so the exact
 * same code is unit tested under Node (see tests/classify.test.js).
 *
 * Evidence fields are always returned, even when nothing matched: they are what gets
 * logged for unmatched (reason: no-match) units so mis-detections can be diagnosed
 * without guessing.
 *
 * Public API (window.FBDietClassify):
 *   classifyFeedUnit(payload, context)    -> { category, unitId, unitTypename, reason, evidence, moduleName }
 *   setRelayReader(fn)                    -> fn(ids, path, options) => value | null
 *   isCategoryEnabled(category, settings) -> boolean
 *   CATEGORY / SETTING_BY_CATEGORY
 */
window.FBDietClassify = (() => {
  'use strict';

  const CATEGORY = {
    SPONSORED: 'sponsored',
    SUGGESTED: 'suggested',
    SUGGESTED_GROUP: 'suggestedGroup',
    REELS: 'reels',
    STORIES: 'stories',
    MARKET_ADS: 'marketAds',
    SEARCH_ADS: 'searchingAds',
    REGULAR: 'regular'
  };

  // Maps a category to the group-level storage key owned by the options page / popup
  const SETTING_BY_CATEGORY = {
    sponsored: 'foldAds',
    suggested: 'foldSuggested',
    suggestedGroup: 'foldOther',
    reels: 'foldMedia',
    stories: 'foldMedia',
    marketAds: 'foldAds',
    searchingAds: 'foldAds',
    regular: 'foldRegular'
  };

  // Relay based classification rules (verified against the reference implementation)
  const SUGGESTED_GROUP_TYPENAMES = ['GroupsYouShouldJoinFeedUnit', 'GroupSuggestionsFeedUnit'];
  // The Stories row inserted mid-feed (position ~9-10, homepage_stream) reaches the
  // classifier through the generic CometFeedUnitErrorBoundary.react wrapper, so the
  // component-name list in fold.js never sees it. Its own typename is the signal
  // (STRATEGY.md, decision #7). Same guard as Reels: only the unit's OWN typename
  // counts, never a nested record's.
  const STORIES_TYPENAMES = ['DiscoverFeedUnit'];
  // Only CAN_SUBSCRIBE is trusted, exactly like the reference implementation. CAN_FOLLOW
  // and NOT_SUBSCRIBED were tried and rejected: NOT_SUBSCRIBED matches nearly every actor
  // the viewer does not subscribe to (group post authors, strangers, pages), which folded
  // ordinary friend activity as "suggested" (STRATEGY.md, misclassifications 1 & 2).
  const SUGGESTED_SUBSCRIBE_STATES = ['CAN_SUBSCRIBE'];
  const SUGGESTED_JOIN_STATES = ['CAN_JOIN'];
  // Only a story_header stored under one of these known suggestion location keys WITH a
  // non-empty title counts as suggestion evidence. A location-free story_header is NOT
  // evidence: contextual stories ("X commented on ...") carry a plain story_header too,
  // and folding those hid real friend activity (STRATEGY.md, misclassifications 1 & 2).
  const SUGGESTED_STORY_LOCATIONS = ['homepage_stream', 'groups_tab', 'feed'];

  // The Reels attachment style wrapper only renders reel attachments INSIDE another story
  // (typically a friend's share of a reel). The record that reaches the classifier from
  // this module IS the attachment, whose __typename is ShowcaseFeedUnit, so the typename
  // based Reels rule must be suppressed in this context (STRATEGY.md, misclassification 3).
  const STORY_ATTACHMENT_MODULE = 'CometFeedStoryFBReelsAttachmentStyle.react';

  const SPONSORED_PATH = '^sponsored_data.ad_id';
  const SUBSCRIBE_PATH = '^^actors[0].subscribe_status';
  const JOIN_PATH = '^to.viewer_forum_join_state';
  const STORY_TYPE_PATH = 'showcase_story_type';
  const STORY_HEADER_PATH = '^story_header{$1}.^title.text';

  // Fallback chain used only when FBDietMetadata cannot extract candidate records itself.
  // Order matters: the first truthy value wins (element hierarchies seen in the wild).
  const NESTED_UNIT_PATHS = [
    'children.props.story',
    'children.props.unit',
    'children.props.feedUnit',
    'children.0.props.story',
    'children.0.props.unit',
    'children.0.props.feedUnit',
    'children.0.props.children.props.feedUnit',
    'children.props.children.props.feedUnit',
    'children.props',
    'children.0.props',
    'edge.node',
    'feedEdge.node'
  ];

  let relayRead = () => null;
  // Every Relay read the classifier performs for the current unit, in order.
  // The probe report replays this list so a mis-detection shows exactly which
  // paths were tried and what they returned.
  let relayReads = [];

  function setRelayReader(reader) {
    if (typeof reader === 'function') relayRead = reader;
  }

  function safeRelayRead(ids, path, options) {
    try {
      const value = relayRead(ids, path, options);
      relayReads.push({ path, value: value === undefined ? null : value });
      return value === undefined ? null : value;
    } catch (e) {
      relayReads.push({ path, value: null });
      return null;
    }
  }

  function readProp(object, path) {
    let current = object;
    for (const part of String(path).split('.')) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  /** First truthy value among an ordered list of prop paths. */
  function readFirstProp(object, paths) {
    for (const path of paths) {
      const value = readProp(object, path);
      if (value) return value;
    }
    return null;
  }

  /** Ordered, duplicate free list of the given objects (skips falsy entries). */
  function uniqueObjects(candidates) {
    const list = [];
    for (const candidate of candidates) {
      if (candidate && list.indexOf(candidate) === -1) list.push(candidate);
    }
    return list;
  }

  function toStringOrNull(value) {
    return typeof value === 'string' && value ? value : null;
  }

  /**
   * Candidate records extractor delegated to FBDietMetadata to eliminate code duplication.
   */
  function extractCandidateRecords(roots) {
    if (typeof window !== 'undefined' && window.FBDietMetadata && typeof window.FBDietMetadata.extractCandidateRecords === 'function') {
      return window.FBDietMetadata.extractCandidateRecords(roots);
    }
    return [];
  }

  /**
   * Extracts everything the classifier may need from a feed unit's props.
   * Handles various React element hierarchies (children as object or array, nested props, edges).
   */
  function collectUnit(payload, context) {
    const lastCmp = context && context.lastCmp ? context.lastCmp : null;
    const candidateRecords = extractCandidateRecords([payload, lastCmp]);

    const feedUnit = readProp(payload, 'feedUnit') || readProp(payload, 'unit') || null;
    const nestedUnit = candidateRecords.length > 0
      ? candidateRecords[0]
      : readFirstProp(payload, NESTED_UNIT_PATHS);
    const record = feedUnit || nestedUnit || null;

    const ids = [];
    const candidates = [
      readProp(feedUnit, '__id'),
      readProp(feedUnit, 'id'),
      readProp(nestedUnit, '__id'),
      readProp(nestedUnit, 'id'),
      readProp(payload, '__id'),
      readProp(payload, 'id')
    ];
    for (const rec of candidateRecords) {
      if (rec) {
        candidates.push(readProp(rec, '__id'));
        candidates.push(readProp(rec, 'id'));
      }
    }
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate && ids.indexOf(candidate) === -1) ids.push(candidate);
    }

    // ownTypename must never be derived from the nested attachment record: a friend's
    // share of a reel nests a ShowcaseFeedUnit inside an ordinary Story, and only the
    // unit itself being a ShowcaseFeedUnit identifies a Reels surface.
    const ownTypename =
      toStringOrNull(readProp(payload, 'unitTypename')) ||
      toStringOrNull(readProp(feedUnit, '__typename')) ||
      toStringOrNull(readProp(payload, '__typename'));
    const nestedTypename = toStringOrNull(readProp(nestedUnit, '__typename'));

    // Flattened evidence lookup orders. `sources` is the wide candidate set (record, nested
    // unit, candidate records) with duplicate references dropped, so no source is scanned
    // twice. `ownRecords` is the narrow set only the boolean ad flags may read: a nested
    // candidate record must never sponsor-flag the unit.
    const sources = uniqueObjects([record, nestedUnit, feedUnit].concat(candidateRecords));
    const ownRecords = uniqueObjects([record, feedUnit, nestedUnit]);

    return {
      sources,
      ownRecords,
      ids,
      // Reporting / debug value; prefers the unit's own typename and only falls back to
      // the nested attachment record for diagnostics.
      unitTypename: ownTypename || nestedTypename,
      ownTypename,
      nestedTypename
    };
  }
/* ------------------------------------------------------------------ *
   * Classification
   * ------------------------------------------------------------------ */

  function detectActionSignal(record) {
    if (!record || typeof record !== 'object') return null;
    const links = [
      readProp(record, 'action_links'),
      readProp(record, 'story.action_links'),
      readProp(record, 'comet_sections.header.story.action_links'),
      readProp(record, 'call_to_action')
    ];
    for (const raw of links) {
      if (!raw) continue;
      const list = Array.isArray(raw) ? raw : [raw];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const actionType = String(item.action_type || item.type || '').toUpperCase();
        const text = String(item.text || item.title || '');
        if (actionType === 'SUBSCRIBE' || actionType === 'FOLLOW' || text === '追蹤' || text === 'Follow') {
          return 'subscribe';
        }
        if (actionType === 'JOIN_GROUP' || actionType === 'JOIN' || text === '加入' || text === 'Join') {
          return 'join_group';
        }
      }
    }
    return null;
  }

  function detectRecommendationHeader(record) {
    if (!record || typeof record !== 'object') return null;
    const candidates = [
      readProp(record, 'comet_sections.header.story.title.text'),
      readProp(record, 'story_header.title.text'),
      readProp(record, 'feed_context.text'),
      readProp(record, 'context_layout.text')
    ];
    for (const cand of candidates) {
      if (typeof cand === 'string' && cand) {
        const trimmed = cand.trim();
        if (
          trimmed === '為你推薦' ||
          trimmed === 'Suggested for you' ||
          trimmed.indexOf('為你推薦') !== -1 ||
          trimmed.indexOf('Suggested for you') !== -1 ||
          trimmed.indexOf('推薦你加入') !== -1
        ) {
          if (trimmed.indexOf('留言') === -1 && trimmed.indexOf('回應') === -1 && trimmed.indexOf('commented') === -1) {
            return trimmed;
          }
        }
      }
    }
    return null;
  }

  /**
   * Reads one piece of evidence from the props first and from the Relay store second.
   * Direct props are free, so they are always tried before touching the store.
   */
  function gatherEvidence(unit) {
    const evidence = {
      ownTypename: unit.ownTypename,
      nestedTypename: unit.nestedTypename,
      adId: null,
      subscribeStatus: null,
      joinState: null,
      actionSignal: null,
      recHeader: null,
      source: 'none',
      id: unit.ids && unit.ids.length ? unit.ids[0] : null,
      idCount: unit.ids ? unit.ids.length : 0
    };

    const sources = unit.sources || [];

    /** First string value for a path across the unit's flattened prop sources. */
    function readCandidateProp(path) {
      for (const source of sources) {
        const value = toStringOrNull(readProp(source, path));
        if (value) return value;
      }
      return null;
    }

    /** First raw value for a path across the unit's own records (record / feedUnit / nested). */
    function readOwnRaw(path) {
      for (const own of unit.ownRecords || []) {
        const value = readProp(own, path);
        if (value) return value;
      }
      return null;
    }

    /** True when any of the unit's own records carries an explicit boolean flag. */
    function hasOwnFlag(path) {
      for (const own of unit.ownRecords || []) {
        if (readProp(own, path) === true) return true;
      }
      return false;
    }

    // 1. Direct props
    const spoObj = readOwnRaw('th_dat_spo');
    evidence.adId =
      readCandidateProp('sponsored_data.ad_id') ||
      readCandidateProp('sponsored_data.client_token') ||
      (spoObj ? 'th_dat_spo' : null) ||
      (hasOwnFlag('is_sponsored') ? 'is_sponsored' : null);

    evidence.subscribeStatus =
      readCandidateProp('actors.0.subscribe_status') ||
      readCandidateProp('actor.subscribe_status') ||
      readCandidateProp('story.actors.0.subscribe_status') ||
      readCandidateProp('comet_sections.header.story.actors.0.subscribe_status') ||
      readCandidateProp('comet_sections.content.story.actors.0.subscribe_status');

    evidence.joinState =
      readCandidateProp('to.viewer_forum_join_state') ||
      readCandidateProp('story.to.viewer_forum_join_state') ||
      readCandidateProp('comet_sections.header.story.to.viewer_forum_join_state') ||
      readCandidateProp('to.viewer_join_state') ||
      readCandidateProp('story.to.viewer_join_state');

    let actionSig = null;
    let recHdr = null;
    for (const source of sources) {
      if (!actionSig) actionSig = detectActionSignal(source);
      if (!recHdr) recHdr = detectRecommendationHeader(source);
      if (actionSig && recHdr) break;
    }

    evidence.actionSignal = actionSig;
    evidence.recHeader = recHdr;

    if (evidence.adId || evidence.subscribeStatus || evidence.joinState || evidence.actionSignal || evidence.recHeader) {
      evidence.source = 'props';
    }

    if (!unit.ids.length) return evidence;

    // 2. Relay store
    if (!evidence.adId) {
      let value = safeRelayRead(unit.ids, SPONSORED_PATH);
      if (!value) value = safeRelayRead(unit.ids, '^sponsored_data.client_token');
      if (!value && safeRelayRead(unit.ids, 'is_sponsored') === true) value = 'is_sponsored';
      if (value) {
        evidence.adId = String(value);
        evidence.source = 'relay';
      }
    }
    if (!evidence.subscribeStatus) {
      let value = safeRelayRead(unit.ids, SUBSCRIBE_PATH);
      if (!value) value = safeRelayRead(unit.ids, '^actors[0].subscribe_status');
      if (!value) value = safeRelayRead(unit.ids, '^actor.subscribe_status');
      if (value) {
        evidence.subscribeStatus = String(value);
        evidence.source = 'relay';
      }
    }
    if (!evidence.joinState) {
      const value = safeRelayRead(unit.ids, JOIN_PATH);
      if (value) {
        evidence.joinState = String(value);
        evidence.source = 'relay';
      }
    }

    return evidence;
  }

  /**
   * Assigns a single category. Order matters: an ad that is also a group suggestion must
   * be reported as an ad, and a unit is never classified twice.
   */
  function pickCategory(evidence, context) {
    if (evidence.adId) {
      const reason = evidence.adId === 'th_dat_spo' ? 'th_dat_spo' : (evidence.adId === 'is_sponsored' ? 'is_sponsored' : 'sponsored_data.ad_id');
      return { category: CATEGORY.SPONSORED, reason };
    }

    const typename = evidence.ownTypename || evidence.nestedTypename;
    if (typename && SUGGESTED_GROUP_TYPENAMES.indexOf(typename) !== -1) {
      return { category: CATEGORY.SUGGESTED_GROUP, reason: 'unitTypename:' + typename };
    }
    // A plain Story with viewer_forum_join_state CAN_JOIN is a "suggested for you"
    // group post from a group the viewer has not joined: it folds with the suggested
    // surface (STRATEGY.md, decision #10). Only the horizontal GYSJ list unit above
    // is suggestedGroup / the "Other" group.
    if (evidence.joinState && SUGGESTED_JOIN_STATES.indexOf(evidence.joinState) !== -1) {
      return { category: CATEGORY.SUGGESTED, reason: 'to.viewer_forum_join_state' };
    }
    if (evidence.subscribeStatus && SUGGESTED_SUBSCRIBE_STATES.indexOf(evidence.subscribeStatus) !== -1) {
      return { category: CATEGORY.SUGGESTED, reason: 'actors[0].subscribe_status' };
    }
    // Action links: follow/subscribe buttons or join group buttons
    if (evidence.actionSignal === 'subscribe') {
      return { category: CATEGORY.SUGGESTED, reason: 'action_links:subscribe' };
    }
    if (evidence.actionSignal === 'join_group') {
      return { category: CATEGORY.SUGGESTED, reason: 'action_links:join_group' };
    }
    // Explicit suggestion header: "為你推薦" / "Suggested for you"
    if (evidence.recHeader) {
      return { category: CATEGORY.SUGGESTED, reason: 'header:' + evidence.recHeader };
    }
    // NOTE: there is deliberately NO story_header rule (STRATEGY.md, decision #6).

    // The mid-feed Stories row is a DiscoverFeedUnit delivered through the generic
    // feed unit wrapper, so it needs a typename rule of its own (STRATEGY.md, #7).
    if (evidence.ownTypename && STORIES_TYPENAMES.indexOf(evidence.ownTypename) !== -1) {
      return { category: CATEGORY.STORIES, reason: 'unitTypename:' + evidence.ownTypename };
    }

    // Reels is only the clear-cut Reels surface (the rail / showcase feed units).
    // Two guards keep friend shares visible (STRATEGY.md, misclassification 3):
    //   1. The ShowcaseFeedUnit typename must belong to the unit itself. A friend's share
    //      of a reel nests a ShowcaseFeedUnit attachment inside an ordinary Story, and a
    //      typename read off that nested record is NOT a Reels surface.
    //   2. The Reels attachment style wrapper renders attachments by definition, so units
    //      arriving through it never fold as Reels.
    if (evidence.ownTypename === 'ShowcaseFeedUnit' && !(context && context.moduleName === STORY_ATTACHMENT_MODULE)) {
      return { category: CATEGORY.REELS, reason: 'unitTypename:ShowcaseFeedUnit' };
    }

    // No rule matched. If we have at least one unit id the unit is identifiable
    // but unclassified — it is a 'regular' post (decision #16). Only units with
    // zero ids (no-payload / no-unit-id) keep category: null so that truly
    // unidentifiable remnants are still excluded from stats and folding.
    if (evidence.idCount > 0) {
      return { category: CATEGORY.REGULAR, reason: 'no-match' };
    }
    return { category: null, reason: 'no-unit-id' };
  }

  /** Unit ids are opaque base64 blobs; show a short fingerprint instead. */
  function shortUnitId(id) {
    if (!id) return '-';
    return id.length > 10 ? '…' + id.slice(-10) : id;
  }

  /** Bound to the bridge's shared debug flag (URL fb_diet_debug=1 / __fbDietDebug()). */
  function isDebugEnabled() {
    const bridge = window.FBDietBridge;
    if (bridge && typeof bridge.isDebugEnabled === 'function') return bridge.isDebugEnabled();
    return /[?&]fb_diet_debug=1(?:&|$)/.test(window.location.search);
  }

  function classifyFeedUnit(payload, context) {
    // Fresh read log per unit: the probe reports the reads of THIS unit only.
    relayReads = [];
    const result = {
      category: null,
      unitId: null,
      unitTypename: null,
      reason: 'no-payload',
      evidence: null,
      moduleName: context && context.moduleName ? context.moduleName : null
    };

    try {
      if (!payload || typeof payload !== 'object') return result;

      const unit = collectUnit(payload, context);
      result.unitTypename = unit.unitTypename;
      result.unitId = unit.ids.length ? unit.ids[0] : null;

      const evidence = gatherEvidence(unit);
      result.evidence = evidence;

      const picked = pickCategory(evidence, context);
      result.category = picked.category;
      result.reason = picked.reason;

      if (result.category && isDebugEnabled()) {
        console.info('[FB Diet][Classify] Matched:', result.category, 'for unit:', shortUnitId(result.unitId), '(' + (result.unitTypename || 'no-type') + ')', 'reason:', result.reason, 'module:', result.moduleName || '-', 'evidence:', result.evidence);
      }

      return result;
    } catch (e) {
      result.reason = 'error:' + (e && e.message ? e.message : String(e));
      return result;
    }
  }

  /* ------------------------------------------------------------------ *
   * Probe report analysis (options page debug card)
   *
   * classifyProbeReport re-runs the CURRENT rules over a probe report copied
   * from a feed 🔍 button. The captured classification is the verdict; the
   * re-run is a comparison aid. Reports no longer embed a Relay record dump
   * (see STRATEGY.md, decision #11), and a relayRecord field from an older
   * report is still honored as a single-record snapshot, so paths that follow
   * linked records (^ / ^^) cannot resolve and read as null on re-run.
   * null. Diagnostics must never throw, exactly like the live classifier.
   * ------------------------------------------------------------------ */

  /**
   * Reads a Relay-style field path against a serialized record snapshot.
   * Only the snapshot's own plain fields can be read: a ^ / ^^ hop, an indexed lookup or
   * a __ref / __refs value needs a linked record that lives outside the snapshot by
   * design, so such a path resolves to null (see the note above). This is exactly the
   * subset the classifier asks for — every RELAY_PATHS entry is keyed by a ^ hop, and the
   * only plain field it reads is `is_sponsored`.
   */
  function readSnapshotPath(record, path) {
    try {
      if (!record || typeof record !== 'object' || !path) return null;
      let current = record;
      for (const segment of String(path).split('.')) {
        if (segment.indexOf('^') === 0) return null;
        if (segment.indexOf('[') !== -1) return null;
        if (current === null || current === undefined || typeof current !== 'object') return null;
        const field = current[segment];
        if (field && typeof field === 'object' && typeof field.__ref === 'string') return null;
        current = field;
      }
      if (current && typeof current === 'object') return null;
      return current === undefined ? null : current;
    } catch (e) {
      return null;
    }
  }

  /**
   * Analyzes a probe report object (already parsed from JSON).
   * Returns { ok, error?, captured, current, relayAvailable }.
   *   error codes: 'not-an-object' | 'missing-classify' | 'missing-payload'
   */
  function classifyProbeReport(report) {
    const empty = { ok: false, error: null, captured: null, current: null, relayAvailable: false };
    try {
      if (!report || typeof report !== 'object' || Array.isArray(report)) {
        return { ...empty, error: 'not-an-object' };
      }
      const captured = report.classify && typeof report.classify === 'object' ? report.classify : null;
      if (!captured) return { ...empty, error: 'missing-classify' };
      if (!report.payload || typeof report.payload !== 'object') {
        return { ...empty, error: 'missing-payload', captured };
      }

      const relayRecord = report.relayRecord && typeof report.relayRecord === 'object' ? report.relayRecord : null;
      const previousReader = relayRead;
      let current;
      const previousReads = relayReads;
      try {
        relayReads = [];
        relayRead = (ids, path) => readSnapshotPath(relayRecord, path);
        current = classifyFeedUnit(report.payload, { moduleName: report.moduleName || null });
      } finally {
        // Never leak the snapshot reader into the caller's classifier state.
        relayRead = previousReader;
        relayReads = previousReads;
      }
      return { ok: true, error: null, captured, current, relayAvailable: Boolean(relayRecord) };
    } catch (e) {
      return { ...empty, error: 'error:' + (e && e.message ? e.message : String(e)) };
    }
  }

  /** Shared defaults module: loaded before the MAIN world scripts in every context. */
  function getDefaults() {
    if (typeof window !== 'undefined' && window.FB_DIET_DEFAULTS) return window.FB_DIET_DEFAULTS;
    return (typeof globalThis !== 'undefined' && globalThis.FB_DIET_DEFAULTS) || null;
  }

  /**
   * Resolves one category's fold mode from the shared settings schema. FB_DIET_DEFAULTS
   * owns the single normalization of stored values onto 'off' / 'mini' / 'title'; without
   * that module the classifier fails closed instead of guessing a fold mode.
   */
  function getCategoryFoldMode(category, settings) {
    if (!settings || settings.enabled === false) return 'off';
    const key = SETTING_BY_CATEGORY[category];
    if (!key) return 'off';
    const defaults = getDefaults();
    if (!defaults || typeof defaults.normalizeFoldMode !== 'function') return 'off';
    const schema = defaults.SETTINGS || {};
    const val = settings[key] !== undefined ? settings[key] : (schema[key] !== undefined ? schema[key] : false);
    return defaults.normalizeFoldMode(val, 'off', Boolean(settings.minimizedFoldMode));
  }

  function isCategoryEnabled(category, settings) {
    return getCategoryFoldMode(category, settings) !== 'off';
  }

  return {
    CATEGORY,
    SETTING_BY_CATEGORY,
    getCategoryFoldMode,
    SUGGESTED_GROUP_TYPENAMES,
    STORIES_TYPENAMES,
    RELAY_PATHS: {
      SPONSORED_PATH,
      SUBSCRIBE_PATH,
      JOIN_PATH,
      STORY_TYPE_PATH,
      STORY_HEADER_PATH
    },
    setRelayReader,
    getLastRelayReads: () => relayReads.slice(),
    classifyFeedUnit,
    classifyProbeReport,
    isCategoryEnabled,
    readProp
  };
})();