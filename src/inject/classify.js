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
    SEARCH_ADS: 'searchingAds'
  };

  // Maps a category to the storage key owned by the options page / popup
  const SETTING_BY_CATEGORY = {
    sponsored: 'foldSponsored',
    suggested: 'foldSuggested',
    suggestedGroup: 'foldSuggestedGroup',
    reels: 'foldReels',
    stories: 'foldStories',
    marketAds: 'foldMarketAds',
    searchingAds: 'foldSearchingAds'
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

  function toStringOrNull(value) {
    return typeof value === 'string' && value ? value : null;
  }

  /**
   * Extracts everything the classifier may need from a feed unit's props.
   * Handles various React element hierarchies (children as object or array, nested props, edges).
   */
  function collectUnit(payload) {
    const feedUnit = readProp(payload, 'feedUnit') || readProp(payload, 'unit') || null;
    const nestedUnit =
      readProp(payload, 'children.0.props.children.props.feedUnit') ||
      readProp(payload, 'children.props.children.props.feedUnit') ||
      readProp(payload, 'children.props.feedUnit') ||
      readProp(payload, 'children.0.props.feedUnit') ||
      readProp(payload, 'edge.node') ||
      readProp(payload, 'feedEdge.node') ||
      null;
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

    return {
      feedUnit,
      nestedUnit,
      record,
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

  /**
   * Reads one piece of evidence from the props first and from the Relay store second.
   * Direct props are free, so they are always tried before touching the store.
   */
  function gatherEvidence(unit) {
    const evidence = {
      unitTypename: unit.unitTypename,
      ownTypename: unit.ownTypename,
      nestedTypename: unit.nestedTypename,
      ids: unit.ids.slice(0, 4),
      adId: null,
      subscribeStatus: null,
      joinState: null,
      storyType: null,
      storyLocation: null,
      storyTitle: null,
      source: 'none'
    };

    // 1. Direct props
    evidence.adId =
      toStringOrNull(readProp(unit.record, 'sponsored_data.ad_id')) ||
      toStringOrNull(readProp(unit.record, 'sponsored_data.client_token')) ||
      (readProp(unit.record, 'is_sponsored') === true ? 'is_sponsored' : null);
    evidence.subscribeStatus =
      toStringOrNull(readProp(unit.record, 'actors.0.subscribe_status')) ||
      toStringOrNull(readProp(unit.record, 'actor.subscribe_status'));
    evidence.joinState = toStringOrNull(readProp(unit.record, 'to.viewer_forum_join_state'));
    evidence.storyType = toStringOrNull(readProp(unit.record, 'showcase_story_type'));
    if (evidence.adId || evidence.subscribeStatus || evidence.joinState || evidence.storyType) {
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
    if (!evidence.storyType) {
      const value = safeRelayRead(unit.ids, STORY_TYPE_PATH);
      if (value) {
        evidence.storyType = String(value);
        evidence.source = 'relay';
      }
    }
    // story_header is collected as DIAGNOSTIC information only and must never decide a
    // category: the probe proved Facebook stores contextual stories under the SAME
    // keyed record as suggestion headers - the header of a friend said recently-commented
    // story lives in client:1238:story_header(location:homepage_stream):title. Header
    // titles vary by language and format, so no rule can separate suggestions from
    // friend activity here (STRATEGY.md, decision #6).
    for (const location of SUGGESTED_STORY_LOCATIONS) {
      const opts = { $1: { location }, params: { $1: { location } } };
      const title = toStringOrNull(safeRelayRead(unit.ids, STORY_HEADER_PATH, opts));
      if (title) {
        evidence.storyLocation = location;
        evidence.storyTitle = title;
        evidence.source = 'relay';
        break;
      }
    }

    return evidence;
  }

  /**
   * Assigns a single category. Order matters: an ad that is also a group suggestion must
   * be reported as an ad, and a unit is never classified twice.
   */
  function pickCategory(evidence, context) {
    if (evidence.adId) return { category: CATEGORY.SPONSORED, reason: 'sponsored_data.ad_id' };

    if (evidence.unitTypename && SUGGESTED_GROUP_TYPENAMES.indexOf(evidence.unitTypename) !== -1) {
      return { category: CATEGORY.SUGGESTED_GROUP, reason: 'unitTypename:' + evidence.unitTypename };
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
    // NOTE: there is deliberately NO story_header rule. The probe proved Facebook stores
    // a friend said recently-commented story under the SAME
    // story_header(location:homepage_stream) record as suggestion headers, so a header
    // title cannot separate suggestions from friend activity (STRATEGY.md, decision #6).

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
    //      arriving through it never fold as Reels. (showcase_story_type alone is
    //      likewise NOT enough: an ordinary Story sharing a reel carries it too.)
    if (evidence.ownTypename === 'ShowcaseFeedUnit' && !(context && context.moduleName === STORY_ATTACHMENT_MODULE)) {
      return { category: CATEGORY.REELS, reason: 'unitTypename:ShowcaseFeedUnit' };
    }

    // No rule matched. 'no-match' belongs to the no-* absence family (no-unit-id /
    // no-payload) and never claims the unit IS a normal post: a missed suggestion
    // carries the same category: null, which is exactly what the probe is for.
    return { category: null, reason: evidence.ids.length ? 'no-match' : 'no-unit-id' };
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

      const unit = collectUnit(payload);
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
   * Supports the subset of syntax used by RELAY_PATHS: direct fields,
   * ^ linked-record hops (__ref), ^^ linked-list hops (__refs), {$1}
   * keyed variables. Linked records live outside the snapshot by design,
   * so any hop through __ref / __refs resolves to null (see the note above).
   */
  function readSnapshotPath(record, path, options) {
    try {
      if (!record || typeof record !== 'object' || !path) return null;
      let current = record;
      for (const rawSegment of String(path).split('.')) {
        let segment = rawSegment;
        let linkList = false;
        let index = 0;
        if (segment.indexOf('^^') === 0) {
          linkList = true;
          segment = segment.slice(2);
        } else if (segment.indexOf('^') === 0) {
          segment = segment.slice(1);
        }
        const bracket = segment.indexOf('[');
        if (bracket !== -1) {
          index = parseInt(segment.slice(bracket + 1), 10) || 0;
          segment = segment.slice(0, bracket);
          linkList = true;
        }
        const variable = segment.indexOf('{$1}');
        if (variable !== -1) {
          const vars = options && options.$1;
          if (!vars || typeof vars !== 'object') return null;
          const args = Object.keys(vars).map((key) => key + ':' + vars[key]).join(',');
          segment = segment.slice(0, variable) + '(' + args + ')';
        }
        if (current === null || current === undefined || typeof current !== 'object') return null;
        if (linkList) {
          const refs = current[segment] && current[segment].__refs;
          const ref = Array.isArray(refs) ? refs[index] : undefined;
          if (typeof ref !== 'string') return null;
          return null; // linked record lives outside the snapshot
        }
        const field = current[segment];
        if (field && typeof field === 'object' && typeof field.__ref === 'string') {
          return null; // linked record lives outside the snapshot
        }
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
        relayRead = (ids, path, options) => readSnapshotPath(relayRecord, path, options);
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

  function isCategoryEnabled(category, settings) {
    if (!settings || settings.enabled === false) return false;
    const key = SETTING_BY_CATEGORY[category];
    if (!key) return false;
    return settings[key] !== false;
  }

  return {
    CATEGORY,
    SETTING_BY_CATEGORY,
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