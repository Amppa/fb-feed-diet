'use strict';
const { Checker, createWindow, loadInject } = require('./harness');

function makeReader(calls) {
  return (ids, path, options) => {
    calls.push({ ids, path, options });
    return calls.mapValue && calls.mapValue(path) ? calls.mapValue(path) : null;
  };
}

function run(c) {
  const win = createWindow();
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

  /* --- nested feed unit (children.0.props.children.props) --- */
  calls.mapValue = () => null;
  r = C.classifyFeedUnit({ children: [{ props: { children: { props: { feedUnit: feedUnitOf() } } } }] });
  equals(c, 'nested unit id found', r.unitId, 'u1');

  /* --- suggested group by typename --- */
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'GroupsYouShouldJoinFeedUnit' }) });
  equals(c, 'suggestedGroup by record typename', r.category, 'suggestedGroup');

  r = C.classifyFeedUnit({ unitTypename: 'GroupsYouShouldJoinFeedUnit', feedUnit: feedUnitOf() });
  equals(c, 'suggestedGroup by payload typename', r.category, 'suggestedGroup');

  /* --- suggested group by join state (props + relay) --- */
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ to: { viewer_forum_join_state: 'CAN_JOIN' } }) });
  equals(c, 'suggestedGroup by props join state', r.category, 'suggestedGroup');

  calls.mapValue = (path) => (path === P.JOIN_PATH ? 'CAN_JOIN' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'suggestedGroup by relay join state', r.category, 'suggestedGroup');

  /* --- suggested by subscribe status --- */
  calls.mapValue = (path) => (path === P.SUBSCRIBE_PATH ? 'CAN_SUBSCRIBE' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'suggested by subscribe status', r.category, 'suggested');

  // CAN_FOLLOW / NOT_SUBSCRIBED are NOT suggestion evidence: they matched nearly
  // every actor the viewer does not subscribe to and folded real friend activity
  // (STRATEGY.md, misclassifications 1 & 2).
  calls.mapValue = (path) => (path === P.SUBSCRIBE_PATH ? 'NOT_SUBSCRIBED' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'NOT_SUBSCRIBED actor is not suggested', r.category, null);
  calls.mapValue = (path) => (path === P.SUBSCRIBE_PATH ? 'CAN_FOLLOW' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'CAN_FOLLOW actor is not suggested', r.category, null);
  /* --- suggested by story header location --- */
  calls.mapValue = (path) => (path === P.STORY_HEADER_PATH ? 'Suggested for you' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'suggested by story location', r.category, 'suggested');
  equals(c, 'story location evidence', r.evidence.storyLocation, 'homepage_stream');

  // A location-free story_header ("X commented on ...") is NOT suggestion evidence:
  // contextual stories carry one too and must stay visible.
  calls.mapValue = (path) => (path.indexOf('story_header') !== -1 && path.indexOf('$1') === -1 ? 'A friend commented on a post' : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'plain contextual story_header is not suggested', r.category, null);

  // Existence of a location-keyed story_header without a title is not enough either.
  calls.mapValue = (path) => (path === '^story_header{$1}' ? { location: 'homepage_stream' } : null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'story_header existence without title is not suggested', r.category, null);
  /* --- reels --- */
  calls.mapValue = () => null;

  // Clear-cut Reels surface: the Showcase feed unit is always a Reels product.
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) });
  equals(c, 'reels by ShowcaseFeedUnit typename', r.category, 'reels');
  equals(c, 'reels reason', r.reason, 'unitTypename:ShowcaseFeedUnit');

  // showcase_story_type ALONE must NOT fold: a friend resharing a reel exposes the
  // same field on an ordinary Story unit, and that friend post has to stay visible.
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ showcase_story_type: 'SHOWCASE_SHORT_VIDEO' }) });
  equals(c, 'showcase type alone is not reels', r.category, null);
  r = C.classifyFeedUnit({ unitTypename: 'Story', feedUnit: feedUnitOf({ showcase_story_type: 'SHOWCASE_SHORT_VIDEO' }) });
  equals(c, 'friend shared reel (Story) stays visible', r.category, null);

  // A friend's share nests a ShowcaseFeedUnit attachment inside an ordinary Story:
  // the nested record's typename must never trigger the Reels rule
  // (STRATEGY.md, misclassification 3).
  r = C.classifyFeedUnit({
    unitTypename: 'Story',
    feedUnit: feedUnitOf(),
    children: [{ props: { feedUnit: { id: 'reel-1', __typename: 'ShowcaseFeedUnit' } } }]
  });
  equals(c, 'friend share with nested showcase stays visible', r.category, null);

  // A payload whose OWN typename is missing (attachment-level payload) is equally not
  // a Reels surface: only a typename read off the nested record would match.
  r = C.classifyFeedUnit({ children: [{ props: { feedUnit: { id: 'reel-2', __typename: 'ShowcaseFeedUnit' } } }] });
  equals(c, 'nested-only showcase typename is not reels', r.category, null);

  // The Reels attachment style wrapper renders attachments by definition; units
  // classified from that module must never fold as Reels.
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) }, { moduleName: 'CometFeedStoryFBReelsAttachmentStyle.react' });
  equals(c, 'attachment module context never folds as reels', r.category, null);
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'ShowcaseFeedUnit' }) }, { moduleName: 'CometFeedUnitErrorBoundary.react' });
  equals(c, 'reels still folds for other modules', r.category, 'reels');
  /* --- priority: an ad that is also a group suggestion is an ad --- */
  calls.mapValue = (path) => (path === P.SPONSORED_PATH ? 'ad-9' : 'CAN_JOIN');
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf({ __typename: 'GroupsYouShouldJoinFeedUnit' }) });
  equals(c, 'sponsored beats suggestedGroup', r.category, 'sponsored');

  /* --- unknown / empty --- */
  calls.mapValue = () => null;
  r = C.classifyFeedUnit({ feedUnit: feedUnitOf() });
  equals(c, 'unmatched unit is unknown, not folded', r.category, null);
  equals(c, 'unknown reason', r.reason, 'unknown');
  equals(c, 'unit id still present for debugging', r.unitId, 'u1');
  c.ok('evidence block always returned', Boolean(r.evidence) && Array.isArray(r.evidence.ids));

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
  equals(c, 'per category switch', C.isCategoryEnabled('suggested', { removeSuggested: false }), false);
  equals(c, 'unknown category disabled', C.isCategoryEnabled('nope', {}), false);
}

function equals(c, label, actual, expected) {
  c.equals(label, actual, expected);
}

module.exports = { run };
