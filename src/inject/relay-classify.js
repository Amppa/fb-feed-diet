/**
 * FB Diet - Relay store classifier (MAIN world, pure functions)
 *
 * Turns the props of a Facebook feed unit plus a Relay reader into one of FB Diet's
 * categories. This is the store-side judge, and the `relay` prefix says so: every
 * verdict it produces comes from props and from the Relay store, never from the page.
 * Its siblings that read the mounted page are the `dom-*` modules; both are consulted
 * in mode-dependent order by fold.js's `resolveVerdict`.
 *
 * Everything here is side effect free and dependency injected, so the exact
 * same code is unit tested under Node (see tests/relay-classify.test.js).
 *
 * `classify` is a four-stage pipeline, and each stage ends the walk the moment it can
 * answer. That ordering is the design, not an implementation detail: the cost of a unit is
 * paid only for the questions its own evidence leaves open.
 *
 *   1. stage1Structural — ads (props, then a three-read store probe) and the tray
 *      typenames. A Stories tray, a Reels rail and the group-suggestion list are decided
 *      by the unit's OWN typename, with no props scan and no store read. Sponsorship is
 *      settled here rather than alongside the other rules because it must outrank every
 *      tray typename: Facebook injects sponsored rows into the trays, and `sponsored`
 *      is the one category where a false negative costs the reader an advertisement.
 *   2. stage2Props — the ten direct props paths, plus the action-link and recommendation
 *      header scan. Free, and the reason most units never reach the store.
 *   3. stage3Store — the Relay store, asked only for fields stage 2 did not resolve.
 *   4. stage4Settle — no rule matched: `regular` when the unit has an id, `null` when it
 *      does not, so truly unidentifiable remnants stay out of the stats.
 *
 * Every stage returns `{ category, reason, signal }` or null, and `classify` assembles the
 * first answer it gets. `reason` names the rule; `signal` carries the value the rule matched
 * on, so a reader of a probe report never has to re-derive which field answered.
 *
 * Evidence is reported for every verdict, including the ones that matched nothing: it is what
 * gets logged for unmatched (reason: no-match) units so mis-detections can be diagnosed
 * without guessing. The block always carries the full key set, null where a stage skipped the
 * read — a key that is absent is indistinguishable from a key nobody looked for.
 *
 * Public API (window.FBDietRelayClassify):
 *   classify(payload, context)             -> { category, unitId, unitTypename, reason, signal, evidence, moduleName }
 *   setRelayReader(fn)                     -> fn(ids, path, options) => value | null
 *   isCategoryEnabled(category, settings)  -> boolean
 *   CATEGORY (the engine's own category names)
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

  // The Reels attachment style wrapper only renders reel attachments INSIDE another story
  // (typically a friend's share of a reel). The record that reaches the classifier from
  // this module IS the attachment, whose __typename is ShowcaseFeedUnit, so the typename
  // based Reels rule must be suppressed in this context (STRATEGY.md, misclassification 3).
  const STORY_ATTACHMENT_MODULE = 'CometFeedStoryFBReelsAttachmentStyle.react';

  const SPONSORED_PATH = '^sponsored_data.ad_id';
  const SUBSCRIBE_PATH = '^^actors[0].subscribe_status';
  const JOIN_PATH = '^to.viewer_forum_join_state';

  // Fallback chain used only when FBDietRelayMetadata cannot extract candidate records itself.
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

  /**
   * Path lookup delegated to the single implementation in defaults.js. Without that
   * module every path reads as absent, so classification fails closed to 'regular'
   * (no folding) instead of guessing — same posture as getCategoryFoldMode.
   *
   * The shared module is injected before this one, so the lookup succeeds from the first
   * call. It is cached because this is the module's hottest path — one feed unit runs it
   * hundreds of times — but re-checked for as long as the module is still missing, so a
   * late or failed load degrades exactly as it did before instead of latching to nothing.
   */
  let sharedDefaults = null;
  function readProp(object, path) {
    if (sharedDefaults === null) sharedDefaults = getDefaults();
    const shared = sharedDefaults;
    return shared && typeof shared.readProp === 'function' ? shared.readProp(object, path) : undefined;
  }

  /**
   * The one prop reader. Every lookup in this module is "the first truthy value some record
   * has at this path", and the only real differences are what counts as a reader and whether
   * the result is coerced to a string. Which list a lookup may walk is named at the call
   * site instead — `sources` is the wide candidate set, `ownRecords` the narrow one that only
   * a boolean ad flag may read.
   */
  function firstTruthy(items, read) {
    for (const item of items || []) {
      const value = read(item);
      if (value) return value;
    }
    return null;
  }

  /** First truthy value among an ordered list of prop paths. */
  function readFirstProp(object, paths) {
    return firstTruthy(paths, (path) => readProp(object, path));
  }

  /** First non-empty string at `path` across a flattened prop-source list. */
  function firstPropString(sources, path) {
    return firstTruthy(sources, (source) => toStringOrNull(readProp(source, path)));
  }

  /** First truthy raw value at `path` across a list of the unit's own records. */
  function firstPropRaw(records, path) {
    return firstTruthy(records, (record) => readProp(record, path));
  }

  /** True when any of the unit's own records carries an explicit boolean flag. */
  function hasOwnFlag(records, path) {
    return (records || []).some((record) => readProp(record, path) === true);
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
   * Candidate records extractor delegated to FBDietRelayMetadata to eliminate code duplication.
   */
  function extractCandidateRecords(roots) {
    if (typeof window !== 'undefined' && window.FBDietRelayMetadata && typeof window.FBDietRelayMetadata.extractCandidateRecords === 'function') {
      return window.FBDietRelayMetadata.extractCandidateRecords(roots);
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
   * The ad marker, read the free way.
   *
   * One rule with two entry points: `stage1Structural` reads it from props and then falls back
   * to the store, while `adVerdictFromProps` stops at props because its caller has no store.
   * Both have to answer the same question the same way, so the expression lives here once —
   * previously each carried its own copy of the same four clauses.
   *
   * The two boolean flags may only be read from `ownRecords`: a nested attachment record
   * must never sponsor-flag the unit it is attached to.
   */
  function readAdMarker(sources, ownRecords) {
    return (
      firstPropString(sources, 'sponsored_data.ad_id') ||
      firstPropString(sources, 'sponsored_data.client_token') ||
      (firstPropRaw(ownRecords, 'th_dat_spo') ? 'th_dat_spo' : null) ||
      (hasOwnFlag(ownRecords, 'is_sponsored') ? 'is_sponsored' : null) ||
      null
    );
  }

  /** The reason string an ad marker maps to, so both entry points report a unit the same way. */
  function adIdReason(adId) {
    if (adId === 'th_dat_spo') return 'th_dat_spo';
    if (adId === 'is_sponsored') return 'is_sponsored';
    return 'sponsored_data.ad_id';
  }

  /**
   * The evidence block every verdict reports, built before a single rule runs.
   *
   * Every key is present from the start, null until something reads it. probe.js and the probe
   * report address these names directly, and an absent key is indistinguishable from a key
   * nobody looked for — which is the one thing an evidence block must never be.
   *
   * `source` opens at 'props' because the props ARE read for every unit the classifier is
   * handed: the typename, the ad marker, the suggestion signals. A store hit downgrades it to
   * 'relay', naming the deeper read that answered. It does not claim which field decided —
   * `reason` says that, and `signal` now carries the value that did (see classify).
   */
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

  /**
   * The Relay store ad probe: the three-clause chain, in the order Facebook answers best.
   *
   * Props are free and are asked first (`readAdMarker`), so this only runs for a unit whose
   * payload did not carry the ad at all. Every read goes through `safeRelayRead`, which is what
   * makes a store-only ad reproducible from a probe report rather than merely asserted.
   *
   * The caller records the hit and the `source` downgrade; this function answers one question —
   * "does the store call this unit an ad?" — and does not touch evidence itself.
   */
  function probeAdFromStore(unit) {
    let value = safeRelayRead(unit.ids, SPONSORED_PATH);
    if (!value) value = safeRelayRead(unit.ids, '^sponsored_data.client_token');
    if (!value && safeRelayRead(unit.ids, 'is_sponsored') === true) value = 'is_sponsored';
    return value ? String(value) : null;
  }

  /** An ad verdict, from either entry point. The signal is the marker the rule matched on. */
  function sponsoredVerdict(adId) {
    return { category: CATEGORY.SPONSORED, reason: adIdReason(adId), signal: adId };
  }

  /** A suggested verdict. Six rules reach this category and the reason is what tells them apart. */
  function suggestedVerdict(reason, signal) {
    return { category: CATEGORY.SUGGESTED, reason: reason, signal: signal };
  }

  /**
   * Stage 1 — the structural fast path.
   *
   * A tray unit IS its surface: a Stories tray, a Reels rail and the "groups you should join"
   * list are decided by the unit's own typename alone, with no props scan and no store read.
   * Their share of the feed (~10%) is exactly the population those reads were most wasteful for,
   * so answering them from the one free field first is the whole reason this stage exists.
   *
   * Sponsorship is settled here too, and it comes first deliberately. An ad is not a tray that
   * happens to be sponsored: it is the one category where a false negative costs the reader an
   * advertisement, and Facebook does inject sponsored rows into the tray units. Deciding ads from
   * props first and from a three-read store probe second keeps that verdict above every structural
   * rule, so `sponsored` stays the top of the precedence chain exactly as before this pipeline
   * existed — see tests/relay-classify.test.js, "sponsored beats stories".
   *
   * Returns a verdict, or null when the unit is none of these and the remaining stages decide.
   */
  function stage1Structural(unit, context, evidence) {
    // Props are free, so an ad that the payload already declares never costs a store read.
    let adId = readAdMarker(unit.sources, unit.ownRecords);
    if (!adId && unit.ids.length) {
      adId = probeAdFromStore(unit);
      if (adId) evidence.source = 'relay';
    }
    if (adId) {
      evidence.adId = adId;
      return sponsoredVerdict(adId);
    }

    // Only the unit's OWN typename may name a surface. A friend's share of a reel nests a
    // ShowcaseFeedUnit inside an ordinary Story, and a typename read off that nested record is
    // not a Reels surface (STRATEGY.md, misclassification 3).
    const own = unit.ownTypename;

    // The mid-feed Stories row is a DiscoverFeedUnit delivered through the generic feed unit
    // wrapper, so it needs a typename rule of its own (STRATEGY.md, decision #7).
    if (own && STORIES_TYPENAMES.indexOf(own) !== -1) {
      return { category: CATEGORY.STORIES, reason: 'unitTypename:' + own, signal: own };
    }

    // Reels is only the clear-cut Reels surface. The attachment style wrapper renders
    // attachments by definition, so units arriving through it never fold as Reels.
    if (own === 'ShowcaseFeedUnit' && !(context && context.moduleName === STORY_ATTACHMENT_MODULE)) {
      return { category: CATEGORY.REELS, reason: 'unitTypename:ShowcaseFeedUnit', signal: own };
    }

    // The horizontal GYSJ list is the only typename allowed to be read off the nested record,
    // because the list's own typename can arrive one level down (this rule predates the
    // own-typename isolation the two surface rules above enforce).
    const typename = own || unit.nestedTypename;
    if (typename && SUGGESTED_GROUP_TYPENAMES.indexOf(typename) !== -1) {
      return { category: CATEGORY.SUGGESTED_GROUP, reason: 'unitTypename:' + typename, signal: typename };
    }

    return null;
  }

  /**
   * Stage 2 — direct props, plus the store bypass they buy.
   *
   * The five subscribe paths and the five join paths below are the classifier's hot inner loop:
   * ten lookups across every candidate record, on the ~60% of the feed that is ordinary posts.
   * They run before any store read, so when they answer there is nothing left to ask the Relay
   * store about. `subscribeResolved` / `joinResolved` carry that answer out to stage 3.
   *
   * Resolution is deliberately stricter than "did we find a suggestion". ANY explicit string
   * settles its field, including NOT_SUBSCRIBED, IS_SUBSCRIBED and IS_MEMBER: those are real
   * answers from Facebook, and re-asking the store for a field the props already carry is
   * exactly the traffic this pipeline exists to remove. They settle the unit as `regular`,
   * which is the correct answer for them — NOT_SUBSCRIBED matching nearly every actor the
   * viewer does not follow is precisely why it is not suggestion evidence (STRATEGY.md,
   * misclassifications 1 & 2).
   */
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

    // A plain Story with viewer_forum_join_state CAN_JOIN is a "suggested for you" group post
    // from a group the viewer has not joined: it folds with the suggested surface
    // (STRATEGY.md, decision #10). Only the horizontal GYSJ list unit is suggestedGroup.
    //
    // Subscribe is asked before join here. Both land in `suggested`, so only the reason string
    // differs for a unit carrying both — and the actor's own subscribe state is the more specific
    // of the two answers, because it names the person who is not yet followed.
    if (subscribeResolved && SUGGESTED_SUBSCRIBE_STATES.indexOf(evidence.subscribeStatus) !== -1) {
      return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: suggestedVerdict('actors[0].subscribe_status', evidence.subscribeStatus) };
    }
    if (joinResolved && SUGGESTED_JOIN_STATES.indexOf(evidence.joinState) !== -1) {
      return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: suggestedVerdict('to.viewer_forum_join_state', evidence.joinState) };
    }
    // Action links: follow/subscribe buttons or join group buttons.
    if (evidence.actionSignal === 'subscribe') {
      return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: suggestedVerdict('action_links:subscribe', 'subscribe') };
    }
    if (evidence.actionSignal === 'join_group') {
      return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: suggestedVerdict('action_links:join_group', 'join_group') };
    }
    // Explicit suggestion header: "為你推薦" / "Suggested for you".
    // NOTE: there is deliberately NO story_header rule (STRATEGY.md, decision #6).
    if (evidence.recHeader) {
      return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: suggestedVerdict('header:' + evidence.recHeader, evidence.recHeader) };
    }

    return { subscribeResolved: subscribeResolved, joinResolved: joinResolved, verdict: null };
  }

  /**
   * Stage 3 — the Relay store, asked only for what the props did not answer.
   *
   * Every read here is a fallback for one specific unresolved field, so the log a probe report
   * prints is a list of open questions rather than a fixed ritual. The ad probe is absent: stage 1
   * owns sponsorship and already asked, so repeating it here would double the reads of every
   * ordinary post to re-derive an answer nobody is waiting for.
   *
   * The first `suggested` hit ends the stage. A unit that the store calls CAN_SUBSCRIBE is
   * settled, and the join read that used to follow it was never going to change that verdict.
   */
  function stage3Store(unit, evidence, resolved) {
    if (!unit.ids.length) return null;

    if (!resolved.subscribeResolved) {
      // SUBSCRIBE_PATH already reads the plural link correctly; `^actors` would call the
      // singular accessor on a plural field and throw (invariant #696), so it is not a fallback.
      let value = safeRelayRead(unit.ids, SUBSCRIBE_PATH);
      if (!value) value = safeRelayRead(unit.ids, '^actor.subscribe_status');
      if (value) {
        evidence.subscribeStatus = String(value);
        evidence.source = 'relay';
        // Recorded either way: a NOT_SUBSCRIBED from the store is evidence, and it settles
        // regular rather than escaping into the join read.
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

  /**
   * Stage 4 — settlement. No rule matched: if we have at least one unit id the unit is
   * identifiable but unclassified, so it is a 'regular' post (decision #16). Only units with
   * zero ids (no-payload / no-unit-id) keep category: null so that truly unidentifiable
   * remnants are still excluded from stats and folding.
   */
  function stage4Settle(evidence) {
    if (evidence.idCount > 0) {
      return { category: CATEGORY.REGULAR, reason: 'no-match', signal: null };
    }
    return { category: null, reason: 'no-unit-id', signal: null };
  }

  /** Unit ids are opaque base64 blobs; show a short fingerprint instead. */
  function shortUnitId(id) {
    const defaults = getDefaults();
    if (defaults && typeof defaults.shortUnitId === 'function') return defaults.shortUnitId(id, '-');
    return id ? (id.length > 10 ? '…' + id.slice(-10) : id) : '-';
  }

  /** Bound to the bridge's shared debug flag (URL fb_diet_debug=1 / __fbDietDebug()). */
  function isDebugEnabled() {
    const bridge = window.FBDietBridge;
    if (bridge && typeof bridge.isDebugEnabled === 'function') return bridge.isDebugEnabled();
    const defaults = getDefaults();
    return defaults && typeof defaults.isDebugUrl === 'function'
      ? defaults.isDebugUrl(window.location.search)
      : /[?&]fb_diet_debug=1(?:&|$)/.test(window.location.search);
  }

  /**
   * The ad rule with the store taken out — props only, and it answers 'sponsored' or null.
   *
   * This exists because decision #40's skip is about the STORE, not about the props. A feed
   * unit's ad field is very often a plain prop on the payload (`feedUnit.th_dat_spo` was read
   * that way on 2026-09-29, `evidence.source: 'props'`), and skipping the whole classifier
   * discarded that free signal along with the store reads it was written to avoid. The cost
   * was concrete: in `dom` mode an ad whose byline the DOM detector could not read resolved
   * to `dom:no-verdict` -> 'regular' and was never folded, even though nothing about the
   * signal required store capture.
   *
   * It deliberately answers only the ad rule. Sponsorship is the one category where a false
   * negative is expensive enough to pay redundancy for (decision #39), and the four others
   * stay in the store so the DOM-only mode keeps reporting honestly on what the page alone
   * can prove. No Relay reader is consulted and none is required.
   */
  function adVerdictFromProps(payload) {
    if (!payload || typeof payload !== 'object') return null;
    try {
      const unit = collectUnit(payload, null);
      const adId = readAdMarker(unit.sources, unit.ownRecords);

      if (!adId) return null;
      return { category: CATEGORY.SPONSORED, reason: adIdReason(adId) };
    } catch (e) {
      // A hostile payload must never throw into the render path.
      return null;
    }
  }

  function classify(payload, context) {
    // Fresh read log per unit: the probe reports the reads of THIS unit only.
    relayReads = [];
    const result = {
      category: null,
      unitId: null,
      unitTypename: null,
      reason: 'no-payload',
      // The decisive value for the branch that decided, and null when nothing did. `reason`
      // names the rule; `signal` says what it matched on, so a reader of a probe report never
      // has to re-derive which field answered (fold.js and probe.js both read it).
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

      // The four stages, in the order the evidence becomes available. Each returns a verdict or
      // null, and the first one to answer ends the pipeline — so a tray unit never pays for the
      // props scan, and a unit whose props already answered never pays for a store read.
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