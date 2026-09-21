// src/shared/defaults.js
// Single source of truth for default settings and statistics schemas.
// Loaded before content/options/popup/MAIN scripts to expose a shared global constant.
//
// Uses globalThis so repeated injection into the same page never throws.

(function () {
  const DEFAULT_SETTINGS = {
    enabled: true,
    mode: 'proxy',
    foldSponsored: true,
    foldSuggested: true,
    foldSuggestedGroup: true,
    foldMarketAds: true,
    foldSearchingAds: true,
    foldStories: true,
    foldReels: true,
    debugProbe: false
  };

  function getTodayDateString(d) {
    const now = d || new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const DEFAULT_COUNTS = {
    date: getTodayDateString(),
    total: 0,
    filtered: 0,
    sponsored: 0,
    suggested: 0,
    suggestedGroup: 0,
    marketAds: 0,
    searchingAds: 0,
    stories: 0,
    reels: 0,
    regular: 0
  };

  globalThis.FB_DIET_DEFAULTS = {
    SETTINGS: DEFAULT_SETTINGS,
    COUNTS: DEFAULT_COUNTS,
    VERSION: 1,
    getTodayDateString: getTodayDateString
  };
})();
