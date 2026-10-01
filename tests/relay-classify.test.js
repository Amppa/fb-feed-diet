'use strict';
const { Checker, createWindow, loadInject, loadDefaults } = require('./harness');

function makeReader(calls) {
  return (ids, path, options) => {
    calls.push({ ids, path, options });
    return calls.mapValue && calls.mapValue(path) ? calls.mapValue(path) : null;
  };
}

function run(c) {
  const win = createWindow();
  // Same load order as the extension: the shared defaults schema is always injected into
  // the MAIN world before relay-classify.js, which reads its fold-mode normalizer from there.
  win.FB_DIET_DEFAULTS = loadDefaults();
  loadInject(win, 'relay-metadata.js');
  loadInject(win, 'relay-classify.js');
  const C = win.FBDietRelayClassify;

  c.ok('classify API exposed on window', Boolean(C) && typeof C.classify === 'function');

  const calls = [];
  C.setRelayReader((ids, path, options) => {
    calls.push({ ids, path, options });
    return (calls.mapValue && calls.mapValue(path)) || null;
  });

  const P = C.RELAY_PATHS;
  const feedUnitOf = (extra) => Object.assign({ id: 'u1', __typename: 'FeedUnitRoot' }, extra);

  /* --- sponsored via Relay --- */
  calls.mapValue = (path) => (path === P.SPONSORED_PATH ? 'ad-77' : null);
  let r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'sponsored category', r.category, 'sponsored');
  equals(c, 'sponsored reason', r.reason, 'sponsored_data.ad_id');
  equals(c, 'unit id extracted', r.unitId, 'u1');
  equals(c, 'evidence source is relay', r.evidence.source, 'relay');
  equals(c, 'ad id evidence', r.evidence.adId, 'ad-77');

  /* --- direct props win: Relay is never asked for the ad id --- */
  calls.length = 0;
  r = C.classify({ feedUnit: feedUnitOf({ sponsored_data: { ad_id: 'ad-88' } }) });
  equals(c, 'props-based sponsored', r.category, 'sponsored');
  equals(c, 'evidence source is props', r.evidence.source, 'props');
  c.ok('relay not asked for the ad id when props answered', calls.every((x) => x.path !== P.SPONSORED_PATH));

  /* --- th_dat_spo sponsored detection --- */
  r = C.classify({ feedUnit: feedUnitOf({ th_dat_spo: { brs_filter_setting: 90 } }) });
  equals(c, 'th_dat_spo sponsored category', r.category, 'sponsored');
  equals(c, 'th_dat_spo sponsored reason', r.reason, 'th_dat_spo');
  equals(c, 'th_dat_spo evidence source is props', r.evidence.source, 'props');

  /* --- nested feed unit (children.0.props.children.props) --- */
  calls.mapValue = () => null;
  r = C.classify({ children: [{ props: { children: { props: { feedUnit: feedUnitOf() } } } }] });
  equals(c, 'nested unit id found', r.unitId, 'u1');

  /* --- suggested group by typename --- */
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'GroupsYouShouldJoinFeedUnit' }) });
  equals(c, 'suggestedGroup by record typename', r.category, 'suggestedGroup');

  r = C.classify({ unitTypename: 'GroupsYouShouldJoinFeedUnit', feedUnit: feedUnitOf() });
  equals(c, 'suggestedGroup by payload typename', r.category, 'suggestedGroup');

  /* --- suggested by join state (props + relay): a can-join group POST is a
     suggestion, not the "Other" group list (STRATEGY.md, decision #10) --- */
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'Story', to: { viewer_forum_join_state: 'CAN_JOIN' } }) });
  equals(c, 'suggested by props join state', r.category, 'suggested');

  calls.mapValue = (path) => (path === P.JOIN_PATH ? 'CAN_JOIN' : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'suggested by relay join state', r.category, 'suggested');

  /* --- suggested by subscribe status --- */
  calls.mapValue = (path) => (path === P.SUBSCRIBE_PATH ? 'CAN_SUBSCRIBE' : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'suggested by subscribe status', r.category, 'suggested');

  // CAN_FOLLOW / NOT_SUBSCRIBED are NOT suggestion evidence: they matched nearly
  // every actor the viewer does not subscribe to and folded real friend activity
  // (STRATEGY.md, misclassifications 1 & 2).
  calls.mapValue = (path) => (path === P.SUBSCRIBE_PATH ? 'NOT_SUBSCRIBED' : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'NOT_SUBSCRIBED actor is regular, not suggested', r.category, 'regular');
  calls.mapValue = (path) => (path === P.SUBSCRIBE_PATH ? 'CAN_FOLLOW' : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'CAN_FOLLOW actor is regular, not suggested', r.category, 'regular');

  // `actors` is a plural link: Relay throws on the singular accessor (invariant #696), so no
  // read may use '^actors'. The plural SUBSCRIBE_PATH is the only correct form.
  calls.length = 0;
  calls.mapValue = () => null;
  C.classify({ feedUnit: feedUnitOf() });
  c.ok('the classifier never reads a plural field with the singular accessor',
    calls.every((call) => call.path.indexOf('^actors') !== 0));
  c.ok('the classifier reads actors only through the plural path',
    calls.filter((call) => call.path.indexOf('actors') !== -1)
      .every((call) => call.path.indexOf('^^actors') === 0));
  // Generalised: no path anywhere may carry a single-link marker on an indexed plural field,
  // which is what invariant #696 reports. `^^` is the correct plural form and must not match.
  c.equals('no read pairs a single-link marker with an index',
    calls.filter((call) => /(^|[^.\^])\^[a-z_]+\[\d/.test(call.path)).length, 0);
  /* --- story header: diagnostic only, never decides a category --- */
  // The probe proved Facebook stores a friend's comment story under the same keyed
  // story_header record as suggestion headers, so headers must not fold
  // (STRATEGY.md, decision #6). The evidence is still collected for diagnostics.
  calls.mapValue = (path) => (path === '^story_header{$1}.^title.text' ? 'Suggested for you' : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'story header never folds a unit (regular)', r.category, 'regular');
  equals(c, 'story header not in evidence', r.evidence.storyLocation, undefined);

  // A location-free story_header ("X commented on ...") is NOT suggestion evidence:
  // contextual stories carry one too and must stay visible.
  calls.mapValue = (path) => (path.indexOf('story_header') !== -1 && path.indexOf('$1') === -1 ? 'A friend commented on a post' : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'plain contextual story_header is regular', r.category, 'regular');

  // Existence of a location-keyed story_header without a title is not enough either.
  calls.mapValue = (path) => (path === '^story_header{$1}' ? { location: 'homepage_stream' } : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'story_header existence without title is regular', r.category, 'regular');
  /* --- reels --- */
  calls.mapValue = () => null;

  // Clear-cut Reels surface: the Showcase feed unit is always a Reels product.
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) });
  equals(c, 'reels by ShowcaseFeedUnit typename', r.category, 'reels');
  equals(c, 'reels reason', r.reason, 'unitTypename:ShowcaseFeedUnit');

  // showcase_story_type ALONE must NOT fold: a friend resharing a reel exposes the
  // same field on an ordinary Story unit, and that friend post has to stay visible.
  r = C.classify({ feedUnit: feedUnitOf({ showcase_story_type: 'SHOWCASE_SHORT_VIDEO' }) });
  equals(c, 'showcase type alone is regular', r.category, 'regular');
  r = C.classify({ unitTypename: 'Story', feedUnit: feedUnitOf({ showcase_story_type: 'SHOWCASE_SHORT_VIDEO' }) });
  equals(c, 'friend shared reel (Story) is regular', r.category, 'regular');

  // A friend's share nests a ShowcaseFeedUnit attachment inside an ordinary Story:
  // the nested record's typename must never trigger the Reels rule
  // (STRATEGY.md, misclassification 3).
  r = C.classify({
    unitTypename: 'Story',
    feedUnit: feedUnitOf(),
    children: [{ props: { feedUnit: { id: 'reel-1', __typename: 'ShowcaseFeedUnit' } } }]
  });
  equals(c, 'friend share with nested showcase is regular', r.category, 'regular');

  // A payload whose OWN typename is missing (attachment-level payload) is equally not
  // a Reels surface: only a typename read off the nested record would match.
  r = C.classify({ children: [{ props: { feedUnit: { id: 'reel-2', __typename: 'ShowcaseFeedUnit' } } }] });
  equals(c, 'nested-only showcase typename is regular', r.category, 'regular');

  // The Reels attachment style wrapper renders attachments by definition; units
  // classified from that module must never fold as Reels.
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) }, { moduleName: 'CometFeedStoryFBReelsAttachmentStyle.react' });
  equals(c, 'attachment module context classifies as regular', r.category, 'regular');
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) }, { moduleName: 'CometFeedUnitErrorBoundary.react' });
  equals(c, 'reels still folds for other modules', r.category, 'reels');

  /* --- relay read log (probe relayReads) --- */
  // Every read is recorded with the value that came back, and the log resets
  // per classification so a probe reflects exactly one unit.
  calls.mapValue = (path) => (path === P.SPONSORED_PATH ? 'ad-77' : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  let reads = C.getLastRelayReads();
  c.ok('relay read log has entries', Array.isArray(reads) && reads.length > 0);
  c.ok('relay read log carries the sponsored hit', reads.some((entry) => entry.path === P.SPONSORED_PATH && entry.value === 'ad-77'));

  calls.mapValue = () => null;
  r = C.classify({ feedUnit: feedUnitOf() });
  reads = C.getLastRelayReads();
  c.ok('relay read log resets per unit', reads.length > 0 && reads.every((entry) => entry.value === null));

  /* --- stories: mid-feed Stories row (DiscoverFeedUnit) --- */
  // The Stories row inserted into the home feed arrives via the generic
  // CometFeedUnitErrorBoundary.react wrapper, so only the unit's own typename can
  // identify it (STRATEGY.md, decision #7).
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'DiscoverFeedUnit' }) }, { moduleName: 'CometFeedUnitErrorBoundary.react' });
  equals(c, 'stories by DiscoverFeedUnit typename', r.category, 'stories');
  equals(c, 'stories reason', r.reason, 'unitTypename:DiscoverFeedUnit');

  r = C.classify({ unitTypename: 'DiscoverFeedUnit', feedUnit: feedUnitOf() });
  equals(c, 'stories by payload typename', r.category, 'stories');

  // An ordinary Story wrapping a nested DiscoverFeedUnit record must stay visible:
  // same own-typename guard as the Reels rule.
  r = C.classify({
    unitTypename: 'Story',
    feedUnit: feedUnitOf(),
    children: [{ props: { feedUnit: { id: 'st-1', __typename: 'DiscoverFeedUnit' } } }]
  });
  equals(c, 'nested-only DiscoverFeedUnit is regular', r.category, 'regular');

  /* --- priority: an ad in a Stories row is still an ad --- */
  calls.mapValue = (path) => (path === P.SPONSORED_PATH ? 'ad-5' : null);
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'DiscoverFeedUnit' }) });
  equals(c, 'sponsored beats stories', r.category, 'sponsored');
  calls.mapValue = () => null;
  /* --- priority: an ad that is also a group suggestion is an ad --- */
  calls.mapValue = (path) => (path === P.SPONSORED_PATH ? 'ad-9' : 'CAN_JOIN');
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'GroupsYouShouldJoinFeedUnit' }) });
  equals(c, 'sponsored beats suggestedGroup', r.category, 'sponsored');

  /* --- no-match / empty --- */
  calls.mapValue = () => null;
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'unmatched unit with id is classified as regular', r.category, 'regular');
  equals(c, 'no-match reason', r.reason, 'no-match');
  equals(c, 'unit id still present for debugging', r.unitId, 'u1');
  c.ok('evidence block always returned', Boolean(r.evidence) && r.evidence.id === 'u1' && r.evidence.idCount === 1);

  r = C.classify({ feedUnit: {} });
  equals(c, 'unit without id reports no-unit-id', r.reason, 'no-unit-id');
  equals(c, 'empty payload is safe', C.classify(null).category, null);

  /* --- error resilience --- */
  const hostile = {};
  Object.defineProperty(hostile, 'feedUnit', {
    get() {
      throw new Error('hostile getter');
    }
  });
  let hostileResult = null;
  try {
    hostileResult = C.classify(hostile);
  } catch (e) {
    /* must never happen */
  }
  c.ok('hostile payload does not throw', Boolean(hostileResult));
  c.ok('hostile payload reported as error reason', Boolean(hostileResult) && hostileResult.reason.indexOf('error:') === 0);

  /* --- settings gating --- */
  equals(c, 'default settings enable sponsored', C.isCategoryEnabled('sponsored', {}), true);
  equals(c, 'master switch disables everything', C.isCategoryEnabled('sponsored', { enabled: false }), false);
  equals(c, 'null settings disable everything', C.isCategoryEnabled('sponsored', null), false);
  equals(c, 'per category switch', C.isCategoryEnabled('suggested', { foldSuggested: false }), false);
  equals(c, 'unknown category disabled', C.isCategoryEnabled('nope', {}), false);

  /* --- Action links and recommendation header signals --- */
  calls.mapValue = () => null; // reset live reader so mock ads do not interfere

  // 1. Follow action button
  r = C.classify({
    feedUnit: {
      __typename: 'Story',
      id: 'u-follow',
      action_links: [{ action_type: 'SUBSCRIBE', text: '追蹤' }]
    }
  });
  equals(c, 'follow action classified as suggested', r.category, 'suggested');
  equals(c, 'follow action reason', r.reason, 'action_links:subscribe');

  // 2. Join group action button
  r = C.classify({
    feedUnit: {
      __typename: 'Story',
      id: 'u-join',
      comet_sections: {
        header: {
          story: {
            action_links: [{ action_type: 'JOIN_GROUP', text: '加入' }]
          }
        }
      }
    }
  });
  equals(c, 'join group action classified as suggested', r.category, 'suggested');
  equals(c, 'join group action reason', r.reason, 'action_links:join_group');

  // 3. Recommendation header (為你推薦)
  r = C.classify({
    feedUnit: {
      __typename: 'Story',
      id: 'u-rec-tw',
      comet_sections: {
        header: {
          story: {
            title: { text: '為你推薦' }
          }
        }
      }
    }
  });
  equals(c, 'recommendation header classified as suggested', r.category, 'suggested');
  equals(c, 'recommendation header reason', r.reason, 'header:為你推薦');

  // 4. Friend interaction header must not be misclassified as suggested
  r = C.classify({
    feedUnit: {
      __typename: 'Story',
      id: 'u-friend-comment',
      comet_sections: {
        header: {
          story: {
            title: { text: 'Jane Doe 最近留言回應。' }
          }
        }
      }
    }
  });
  equals(c, 'friend activity header stays regular', r.category, 'regular');
  equals(c, 'friend activity header reason is no-match', r.reason, 'no-match');

  /* --- fold mode checks --- */
  equals(c, 'default settings sponsored mode is title (36px default)', C.getCategoryFoldMode('sponsored', {}), 'title');
  equals(c, 'minimized fold mode returns mini (18px)', C.getCategoryFoldMode('sponsored', { foldAds: true, minimizedFoldMode: true }), 'mini');
  equals(c, 'default settings suggested mode is off', C.getCategoryFoldMode('suggested', {}), 'off');
  equals(c, 'enabled suggested mode is title', C.getCategoryFoldMode('suggested', { foldSuggested: true }), 'title');
  equals(c, 'default settings regular mode is off', C.getCategoryFoldMode('regular', {}), 'off');
  equals(c, 'custom setting mode is honored', C.getCategoryFoldMode('regular', { foldRegular: 'title' }), 'title');
  equals(c, 'disabled master switch forces off', C.getCategoryFoldMode('sponsored', { enabled: false }), 'off');

  // The shared schema is the single normalization source: without it the classifier fails
  // closed instead of guessing a fold mode from bare booleans.
  const savedDefaults = win.FB_DIET_DEFAULTS;
  win.FB_DIET_DEFAULTS = undefined;
  equals(c, 'missing defaults schema fails closed', C.getCategoryFoldMode('sponsored', {}), 'off');
  win.FB_DIET_DEFAULTS = savedDefaults;
  equals(c, 'defaults schema restored for later checks', C.getCategoryFoldMode('sponsored', {}), 'title');

  // 5. Nested Context Provider tree unwrapping: follow button
  r = C.classify({
    feedUnit: { __typename: 'Story', id: 'u-nested-ctx', __fragments: {} },
    children: {
      props: {
        value: { contextId: 1 },
        children: {
          props: {
            value: { contextId: 2 },
            children: {
              props: {
                story: {
                  id: 's-nested-follow',
                  comet_sections: {
                    header: {
                      story: {
                        action_links: [{ action_type: 'SUBSCRIBE', text: '追蹤' }]
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });
  equals(c, 'nested context provider follow action folded', r.category, 'suggested');
  equals(c, 'nested context provider follow reason', r.reason, 'action_links:subscribe');

  // 6. Nested Context Provider tree unwrapping: recommendation header
  r = C.classify({
    feedUnit: { __typename: 'Story', id: 'u-nested-rec', __fragments: {} },
    children: {
      props: {
        value: { contextId: 1 },
        children: {
          props: {
            story: {
              id: 's-nested-rec',
              comet_sections: {
                header: {
                  story: {
                    title: { text: '為你推薦' }
                  }
                }
              }
            }
          }
        }
      }
    }
  });
  equals(c, 'nested context provider rec header folded', r.category, 'suggested');
  equals(c, 'nested context provider rec reason', r.reason, 'header:為你推薦');

  // 7. Rendered lastCmp element tree unwrapping
  r = C.classify(
    { feedUnit: { __typename: 'Story', id: 'u-lastcmp', __fragments: {} } },
    {
      moduleName: 'CometFeedUnitErrorBoundary.react',
      lastCmp: {
        props: {
          children: {
            props: {
              story: {
                id: 's-lastcmp',
                comet_sections: {
                  header: {
                    story: {
                      action_links: [{ action_type: 'JOIN_GROUP', text: '加入' }]
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  );
  equals(c, 'lastCmp join group action folded', r.category, 'suggested');
  equals(c, 'lastCmp join group reason', r.reason, 'action_links:join_group');

  /* --- stage 2: the props answer is never re-asked from the store (A1) --- */
  // Once the payload carries an explicit subscribe state or join state, that field is RESOLVED —
  // whatever the value is. NOT_SUBSCRIBED, IS_MEMBER and IS_SUBSCRIBED are answers, not
  // absences, so asking the store for them again is a read for a question the payload closed.
  //
  // The store below deliberately holds the answers that would WIN if the field were re-asked, so
  // these tests would fail loudly under a classifier that ignored the props: a re-asked
  // subscribe_status comes back CAN_SUBSCRIBE and a re-asked join state comes back CAN_JOIN,
  // and the unit would be reported as `suggested` instead of `regular`.
  calls.length = 0;
  calls.mapValue = (path) => (path === P.SPONSORED_PATH || path === '^sponsored_data.client_token' || path === 'is_sponsored' ? null : path === P.SUBSCRIBE_PATH ? 'CAN_SUBSCRIBE' : path === P.JOIN_PATH ? 'CAN_JOIN' : null);
  r = C.classify({
    feedUnit: feedUnitOf({
      __typename: 'Story',
      actors: [{ subscribe_status: 'IS_SUBSCRIBED' }],
      to: { viewer_forum_join_state: 'IS_MEMBER' }
    })
  });
  equals(c, 'a followed actor in a joined group settles as regular', r.category, 'regular');
  equals(c, '…despite the store holding a can-subscribe for the same field', r.evidence.subscribeStatus, 'IS_SUBSCRIBED');
  equals(c, '…and the props value is the join evidence too', r.evidence.joinState, 'IS_MEMBER');
  equals(c, '…both reported as read from the props', r.evidence.source, 'props');
  c.ok('…so no read ever touches actors', calls.every((call) => call.path.indexOf('actors') === -1));
  c.ok('…and join is never asked for', calls.every((call) => call.path !== P.JOIN_PATH));
  c.ok('…leaving the ad probe as the whole read cost of this unit',
    calls.length > 0 && calls.every((call) => call.path === P.SPONSORED_PATH || call.path === '^sponsored_data.client_token' || call.path === 'is_sponsored'));

  // The join bypass on its own, with subscribe genuinely unresolved so the store does answer that
  // field. The join read is skipped anyway, and its CAN_JOIN never reaches the verdict.
  calls.length = 0;
  calls.mapValue = (path) => (path === P.SPONSORED_PATH || path === '^sponsored_data.client_token' || path === 'is_sponsored' ? null : path === P.SUBSCRIBE_PATH ? null : path === P.JOIN_PATH ? 'CAN_JOIN' : null);
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'Story', to: { viewer_forum_join_state: 'IS_MEMBER' } }) });
  equals(c, 'a joined group settles as regular', r.category, 'regular');
  equals(c, '…and the props value is the recorded join evidence', r.evidence.joinState, 'IS_MEMBER');
  c.ok('…so the store is never asked for join, even though it holds a different answer',
    calls.every((call) => call.path !== P.JOIN_PATH));

  /* --- stage 1: a tray unit costs the ad probe and nothing else --- */
  // The tray typenames are the whole answer for these units, so the props scan and both store
  // reads are traffic for a verdict nobody is waiting for.
  calls.length = 0;
  calls.mapValue = () => null;
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) });
  equals(c, 'tray fast path still classifies as reels', r.category, 'reels');
  c.ok('…without ever reading subscribe', calls.every((call) => call.path !== P.SUBSCRIBE_PATH));
  c.ok('…nor join', calls.every((call) => call.path !== P.JOIN_PATH));
  c.ok('…and every read it did make was the ad probe',
    calls.length > 0 && calls.every((call) => call.path === P.SPONSORED_PATH || call.path === '^sponsored_data.client_token' || call.path === 'is_sponsored'));

  calls.length = 0;
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'DiscoverFeedUnit' }) }, { moduleName: 'CometFeedUnitErrorBoundary.react' });
  equals(c, 'stories tray fast path still classifies as stories', r.category, 'stories');
  c.ok('…with the same read bound', calls.every((call) => call.path !== P.SUBSCRIBE_PATH && call.path !== P.JOIN_PATH));

  // The evidence block is complete even though almost nothing was read: probe.js and the probe
  // report address these keys by name, and a key that is absent is indistinguishable from a key
  // nobody looked for. The nulls are the report of what the fast path skipped.
  equals(c, 'a stage 1 verdict reports every evidence key', Object.keys(r.evidence).sort().join(','),
    'actionSignal,adId,id,idCount,joinState,nestedTypename,ownTypename,recHeader,source,subscribeStatus');
  equals(c, '…subscribe was never read', r.evidence.subscribeStatus, null);
  equals(c, '…nor join', r.evidence.joinState, null);
  equals(c, '…nor the action links', r.evidence.actionSignal, null);
  equals(c, '…nor a recommendation header', r.evidence.recHeader, null);
  equals(c, '…and no ad marker was found', r.evidence.adId, null);
  equals(c, '…while the id still qualifies the unit', r.evidence.idCount, 1);
  equals(c, '…and the source is the props the typename came from', r.evidence.source, 'props');

  /* --- stage 1: sponsorship still outranks a tray typename (reels tray) --- */
  // The two existing cases cover the Stories tray and the group list. The Reels tray is the one
  // structural rule left, and the precedence is a single claim: an ad is an ad wherever it sits.
  calls.length = 0;
  calls.mapValue = (path) => (path === P.SPONSORED_PATH ? 'ad-77' : null);
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) });
  equals(c, 'sponsored beats reels', r.category, 'sponsored');
  equals(c, '…and the ad id is the signal', r.signal, 'ad-77');

  /* --- stage 3: the first store suggestion ends the stage --- */
  calls.length = 0;
  calls.mapValue = (path) => (path === P.SUBSCRIBE_PATH ? 'CAN_SUBSCRIBE' : path === P.JOIN_PATH ? 'CAN_JOIN' : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'a relay can-subscribe settles as suggested', r.category, 'suggested');
  equals(c, '…and the reason is the subscribe rule', r.reason, 'actors[0].subscribe_status');
  c.ok('…so the join read that could not change the verdict never ran',
    calls.every((call) => call.path !== P.JOIN_PATH));

  // A relay value that is NOT a suggestion is still recorded, and still lets the join read run:
  // it answered its own field without settling the unit.
  calls.length = 0;
  calls.mapValue = (path) => (path === P.SUBSCRIBE_PATH ? 'NOT_SUBSCRIBED' : path === P.JOIN_PATH ? 'CAN_JOIN' : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'a non-suggesting relay value does not end the stage', r.category, 'suggested');
  equals(c, '…the join read answered instead', r.reason, 'to.viewer_forum_join_state');
  equals(c, '…and both values are reported as evidence', r.evidence.subscribeStatus, 'NOT_SUBSCRIBED');
  equals(c, '…including the one that did not decide', r.evidence.joinState, 'CAN_JOIN');

  /* --- signal: the decisive value for every branch --- */
  calls.mapValue = () => null;

  r = C.classify({ feedUnit: feedUnitOf({ th_dat_spo: { brs_filter_setting: 90 } }) });
  equals(c, 'a th_dat_spo ad signals the marker it matched on', r.signal, 'th_dat_spo');

  calls.mapValue = (path) => (path === P.SPONSORED_PATH ? 'ad-77' : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'a store ad signals the id the store returned', r.signal, 'ad-77');
  calls.mapValue = () => null;

  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'Story', actors: [{ subscribe_status: 'CAN_SUBSCRIBE' }] }) });
  equals(c, 'a props can-subscribe signals the state', r.signal, 'CAN_SUBSCRIBE');
  equals(c, '…from props, not the store', r.evidence.source, 'props');

  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'Story', to: { viewer_forum_join_state: 'CAN_JOIN' } }) });
  equals(c, 'a props can-join signals the state', r.signal, 'CAN_JOIN');

  calls.mapValue = (path) => (path === P.JOIN_PATH ? 'CAN_JOIN' : null);
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'a store can-join signals the state', r.signal, 'CAN_JOIN');
  equals(c, '…and the source is the store', r.evidence.source, 'relay');
  calls.mapValue = () => null;

  r = C.classify({ feedUnit: { __typename: 'Story', id: 'u-follow-s', action_links: [{ action_type: 'SUBSCRIBE', text: '追蹤' }] } });
  equals(c, 'a follow button signals the action, not its text', r.signal, 'subscribe');

  r = C.classify({ feedUnit: { __typename: 'Story', id: 'u-join-s', comet_sections: { header: { story: { action_links: [{ action_type: 'JOIN_GROUP', text: '加入' }] } } } } });
  equals(c, 'a join button signals the action', r.signal, 'join_group');

  r = C.classify({ feedUnit: { __typename: 'Story', id: 'u-rec-s', comet_sections: { header: { story: { title: { text: '為你推薦' } } } } } });
  equals(c, 'a recommendation header signals the header text', r.signal, '為你推薦');

  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) });
  equals(c, 'a tray signals the typename that named it', r.signal, 'ShowcaseFeedUnit');
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'GroupsYouShouldJoinFeedUnit' }) });
  equals(c, '…whichever tray it is', r.signal, 'GroupsYouShouldJoinFeedUnit');
  r = C.classify({ feedUnit: feedUnitOf({ __typename: 'DiscoverFeedUnit' }) });
  equals(c, '…including the stories tray', r.signal, 'DiscoverFeedUnit');

  // No rule matched: there is no decisive value to report, and saying so is the fact.
  r = C.classify({ feedUnit: feedUnitOf() });
  equals(c, 'an unmatched unit signals nothing', r.signal, null);
  r = C.classify({ feedUnit: {} });
  equals(c, 'a unit with no id signals nothing', r.signal, null);
  equals(c, 'a null payload signals nothing', C.classify(null).signal, null);
  equals(c, '…and still reports no-payload', C.classify(null).reason, 'no-payload');
}

function equals(c, label, actual, expected) {
  c.equals(label, actual, expected);
}

module.exports = { run };
