/**
 * FB Diet - fold constants (MAIN world)
 *
 * Owns every value the fold pipeline reads rather than decides: which Facebook module
 * names are wrapped, how a definer path defaults, the hide mode, and the three tuning
 * constants each of the DOM observer and the drift watchdog runs on. Split out of
 * fold.js; this file holds no logic and calls no sibling.
 *
 * Public API: window.FBDietFoldConfig
 * Siblings read it lazily through `window.FBDietFoldConfig`, so this file needs no
 * declared load order of its own. Members are not prefixed with the module's own name,
 * so the module reads window.FBDietFoldConfig.HIDE_MODE rather than
 * window.FBDietFoldConfig.FBDietHideMode.
 */
window.FBDietFoldConfig = (() => {
  'use strict';

  const DEFAULT_DEFINER_PATH = '[6].default';
  const FEED_UNIT_MODULES = [
    { name: 'CometFeedUnitErrorBoundary.react', category: null },
    { name: 'CometAdsSideFeedUnitItem.react', category: 'sponsored' },
    { name: 'CometHomeRightRailUnit.react', category: 'sponsored', definerPath: '[6].default.render' },
    { name: 'FBReelsTopOfFeedTrayTile.react', category: 'reels' },
    { name: 'FBReelsRootWrapper.react', category: 'reels' },
    // A Story with a Reels attachment style is used for BOTH the Reels rail and a
    // friend's share of a reel. Routing it through the classifier keeps real reels
    // feed units foldable while friend shares stay visible.
    { name: 'CometFeedStoryFBReelsAttachmentStyle.react', category: null },
    { name: 'StoriesTrayRectangularRoot.react', category: 'stories' },
    { name: 'StoriesTray.react', category: 'stories' },
    { name: 'StoriesTrayRoot.react', category: 'stories' },
    { name: 'CometStoriesTray.react', category: 'stories' },
    { name: 'FriendingCometPYMKGrid.react', category: 'suggested' },
    { name: 'FriendingCometFeedPYMKHScroll.react', category: 'suggested' },
    { name: 'FriendingCometPYMKPanel.react', category: 'suggested' },
    { name: 'CometMarketplaceAdCard.react', category: 'marketAds' },
    { name: 'SearchCometResultsAd.react', category: 'searchingAds' }
  ];

  function withDefaultDefinerPath() {
    return FEED_UNIT_MODULES.map((item) => Object.assign({ definerPath: DEFAULT_DEFINER_PATH }, item));
  }

  const HIDE_MODE = 'squash';

  // DOM observation — armed in `dom` mode, the one that has a mounted-DOM engine
  // alike (STRATEGY.md decision #40): retry ladder for streaming Suspense renders, a throttle
  // that coalesces MutationObserver bursts, and the hard timeout after which the observer stops
  // for good. ONE set is shared by all three detectors (stage 3 of the DOM pipeline):
  // a busy post costs one detection pass per throttle window and one ladder per unit,
  // not one of each per detector.
  const DOM_SCAN_DELAYS = [50, 150, 400, 1000, 2500, 5000];
  const DOM_SCAN_TIMEOUT_MS = 15000;
  const DOM_SCAN_THROTTLE_MS = 200;

  // Module drift watchdog. FEED_UNIT_MODULES hard-codes Facebook's internal module
  // names; when Facebook renames them the Comet hook silently stops matching and folding
  // quietly dies. The hook counts loader activity (dCalls) and matched modules
  // (seen), so "loader streamed hundreds of modules + Relay data flows + scope
  // allowed + nothing matched" means drift. Warn once; never debug-gated (the
  // reference projects keep breakage detection always-on for exactly this reason).
  const DRIFT_MIN_DCALLS = 300;
  const DRIFT_CHECK_DELAYS = [15000, 45000];

  return {
    DEFAULT_DEFINER_PATH,
    FEED_UNIT_MODULES,
    withDefaultDefinerPath,
    HIDE_MODE,
    DOM_SCAN_DELAYS,
    DOM_SCAN_TIMEOUT_MS,
    DOM_SCAN_THROTTLE_MS,
    DRIFT_MIN_DCALLS,
    DRIFT_CHECK_DELAYS
  };
})();