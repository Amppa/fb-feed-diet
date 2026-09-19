/**
 * FB Diet - Feed unit classifier (MAIN world, pure functions)
 *
 * Turns the props of a Facebook feed unit plus a Relay reader into one of FB Diet's
 * categories. Everything here is side effect free and dependency injected, so the exact
 * same code is unit tested under Node (see tests/classify.test.js).
 *
 * Evidence fields are always returned, even when nothing matched: they are what gets
 * logged for unknown units so mis-detections can be diagnosed without guessing.
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
    sponsored: 'removeSponsored',
    suggested: 'removeSuggested',
    suggestedGroup: 'removeSuggestedGroup',
    reels: 'removeReels',
    stories: 'removeStories',
    marketAds: 'removeMarketAds',
    searchingAds: 'removeSearchingAds'
  };

  // Relay based classification rules (verified against the reference implementation)
  const SUGGESTED_GROUP_TYPENAMES = ['GroupsYouShouldJoinFeedUnit', 'GroupSuggestionsFeedUnit'];
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

  function setRelayReader(reader) {
    if (typeof reader === 'function') relayRead = reader;
  }

  function safeRelayRead(ids, path, options) {
    try {
      const value = relayRead(ids, path, options);
      return value === undefined ? null : value;
    } catch (e) {
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
    // Only a story_header stored under a known suggestion location key WITH a real title
    // counts as suggestion evidence. Existence-only and location-free checks were removed
    // on purpose: contextual stories ("X commented on ...", shared group posts) carry a
    // plain story_header too, and those must stay visible
    // (STRATEGY.md, misclassifications 1 & 2).
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
    if (evidence.joinState && SUGGESTED_JOIN_STATES.indexOf(evidence.joinState) !== -1) {
      return { category: CATEGORY.SUGGESTED_GROUP, reason: 'to.viewer_forum_join_state' };
    }
    if (evidence.subscribeStatus && SUGGESTED_SUBSCRIBE_STATES.indexOf(evidence.subscribeStatus) !== -1) {
      return { category: CATEGORY.SUGGESTED, reason: 'actors[0].subscribe_status' };
    }
    if (evidence.storyLocation) {
      return { category: CATEGORY.SUGGESTED, reason: 'story_header:' + evidence.storyLocation };
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

    return { category: null, reason: evidence.ids.length ? 'unknown' : 'no-unit-id' };
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
    RELAY_PATHS: {
      SPONSORED_PATH,
      SUBSCRIBE_PATH,
      JOIN_PATH,
      STORY_TYPE_PATH,
      STORY_HEADER_PATH
    },
    setRelayReader,
    classifyFeedUnit,
    isCategoryEnabled,
    readProp
  };
})();