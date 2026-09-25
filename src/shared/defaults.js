// src/shared/defaults.js
// Single source of truth for default settings and statistics schemas.
// Loaded before content/options/popup/MAIN scripts to expose a shared global constant.
//
// Uses globalThis so repeated injection into the same page never throws.

(function () {
  const DEFAULT_SETTINGS = {
    enabled: true,
    dietMode: 'lite',
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

  // Multilingual detection vocabulary shared by MAIN and ISOLATED world consumers.
  // Keep context-specific lists separate: their matching rules are not interchangeable.
  const KEYWORDS = {
    SPONSORED: [
      'sponsored', '贊助', '赞助', '広告', '스폰서', 'sponsorisé', 'gesponsert', 'patrocinado', 'publicidad'
    ],
    SUGGESTED_FALLBACK: [
      'suggested for you', 'suggested post', 'suggested page', 'people you may know',
      '為您推薦', '為你推薦', '推薦貼文', '你可能認識的朋友', '为你推荐', '推荐帖子', '可能认识的人',
      'おすすめ', '知り合いかも'
    ],
    SUGGESTED_GROUP: [
      'suggested group', 'suggested groups', 'groups you might like', 'groups for you', 'suggested groups for you',
      '建議的社團', '建議社團', '推薦社團', '推荐群组', 'おすすめのグループ'
    ],
    STORIES: ['stories', '限時動態', '限时动态', 'ストーリーズ', '스토리', 'storie'],
    REELS: ['reels', '連續短片', '短视频', 'reels 和短影片', 'reels and short videos', 'リール', '릴스'],
    SUGGESTED_DOM: [
      '為你推薦', '为你推荐', 'Suggested for you', '推薦貼文', '推荐帖子', 'Suggested post',
      '推薦你加入', '推荐你加入', 'Popular across Facebook', 'Facebook 熱門內容'
    ],
    FOLLOW_ACTIONS: ['追蹤', 'follow', '關注', '追蹤粉絲專頁', 'follow page'],
    JOIN_ACTIONS: ['加入', 'join', '加入社團', 'join group'],
    NEGATIVE_ACTIONS: ['取消追蹤', '已追蹤', 'following', 'unfollow', '已加入', 'joined'],
    DIAGNOSTIC: ['追蹤', '加入', '推薦', 'SUBSCRIBE', 'JOIN', 'FOLLOW', 'SUGGEST']
  };
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

  const EXTENSION_VERSION = '2.5.1';
  globalThis.FB_DIET_DEFAULTS = {
    SETTINGS: DEFAULT_SETTINGS,
    COUNTS: DEFAULT_COUNTS,
    KEYWORDS: KEYWORDS,
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
