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
    foldRegular: false,
    minimizedFoldMode: false,
    alwaysShowFoldBar: true,
    showTitleMode: 'whenFolded',
    restrictFoldScope: true,
    debugProbe: false
  };

  function normalizeFoldMode(value, fallback = 'off', minimizedFoldMode = false) {
    if (value === false || value === 'off') return 'off';
    if (value === true || value === 'mini' || value === 'title') {
      return minimizedFoldMode ? 'mini' : 'title';
    }
    return fallback;
  }

  // Fold scope (STRATEGY.md decision #26): classification and folding only run on
  // the allowlisted surfaces when SETTINGS.restrictFoldScope is on. Prefix matching
  // respects segment boundaries (/searchabc is NOT /search). Fail-open: a missing
  // or unknown pathname never blocks folding.
  const FOLD_SCOPE_PREFIXES = ['/', '/home.php', '/search', '/marketplace'];

  function isFoldScopeAllowed(pathname) {
    if (typeof pathname !== 'string' || !pathname) return true;
    return FOLD_SCOPE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
  }

  // Fold bar title visibility (STRATEGY.md decision #27): 'always' shows the
  // group/author/snippet on every bar, 'whenFolded' shows it only while the post
  // is folded (a summary of the hidden content; expanded bars keep badge + [-]),
  // 'never' never renders the title text. The legacy showFeedTitle boolean maps
  // onto that: false was a deliberate choice (never), while true rolls forward to
  // the new default because it is indistinguishable from the old default value.
  // Note: 'whenExpanded' (an earlier preview value) is unknown here and therefore
  // normalizes to the current default via the fallback.
  function normalizeTitleMode(value, fallback = 'whenFolded') {
    if (value === 'always' || value === 'whenFolded' || value === 'never') return value;
    if (value === false) return 'never';
    if (value === true) return 'whenFolded';
    return fallback;
  }

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

  // Two-layer classification (STRATEGY.md, decision #8): the classifier emits
  // fine-grained categories; the UI groups them for settings, folded bars and stats.
  // Storage stays per-category — groups are a pure presentation/operation layer.
  const GROUP_ORDER = ['ads', 'regular', 'suggested', 'media', 'other'];

  const GROUP_BY_CATEGORY = {
    sponsored: 'ads',
    marketAds: 'ads',
    searchingAds: 'ads',
    regular: 'regular',
    suggested: 'suggested',
    reels: 'media',
    stories: 'media',
    suggestedGroup: 'other'
  };

  // 'regular' is now a real foldable category (decision #16): its single key
  // foldRegular defaults to false, so ordinary friend posts are unfolded by
  // default but can be folded via the Options page.
  const SETTING_KEYS_BY_GROUP = {
    ads: ['foldSponsored', 'foldMarketAds', 'foldSearchingAds'],
    regular: ['foldRegular'],
    suggested: ['foldSuggested'],
    media: ['foldStories', 'foldReels'],
    other: ['foldSuggestedGroup']
  };

  const GROUP_META = {
    ads: {
      badgeClass: 'fb-diet-badge-ads',
      badgeText: 'Ads'
    },
    regular: {
      badgeClass: 'fb-diet-badge-regular',
      badgeText: 'Regular'
    },
    suggested: {
      badgeClass: 'fb-diet-badge-suggested',
      badgeText: 'Suggested'
    },
    media: {
      badgeClass: 'fb-diet-badge-media',
      badgeText: 'Reels & Stories'
    },
    other: {
      badgeClass: 'fb-diet-badge-other',
      badgeText: 'Other'
    }
  };

  const EXTENSION_VERSION = '2.1.0';
  globalThis.FB_DIET_DEFAULTS = {
    SETTINGS: DEFAULT_SETTINGS,
    COUNTS: DEFAULT_COUNTS,
    GROUP_ORDER: GROUP_ORDER,
    GROUP_BY_CATEGORY: GROUP_BY_CATEGORY,
    SETTING_KEYS_BY_GROUP: SETTING_KEYS_BY_GROUP,
    GROUP_META: GROUP_META,
    VERSION: EXTENSION_VERSION,
    getTodayDateString: getTodayDateString,
    normalizeFoldMode: normalizeFoldMode,
    normalizeTitleMode: normalizeTitleMode,
    isFoldScopeAllowed: isFoldScopeAllowed
  };
})();
