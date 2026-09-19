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
 *   classifyFeedUnit(payload)             -> { category, unitId, unitTypename, reason, evidence }
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
  const SUGGESTED_SUBSCRIBE_STATES = ['CAN_SUBSCRIBE', 'CAN_FOLLOW', 'NOT_SUBSCRIBED'];
  const SUGGESTED_JOIN_STATES = ['CAN_JOIN'];
  const REELS_STORY_TYPES = ['SHOWCASE_SHORT_VIDEO'];
  const SUGGESTED_STORY_LOCATIONS = ['homepage_stream', 'groups_tab', 'feed'];

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

    return {
      feedUnit,
      nestedUnit,
      record,
      ids,
      unitTypename:
        toStringOrNull(readProp(payload, 'unitTypename')) ||
        toStringOrNull(readProp(record, '__typename')) ||
        toStringOrNull(readProp(payload, '__typename'))
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
      ids: unit.ids.slice(0, 4),
      adId: null,
      subscribeStatus: null,
      joinState: null,
      storyType: null,
      storyLocation: null,
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
    for (const location of SUGGESTED_STORY_LOCATIONS) {
      const opts = { $1: { location }, params: { $1: { location } } };
      let value = safeRelayRead(unit.ids, STORY_HEADER_PATH, opts);
      if (!value) {
        // Also check if story_header linked record exists for this location
        const headerRec = safeRelayRead(unit.ids, '^story_header{$1}', opts);
        if (headerRec) value = location;
      }
      if (value) {
        evidence.storyLocation = location;
        evidence.source = 'relay';
        break;
      }
    }
    if (!evidence.storyLocation) {
      // Check location-free story_header
      let val = safeRelayRead(unit.ids, '^story_header.^title.text');
      if (!val) val = safeRelayRead(unit.ids, '^story_header.title.text');
      if (!val && safeRelayRead(unit.ids, '^story_header')) val = 'header';
      if (val) {
        evidence.storyLocation = 'header';
        evidence.source = 'relay';
      }
    }

    return evidence;
  }

  /**
   * Assigns a single category. Order matters: an ad that is also a group suggestion must
   * be reported as an ad, and a unit is never classified twice.
   */
  function pickCategory(evidence) {
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
    if (evidence.storyType && REELS_STORY_TYPES.indexOf(evidence.storyType) !== -1) {
      return { category: CATEGORY.REELS, reason: 'showcase_story_type' };
    }
    if (evidence.unitTypename === 'ShowcaseFeedUnit') {
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

  function classifyFeedUnit(payload) {
    const result = { category: null, unitId: null, unitTypename: null, reason: 'no-payload', evidence: null };

    try {
      if (!payload || typeof payload !== 'object') return result;

      const unit = collectUnit(payload);
      result.unitTypename = unit.unitTypename;
      result.unitId = unit.ids.length ? unit.ids[0] : null;

      const evidence = gatherEvidence(unit);
      result.evidence = evidence;

      const picked = pickCategory(evidence);
      result.category = picked.category;
      result.reason = picked.reason;

      if (result.category && isDebugEnabled()) {
        console.info('[FB Diet][Classify] Matched:', result.category, 'for unit:', shortUnitId(result.unitId), '(' + (result.unitTypename || 'no-type') + ')', 'reason:', result.reason);
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