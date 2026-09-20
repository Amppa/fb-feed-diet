/**
 * FB Diet - RETIRED classification rules (reference only, NOT loaded by manifest.json).
 *
 * Backup of previously shipped classification rules, kept as ready-to-run functions so
 * they can be re-activated quickly if a Facebook redesign changes the data landscape.
 *
 * How to re-activate a rule:
 *   1. Copy the function into src/inject/classify.js and re-add the pickCategory branch
 *      at the right priority position (sponsored > suggestedGroup > suggested > reels).
 *   2. Collect fresh probe reports (the per-unit copy button) and confirm the trigger
 *      signal still holds on current Facebook data.
 *   3. Add positive + negative regression tests in tests/classify.test.js.
 *   4. Update STRATEGY.md with a new decision entry.
 *
 * Why each rule was retired (full reasoning in STRATEGY.md, decisions #1 / #2 / #3 / #6):
 *   - SUBSCRIBE_STATES_EXTENDED: CAN_FOLLOW / NOT_SUBSCRIBED folded ordinary friend
 *     activity (misclassifications 1 & 2).
 *   - storyHeader rules: Facebook stores contextual stories under the SAME
 *     story_header(location:"homepage_stream") record as suggestion headers
 *     (probe 2026-09-19: the header of a friend comment story lives in
 *     client:1238:story_header(location:"homepage_stream"):title).
 *   - reelsByStoryType: showcase_story_type alone also matches a friend shared reel.
 */
window.FBDietRetiredRules = (function () {
  'use strict';

  // Was tried for suggested (decision #1): NOT_SUBSCRIBED matched nearly every actor
  // the viewer does not subscribe to.
  const SUBSCRIBE_STATES_EXTENDED = ['CAN_SUBSCRIBE', 'CAN_FOLLOW', 'NOT_SUBSCRIBED'];

  const STORY_LOCATIONS = ['homepage_stream', 'groups_tab', 'feed'];

  /**
   * [RETIRED 2026-09, decisions #2 + #6] esuit's story_header rule: a keyed story_header
   * record with a non-empty title counts as a suggestion. The probe proved contextual
   * stories share this exact record, so it folded friend activity.
   */
  function storyHeaderSuggested(ids, read) {
    for (const location of STORY_LOCATIONS) {
      const opts = { $1: { location: location }, params: { $1: { location: location } } };
      const title = read(ids, '^story_header{$1}.^title.text', opts);
      if (title) return { storyLocation: location, storyTitle: title };
    }
    return null;
  }

  /**
   * [RETIRED 2026-09, decisions #2 + #6] Location-free variants of the story_header rule:
   * any story_header / any title. Even more over-matching than the keyed variant.
   */
  function storyHeaderLoose(ids, read) {
    let value = read(ids, '^story_header.^title.text');
    if (!value) value = read(ids, '^story_header.title.text');
    if (!value && read(ids, '^story_header')) value = 'header';
    return value ? { storyLocation: 'header', storyTitle: value } : null;
  }

  /**
   * [RETIRED 2026-09, decision #1] Extended subscribe states. The live rule keeps only
   * CAN_SUBSCRIBE; CAN_FOLLOW / NOT_SUBSCRIBED over-matched.
   */
  function subscribeSuggestedExtended(ids, read) {
    const status = read(ids, '^^actors[0].subscribe_status');
    return SUBSCRIBE_STATES_EXTENDED.indexOf(status) !== -1;
  }

  /**
   * [RETIRED 2026-09, decision #3] Reels by showcase_story_type alone: also matches an
   * ordinary Story sharing a reel. The live rule requires the unit's OWN typename to be
   * ShowcaseFeedUnit instead.
   */
  function reelsByStoryType(ids, read) {
    return read(ids, 'showcase_story_type') === 'SHOWCASE_SHORT_VIDEO';
  }

  return {
    SUBSCRIBE_STATES_EXTENDED: SUBSCRIBE_STATES_EXTENDED,
    STORY_LOCATIONS: STORY_LOCATIONS,
    storyHeaderSuggested: storyHeaderSuggested,
    storyHeaderLoose: storyHeaderLoose,
    subscribeSuggestedExtended: subscribeSuggestedExtended,
    reelsByStoryType: reelsByStoryType
  };
})();

if (typeof module !== 'undefined' && module.exports !== undefined) {
  module.exports = window.FBDietRetiredRules;
}
