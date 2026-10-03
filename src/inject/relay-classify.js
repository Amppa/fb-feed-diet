/**
 * FB Diet - Relay store classifier: props + Relay store -> category.
 * Four-stage pipeline; stages, priority, triggers in STRATEGY.md §2. // per STRATEGY.md §2
 */
window.FBDietRelayClassify = (() => {
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

  const SUGGESTED_GROUP_TYPENAMES = ['GroupsYouShouldJoinFeedUnit', 'GroupSuggestionsFeedUnit'];
  // Own typename only, never nested. // per STRATEGY.md §2.1
  const STORIES_TYPENAMES = ['DiscoverFeedUnit'];
  // Only CAN_SUBSCRIBE trusted; NOT_SUBSCRIBED folds ordinary friend activity. // per STRATEGY.md §4
  const SUGGESTED_SUBSCRIBE_STATES = ['CAN_SUBSCRIBE'];
  const SUGGESTED_JOIN_STATES = ['CAN_JOIN'];

  // Attachment record IS the attachment; suppress Reels rule here. // per STRATEGY.md §4
  const STORY_ATTACHMENT_MODULE = 'CometFeedStoryFBReelsAttachmentStyle.react';

  const SPONSORED_PATH = '^sponsored_data.ad_id';
  const SUBSCRIBE_PATH = '^^actors[0].subscribe_status';
  const JOIN_PATH = '^to.viewer_forum_join_state';

  // Fallback chain; first truthy wins.
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
  // Relay reads for the current unit, in order (replayed by probe report).
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

  /** Path lookup via defaults.js; absent module fails closed to 'regular'. */
  let sharedDefaults = null;
  function readProp(object, path) {
    if (sharedDefaults === null) sharedDefaults = getDefaults();
    const shared = sharedDefaults;
    return shared && typeof shared.readProp === 'function' ? shared.readProp(object, path) : undefined;
  }

  /** First truthy value some record has at a path. */
  function firstTruthy(items, read) {
    for (const item of items || []) {
      const value = read(item);
      if (value) return value;
    }
    return null;
  }

  function readFirstProp(object, paths) {
    return firstTruthy(paths, (path) => readProp(object, path));
  }

  function firstPropString(sources, path) {
    return firstTruthy(sources, (source) => toStringOrNull(readProp(source, path)));
  }

  function firstPropRaw(records, path) {
    return firstTruthy(records, (record) => readProp(record, path));
  }

  function hasOwnFlag(records, path) {
    return (records || []).some((record) => readProp(record, path) === true);
  }

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

  /** Candidate records via FBDietRelayMetadata. */
  function extractCandidateRecords(roots) {
    if (typeof window !== 'undefined' && window.FBDietRelayMetadata && typeof window.FBDietRelayMetadata.extractCandidateRecords === 'function') {
      return window.FBDietRelayMetadata.extractCandidateRecords(roots);
    }
    return [];
  }

  /** Extract everything the classifier may need from props. */
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

    // Own typename only; nested attachment never counts. // per STRATEGY.md §4
    const ownTypename =
      toStringOrNull(readProp(payload, 'unitTypename')) ||
      toStringOrNull(readProp(feedUnit, '__typename')) ||
      toStringOrNull(readProp(payload, '__typename'));
    const nestedTypename = toStringOrNull(readProp(nestedUnit, '__typename'));

    // Wide `sources` vs narrow `ownRecords` (ad flags only).
    const sources = uniqueObjects([record, nestedUnit, feedUnit].concat(candidateRecords));
    const ownRecords = uniqueObjects([record, feedUnit, nestedUnit]);

    return {
      sources,
      ownRecords,
      ids,
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

  /** Ad marker, free props read. Boolean flags from `ownRecords` only. */
  function readAdMarker(sources, ownRecords) {
    return (
      firstPropString(sources, 'sponsored_data.ad_id') ||
      firstPropString(sources, 'sponsored_data.client_token') ||
      (firstPropRaw(ownRecords, 'th_dat_spo') ? 'th_dat_spo' : null) ||
      (hasOwnFlag(ownRecords, 'is_sponsored') ? 'is_sponsored' : null) ||
      null
    );
  }

  function adIdReason(adId) {
    if (adId === 'th_dat_spo') return 'th_dat_spo';
    if (adId === 'is_sponsored') return 'is_sponsored';
    return 'sponsored_data.ad_id';
  }

  /** Evidence block: full key set, null until read. */
  function makeEvidence(unit) {
    return {
      ownTypename: unit.ownTypename,
      nestedTypename: unit.nestedTypename,
      adId: null,
      subscribeStatus: null,
      joinState: null,
      actionSignal: null,
      recHeader: null,
      source: 'props',
      id: unit.ids && unit.ids.length ? unit.ids[0] : null,
      idCount: unit.ids ? unit.ids.length : 0
    };
  }

  /** Store ad probe, props-first fallback order. */
  function probeAdFromStore(unit) {
    let value = safeRelayRead(unit.ids, SPONSORED_PATH);
    if (!value) value = safeRelayRead(unit.ids, '^sponsored_data.client_token');
    if (!value && safeRelayRead(unit.ids, 'is_sponsored') === true) value = 'is_sponsored';
    return value ? String(value) : null;
  }

  function sponsoredVerdict(adId) {
    return { category: CATEGORY.SPONSORED, reason: adIdReason(adId), signal: adId };
  }

  function suggestedVerdict(reason, signal) {
    return { category: CATEGORY.SUGGESTED, reason: reason, signal: signal };
  }

  /** Stage 1 — structural fast path: ads first, then tray typenames. */
  function stage1Structural(unit, context, evidence) {
    let adId = readAdMarker(unit.sources, unit.ownRecords);
    if (!adId && unit.ids.length) {
      adId = probeAdFromStore(unit);
      if (adId) evidence.source = 'relay';
    }
    if (adId) {
      evidence.adId = adId;
      return sponsoredVerdict(adId);
    }

    // Own typename only. // per STRATEGY.md §4
    const own = unit.ownTypename;

    // Mid-feed Stories row needs its own typename rule. // per STRATEGY.md §2.1
    if (own && STORIES_TYPENAMES.indexOf(own) !== -1) {
      return { category: CATEGORY.STORIES, reason: 'unitTypename:' + own, signal: own };
    }

    // Attachment wrapper never folds as Reels.
    if (own === 'ShowcaseFeedUnit' && !(context && context.moduleName === STORY_ATTACHMENT_MODULE)) {
      return { category: CATEGORY.REELS, reason: 'unitTypename:ShowcaseFeedUnit', signal: own };
    }

    // GYSJ list may read the nested typename.
    const typename = own || unit.nestedTypename;
    if (typename && SUGGESTED_GROUP_TYPENAMES.indexOf(typename) !== -1) {
      return { category: CATEGORY.SUGGESTED_GROUP, reason: 'unitTypename:' + typename, signal: typename };
    }

    return null;
  }

  /** Stage 2 — direct props; any explicit string settles its field. // per STRATEGY.md §4 */
  function stage2Props(unit, evidence) {
    const sources = unit.sources || [];

    evidence.subscribeStatus =
      firstPropString(sources, 'actors.0.subscribe_status') ||
      firstPropString(sources, 'actor.subscribe_status') ||
      firstPropString(sources, 'story.actors.0.subscribe_status') ||
      firstPropString(sources, 'comet_sections.header.story.actors.0.subscribe_status') ||
      firstPropString(sources, 'comet_sections.content.story.actors.0.subscribe_status');

    evidence.joinState =
      firstPropString(sources, 'to.viewer_forum_join_state') ||
      firstPropString(sources, 'story.to.viewer_forum_join_state') ||
      firstPropString(sources, 'comet_sections.header.story.to.viewer_forum_join_state') ||
      firstPropString(sources, 'to.viewer_join_state') ||
      firstPropString(sources, 'story.to.viewer_join_state');

    let actionSig = null;
    let recHdr = null;
    for (const source of sources) {
      if (!actionSig) actionSig = detectActionSignal(source);
      if (!recHdr) recHdr = detectRecommendationHeader(source);
      if (actionSig && recHdr) break;
    }

    evidence.actionSignal = actionSig;
    evidence.recHeader = recHdr;

    const subscribeResolved = evidence.subscribeStatus !== null;
    const joinResolved = evidence.joinState !== null;

    // CAN_JOIN Story folds as suggested; only GYSJ list is suggestedGroup. // per STRATEGY.md §2.1
    // Subscribe before join: more specific answer first.
    if (subscribeResolved && SUGGESTED_SUBSCRIBE_STATES.indexOf(evidence.subscribeStatus) !== -1) {
      return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: suggestedVerdict('actors[0].subscribe_status', evidence.subscribeStatus) };
    }
    if (joinResolved && SUGGESTED_JOIN_STATES.indexOf(evidence.joinState) !== -1) {
      return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: suggestedVerdict('to.viewer_forum_join_state', evidence.joinState) };
    }
    if (evidence.actionSignal === 'subscribe') {
      return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: suggestedVerdict('action_links:subscribe', 'subscribe') };
    }
    if (evidence.actionSignal === 'join_group') {
      return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: suggestedVerdict('action_links:join_group', 'join_group') };
    }
    // No story_header rule — diagnostics only. // per STRATEGY.md §2.2
    if (evidence.recHeader) {
      return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: suggestedVerdict('header:' + evidence.recHeader, evidence.recHeader) };
    }

    return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: null };
  }

  /** Stage 3 — store fallback for unresolved fields only. */
  function stage3Store(unit, evidence, resolved) {
    if (!unit.ids.length) return null;

    if (!resolved.subscribeResolved) {
      // `^actors` would throw on a plural field; not a fallback.
      let value = safeRelayRead(unit.ids, SUBSCRIBE_PATH);
      if (!value) value = safeRelayRead(unit.ids, '^actor.subscribe_status');
      if (value) {
        evidence.subscribeStatus = String(value);
        evidence.source = 'relay';
        if (SUGGESTED_SUBSCRIBE_STATES.indexOf(evidence.subscribeStatus) !== -1) {
          return suggestedVerdict('actors[0].subscribe_status', evidence.subscribeStatus);
        }
      }
    }

    if (!resolved.joinResolved) {
      const value = safeRelayRead(unit.ids, JOIN_PATH);
      if (value) {
        evidence.joinState = String(value);
        evidence.source = 'relay';
        if (SUGGESTED_JOIN_STATES.indexOf(evidence.joinState) !== -1) {
          return suggestedVerdict('to.viewer_forum_join_state', evidence.joinState);
        }
      }
    }

    return null;
  }

  /** Stage 4 — settlement. // per STRATEGY.md §2 */
  function stage4Settle(evidence) {
    if (evidence.idCount > 0) {
      return { category: CATEGORY.REGULAR, reason: 'no-match', signal: null };
    }
    return { category: null, reason: 'no-unit-id', signal: null };
  }

  function shortUnitId(id) {
    const defaults = getDefaults();
    if (defaults && typeof defaults.shortUnitId === 'function') return defaults.shortUnitId(id, '-');
    return id ? (id.length > 10 ? '…' + id.slice(-10) : id) : '-';
  }

  function isDebugEnabled() {
    const bridge = window.FBDietBridge;
    if (bridge && typeof bridge.isDebugEnabled === 'function') return bridge.isDebugEnabled();
    const defaults = getDefaults();
    return defaults && typeof defaults.isDebugUrl === 'function'
      ? defaults.isDebugUrl(window.location.search)
      : /[?&]fb_diet_debug=1(?:&|$)/.test(window.location.search);
  }

  /** Props-only ad rule for `dom` mode (store skipped, props not). // per STRATEGY.md §1.1 */
  function adVerdictFromProps(payload) {
    if (!payload || typeof payload !== 'object') return null;
    try {
      const unit = collectUnit(payload, null);
      const adId = readAdMarker(unit.sources, unit.ownRecords);

      if (!adId) return null;
      return { category: CATEGORY.SPONSORED, reason: adIdReason(adId) };
    } catch (e) {
      return null;
    }
  }

  function classify(payload, context) {
    relayReads = [];
    const result = {
      category: null,
      unitId: null,
      unitTypename: null,
      reason: 'no-payload',
      signal: null,
      evidence: null,
      moduleName: context && context.moduleName ? context.moduleName : null
    };

    try {
      if (!payload || typeof payload !== 'object') return result;

      const unit = collectUnit(payload, context);
      result.unitTypename = unit.unitTypename;
      result.unitId = unit.ids.length ? unit.ids[0] : null;

      const evidence = makeEvidence(unit);
      result.evidence = evidence;

      // First answer ends the pipeline.
      const structural = stage1Structural(unit, context, evidence);
      let picked = structural;
      if (!picked) {
        const propsStage = stage2Props(unit, evidence);
        picked = propsStage.verdict || stage3Store(unit, evidence, propsStage) || stage4Settle(evidence);
      }

      result.category = picked.category;
      result.reason = picked.reason;
      result.signal = picked.signal === undefined ? null : picked.signal;

      if (result.category && isDebugEnabled()) {
        console.info('[FB Diet][Classify] Matched:', result.category, 'for unit:', shortUnitId(result.unitId), '(' + (result.unitTypename || 'no-type') + ')', 'reason:', result.reason, 'module:', result.moduleName || '-', 'evidence:', result.evidence);
      }

      return result;
    } catch (e) {
      result.reason = 'error:' + (e && e.message ? e.message : String(e));
      return result;
    }
  }

  function getDefaults() {
    if (typeof window !== 'undefined' && window.FB_DIET_DEFAULTS) return window.FB_DIET_DEFAULTS;
    return (typeof globalThis !== 'undefined' && globalThis.FB_DIET_DEFAULTS) || null;
  }

  /** Resolve one category's fold mode; fails closed without defaults. */
  function getCategoryFoldMode(category, settings) {
    if (!settings || settings.enabled === false) return 'off';
    const defaults = getDefaults();
    if (!defaults || typeof defaults.normalizeFoldMode !== 'function') return 'off';
    const key = (defaults.SETTING_BY_CATEGORY || {})[category];
    if (!key) return 'off';
    const schema = defaults.SETTINGS || {};
    const val = settings[key] !== undefined ? settings[key] : (schema[key] !== undefined ? schema[key] : false);
    return defaults.normalizeFoldMode(val, 'off', Boolean(settings.minimizedFoldMode));
  }

  function isCategoryEnabled(category, settings) {
    return getCategoryFoldMode(category, settings) !== 'off';
  }

  return {
    CATEGORY,
    getCategoryFoldMode,
    SUGGESTED_GROUP_TYPENAMES,
    STORIES_TYPENAMES,
    RELAY_PATHS: {
      SPONSORED_PATH,
      SUBSCRIBE_PATH,
      JOIN_PATH
    },
    setRelayReader,
    getLastRelayReads: () => relayReads.slice(),
    classify,
    adVerdictFromProps,
    isCategoryEnabled,
    readProp
  };
})();