// src/shared/defaults.js
// Single source of truth for default settings, keyword matrices, and statistics schemas.
// Loaded before content/options/popup/MAIN scripts to expose a shared global constant.
//
// Uses globalThis so repeated injection into the same page never throws.

(function () {
  // ---------------------------------------------------------------------------
  // Section 1: core schemas (settings and statistics)
  // ---------------------------------------------------------------------------

  const DEFAULT_SETTINGS = {
    enabled: true,
    dietMode: 'full',
    foldAds: true,
    foldRegular: false,
    foldSuggested: false,
    foldMedia: true,
    foldOther: false,
    minimizedFoldMode: false,
    alwaysShowFoldBar: true,
    showTitleMode: 'whenFolded',
    restrictFoldScope: true,
    debugProbe: false
  };

  // Statistics row persisted under the "counts" storage key: base metadata
  // (date, total, filtered) plus one counter per user-facing group.
  const DEFAULT_COUNTS = {
    date: getTodayDateString(),
    total: 0,
    filtered: 0,
    ads: 0,
    regular: 0,
    suggested: 0,
    media: 0,
    other: 0
  };

  // ---------------------------------------------------------------------------
  // Section 2: group and category mappings
  // ---------------------------------------------------------------------------

  // Two-tier classification (STRATEGY.md decision #8):
  // Fine-grained categories are classified at the engine layer and mapped into
  // 5 user-facing groups for UI controls, badge rendering, and storage settings.
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

  // Group-level fold settings (1:1 with user-facing groups): the Options page
  // batch-writes these keys and lights a group only when every mapped key is on.
  const SETTING_KEYS_BY_GROUP = {
    ads: ['foldAds'],
    regular: ['foldRegular'],
    suggested: ['foldSuggested'],
    media: ['foldMedia'],
    other: ['foldOther']
  };

  // Category -> storage key, so the classifier reads one table instead of keeping
  // its own copy. tests/defaults.test.js pins that this agrees with the two above.
  const SETTING_BY_CATEGORY = {
    sponsored: 'foldAds',
    marketAds: 'foldAds',
    searchingAds: 'foldAds',
    regular: 'foldRegular',
    suggested: 'foldSuggested',
    reels: 'foldMedia',
    stories: 'foldMedia',
    suggestedGroup: 'foldOther'
  };

  // Badge metadata for the 5 user-facing groups (rendered by src/inject/ui.js).
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

  // ---------------------------------------------------------------------------
  // Section 3: shared keyword matrices
  // ---------------------------------------------------------------------------

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

  // First path segments that are Facebook routes rather than vanity handles. Shared by
  // both permalink producers (ui.js synthesis and metadata.js username extraction) because
  // they answer the same question; each caller keeps its own matching rule.
  // Adding an entry here tightens permalink synthesis in both places at once.
  const RESERVED_PROFILE_SEGMENTS = [
    'groups', 'pages', 'profile.php', 'stories', 'story.php', 'share', 'watch',
    'reel', 'reels', 'events', 'hashtag', 'photos', 'photo.php', 'media',
    'policies', 'privacy', 'help', 'settings'
  ];

  // ---------------------------------------------------------------------------
  // Section 4: policy and validation helpers
  // ---------------------------------------------------------------------------

  function normalizeFoldMode(value, fallback = 'off', minimizedFoldMode = false) {
    if (!value || value === 'off') return 'off';
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

  // Fold bar title visibility (STRATEGY.md decision #27):
  // 'always' shows summary on every bar;
  // 'whenFolded' shows summary only while folded;
  // 'never' hides summary text across all states.
  const VALID_TITLE_MODES = new Set(['always', 'whenFolded', 'never']);

  function normalizeTitleMode(value, fallback = 'whenFolded') {
    return VALID_TITLE_MODES.has(value) ? value : fallback;
  }

  function getTodayDateString(d) {
    const now = d || new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Walks a dotted property path over a serialized payload.
   * Returns undefined as soon as a hop is missing, so callers can `||` a fallback.
   */
  function readProp(object, path) {
    let current = object;
    for (const part of String(path).split('.')) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  const EXTENSION_VERSION = '2.7.1';

  globalThis.FB_DIET_DEFAULTS = {
    SETTINGS: DEFAULT_SETTINGS,
    COUNTS: DEFAULT_COUNTS,
    GROUP_BY_CATEGORY,
    SETTING_KEYS_BY_GROUP,
    SETTING_BY_CATEGORY,
    GROUP_META,
    KEYWORDS,
    RESERVED_PROFILE_SEGMENTS,
    VERSION: EXTENSION_VERSION,
    getTodayDateString,
    normalizeFoldMode,
    normalizeTitleMode,
    isFoldScopeAllowed,
    readProp
  };
})();
