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
  // the MAIN world before classify.js, which reads its fold-mode normalizer from there.
  win.FB_DIET_DEFAULTS = loadDefaults();
  loadInject(win, 'metadata.js');
  loadInject(win, 'classify.js');
  const C = win.FBDietClassify;

  c.ok('classify API exposed on window', Boolean(C) && typeof C.classifyFeedUnit === 'function');

  const calls = [];
  C.setRelayReader((ids, path, options) => {
    calls.push({ ids, path, options });
    return (calls.mapValue && calls.mapValue(path)) || null;
  });

  const P = C.RELAY_PATHS;
  const feedUnitOf = (extra) => Object.assign({ id: 'u1', __typename: 'FeedUnitRoot' }, extra);

  /* --- sponsored via Relay --- */
  calls.mapValue = (path) => (path === P.SPONSORED_PATH ? 'ad-77' : null);
  let r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'sponsored category', r.category, 'sponsored');
  equals(c, 'sponsored reason', r.reason, 'sponsored_data.ad_id');
  equals(c, 'unit id extracted', r.unitId, 'u1');
  equals(c, 'evidence source is relay', r.evidence.source, 'relay');
  equals(c, 'ad id evidence', r.evidence.adId, 'ad-77');

  /* --- direct props win: Relay is never asked for the ad id --- */
  calls.length = 0;
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ sponsored_data: { ad_id: 'ad-88' } }) });
  equals(c, 'props-based sponsored', r.category, 'sponsored');
  equals(c, 'evidence source is props', r.evidence.source, 'props');
  c.ok('relay not asked for the ad id when props answered', calls.every((x) => x.path !== P.SPONSORED_PATH));

  /* --- th_dat_spo sponsored detection --- */
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ th_dat_spo: { brs_filter_setting: 90 } }) });
  equals(c, 'th_dat_spo sponsored category', r.category, 'sponsored');
  equals(c, 'th_dat_spo sponsored reason', r.reason, 'th_dat_spo');
  equals(c, 'th_dat_spo evidence source is props', r.evidence.source, 'props');

  /* --- nested feed unit (children.0.props.children.props) --- */
  calls.mapValue = () => null;
  r = C.classifyFeedUnit({ children: [{ props: { children: { props: { feedUnit: feedUnitOf() } } } }] });
  equals(c, 'nested unit id found', r.unitId, 'u1');

  /* --- suggested group by typename --- */
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'GroupsYouShouldJoinFeedUnit' }) });
  equals(c, 'suggestedGroup by record typename', r.category, 'suggestedGroup');

  r = C.classifyFeedUnit({ unitTypename: 'GroupsYouShouldJoinFeedUnit', feedUnit: feedUnitOf() });
  equals(c, 'suggestedGroup by payload typename', r.category, 'suggestedGroup');

  /* --- suggested by join state (props + relay): a can-join group POST is a
     suggestion, not the "Other" group list (STRATEGY.md, decision #10) --- */
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'Story', to: { viewer_forum_join_state: 'CAN_JOIN' } }) });
  equals(c, 'suggested by props join state', r.category, 'suggested');

  calls.mapValue = (path) => (path === P.JOIN_PATH ? 'CAN_JOIN' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'suggested by relay join state', r.category, 'suggested');

  /* --- suggested by subscribe status --- */
  calls.mapValue = (path) => (path === P.SUBSCRIBE_PATH ? 'CAN_SUBSCRIBE' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'suggested by subscribe status', r.category, 'suggested');

  // CAN_FOLLOW / NOT_SUBSCRIBED are NOT suggestion evidence: they matched nearly
  // every actor the viewer does not subscribe to and folded real friend activity
  // (STRATEGY.md, misclassifications 1 & 2).
  calls.mapValue = (path) => (path === P.SUBSCRIBE_PATH ? 'NOT_SUBSCRIBED' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'NOT_SUBSCRIBED actor is regular, not suggested', r.category, 'regular');
  calls.mapValue = (path) => (path === P.SUBSCRIBE_PATH ? 'CAN_FOLLOW' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'CAN_FOLLOW actor is regular, not suggested', r.category, 'regular');
  /* --- story header: diagnostic only, never decides a category --- */
  // The probe proved Facebook stores a friend's comment story under the same keyed
  // story_header record as suggestion headers, so headers must not fold
  // (STRATEGY.md, decision #6). The evidence is still collected for diagnostics.
  calls.mapValue = (path) => (path === P.STORY_HEADER_PATH ? 'Suggested for you' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'story header never folds a unit (regular)', r.category, 'regular');
  equals(c, 'story header not in evidence', r.evidence.storyLocation, undefined);

  // A location-free story_header ("X commented on ...") is NOT suggestion evidence:
  // contextual stories carry one too and must stay visible.
  calls.mapValue = (path) => (path.indexOf('story_header') !== -1 && path.indexOf('$1') === -1 ? 'A friend commented on a post' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'plain contextual story_header is regular', r.category, 'regular');

  // Existence of a location-keyed story_header without a title is not enough either.
  calls.mapValue = (path) => (path === '^story_header{$1}' ? { location: 'homepage_stream' } : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'story_header existence without title is regular', r.category, 'regular');
  /* --- reels --- */
  calls.mapValue = () => null;

  // Clear-cut Reels surface: the Showcase feed unit is always a Reels product.
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) });
  equals(c, 'reels by ShowcaseFeedUnit typename', r.category, 'reels');
  equals(c, 'reels reason', r.reason, 'unitTypename:ShowcaseFeedUnit');

  // showcase_story_type ALONE must NOT fold: a friend resharing a reel exposes the
  // same field on an ordinary Story unit, and that friend post has to stay visible.
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ showcase_story_type: 'SHOWCASE_SHORT_VIDEO' }) });
  equals(c, 'showcase type alone is regular', r.category, 'regular');
  r = C.classifyFeedUnit({ unitTypename: 'Story', feedUnit: feedUnitOf({ showcase_story_type: 'SHOWCASE_SHORT_VIDEO' }) });
  equals(c, 'friend shared reel (Story) is regular', r.category, 'regular');

  // A friend's share nests a ShowcaseFeedUnit attachment inside an ordinary Story:
  // the nested record's typename must never trigger the Reels rule
  // (STRATEGY.md, misclassification 3).
  r = C.classifyFeedUnit({
    unitTypename: 'Story',
    feedUnit: feedUnitOf(),
    children: [{ props: { feedUnit: { id: 'reel-1', __typename: 'ShowcaseFeedUnit' } } }]
  });
  equals(c, 'friend share with nested showcase is regular', r.category, 'regular');

  // A payload whose OWN typename is missing (attachment-level payload) is equally not
  // a Reels surface: only a typename read off the nested record would match.
  r = C.classifyFeedUnit({ children: [{ props: { feedUnit: { id: 'reel-2', __typename: 'ShowcaseFeedUnit' } } }] });
  equals(c, 'nested-only showcase typename is regular', r.category, 'regular');

  // The Reels attachment style wrapper renders attachments by definition; units
  // classified from that module must never fold as Reels.
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) }, { moduleName: 'CometFeedStoryFBReelsAttachmentStyle.react' });
  equals(c, 'attachment module context classifies as regular', r.category, 'regular');
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) }, { moduleName: 'CometFeedUnitErrorBoundary.react' });
  equals(c, 'reels still folds for other modules', r.category, 'reels');

  /* --- relay read log (probe relayReads) --- */
  // Every read is recorded with the value that came back, and the log resets
  // per classification so a probe reflects exactly one unit.
  calls.mapValue = (path) => (path === P.SPONSORED_PATH ? 'ad-77' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  let reads = C.getLastRelayReads();
  c.ok('relay read log has entries', Array.isArray(reads) && reads.length > 0);
  c.ok('relay read log carries the sponsored hit', reads.some((entry) => entry.path === P.SPONSORED_PATH && entry.value === 'ad-77'));

  calls.mapValue = () => null;
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  reads = C.getLastRelayReads();
  c.ok('relay read log resets per unit', reads.length > 0 && reads.every((entry) => entry.value === null));

  /* --- stories: mid-feed Stories row (DiscoverFeedUnit) --- */
  // The Stories row inserted into the home feed arrives via the generic
  // CometFeedUnitErrorBoundary.react wrapper, so only the unit's own typename can
  // identify it (STRATEGY.md, decision #7).
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'DiscoverFeedUnit' }) }, { moduleName: 'CometFeedUnitErrorBoundary.react' });
  equals(c, 'stories by DiscoverFeedUnit typename', r.category, 'stories');
  equals(c, 'stories reason', r.reason, 'unitTypename:DiscoverFeedUnit');

  r = C.classifyFeedUnit({ unitTypename: 'DiscoverFeedUnit', feedUnit: feedUnitOf() });
  equals(c, 'stories by payload typename', r.category, 'stories');

  // An ordinary Story wrapping a nested DiscoverFeedUnit record must stay visible:
  // same own-typename guard as the Reels rule.
  r = C.classifyFeedUnit({
    unitTypename: 'Story',
    feedUnit: feedUnitOf(),
    children: [{ props: { feedUnit: { id: 'st-1', __typename: 'DiscoverFeedUnit' } } }]
  });
  equals(c, 'nested-only DiscoverFeedUnit is regular', r.category, 'regular');

  /* --- priority: an ad in a Stories row is still an ad --- */
  calls.mapValue = (path) => (path === P.SPONSORED_PATH ? 'ad-5' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'DiscoverFeedUnit' }) });
  equals(c, 'sponsored beats stories', r.category, 'sponsored');
  calls.mapValue = () => null;
  /* --- priority: an ad that is also a group suggestion is an ad --- */
  calls.mapValue = (path) => (path === P.SPONSORED_PATH ? 'ad-9' : 'CAN_JOIN');
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'GroupsYouShouldJoinFeedUnit' }) });
  equals(c, 'sponsored beats suggestedGroup', r.category, 'sponsored');

  /* --- no-match / empty --- */
  calls.mapValue = () => null;
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'unmatched unit with id is classified as regular', r.category, 'regular');
  equals(c, 'no-match reason', r.reason, 'no-match');
  equals(c, 'unit id still present for debugging', r.unitId, 'u1');
  c.ok('evidence block always returned', Boolean(r.evidence) && r.evidence.id === 'u1' && r.evidence.idCount === 1);

  r = C.classifyFeedUnit({ feedUnit: {} });
  equals(c, 'unit without id reports no-unit-id', r.reason, 'no-unit-id');
  equals(c, 'empty payload is safe', C.classifyFeedUnit(null).category, null);

  /* --- error resilience --- */
  const hostile = {};
  Object.defineProperty(hostile, 'feedUnit', {
    get() {
      throw new Error('hostile getter');
    }
  });
  let hostileResult = null;
  try {
    hostileResult = C.classifyFeedUnit(hostile);
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
  r = C.classifyFeedUnit({
    feedUnit: {
      __typename: 'Story',
      id: 'u-follow',
      action_links: [{ action_type: 'SUBSCRIBE', text: '追蹤' }]
    }
  });
  equals(c, 'follow action classified as suggested', r.category, 'suggested');
  equals(c, 'follow action reason', r.reason, 'action_links:subscribe');

  // 2. Join group action button
  r = C.classifyFeedUnit({
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
  r = C.classifyFeedUnit({
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
  r = C.classifyFeedUnit({
    feedUnit: {
      __typename: 'Story',
      id: 'u-friend-comment',
      comet_sections: {
        header: {
          story: {
            title: { text: 'Sunny Lin 最近留言回應。' }
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
  r = C.classifyFeedUnit({
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
  r = C.classifyFeedUnit({
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
  r = C.classifyFeedUnit(
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
}

function equals(c, label, actual, expected) {
  c.equals(label, actual, expected);
}

module.exports = { run };
