/**
 * FB Diet - fold constants (MAIN world): module table, definer path,
 * hide mode, observer tunings, drift watchdog. No logic.
 * Naming: docs/conventions.md
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
    // Reels attachment style covers rail + friend share; route via classifier.
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

  // DOM observation tunings, one set shared by all detectors. // per STRATEGY.md §1.2
  const DOM_SCAN_DELAYS = [50, 150, 400, 1000, 2500, 5000];
  const DOM_SCAN_TIMEOUT_MS = 15000;
  const DOM_SCAN_THROTTLE_MS = 200;

  // Drift watchdog: loader streamed + nothing matched means stale module names.
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