// src/shared/defaults.js
// Single source of truth for defaults, keywords, and schemas.

(function () {
  // Section 1: core schemas

  const DEFAULT_SETTINGS = {
    enabled: true,
    dietMode: 'relay',
    foldAds: true,
    foldRegular: false,
    foldSuggested: false,
    foldMedia: false,
    foldOther: true,
    minimizedFoldMode: true,
    alwaysShowFoldBar: true,
    showTitleMode: 'whenFolded',
    tooltipMode: 'large',
    themeMode: 'auto',
    restrictFoldScope: true,
    debugProbe: false,
    lang: 'auto'
  };

  // Counts row: base metadata plus one counter per group.
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

  // Section 2: group and category mappings

  // Fine categories map to 5 user-facing groups.
  // per docs/architecture.md
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

  // Group-level fold settings (1:1 with groups).
  const SETTING_KEYS_BY_GROUP = {
    ads: ['foldAds'],
    regular: ['foldRegular'],
    suggested: ['foldSuggested'],
    media: ['foldMedia'],
    other: ['foldOther']
  };

  // Category -> storage key.
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

  // Badge metadata for the 5 user-facing groups.
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

  // Fine-category badge text overrides; falls back to GROUP_META[group].badgeText.
  const CATEGORY_BADGE_TEXT = {
    reels: 'Reels',
    stories: 'Stories'
  };

  function resolveBadgeText(category) {
    if (CATEGORY_BADGE_TEXT[category]) return CATEGORY_BADGE_TEXT[category];
    const group = GROUP_BY_CATEGORY[category] || 'other';
    return (GROUP_META[group] && GROUP_META[group].badgeText) || 'Other';
  }

  // Section 3: shared keyword matrices

  // Multilingual vocabulary shared by MAIN and ISOLATED consumers.
  const KEYWORDS = {
    SPONSORED: [
      // Exact-match only, so short "ad" is safe here.
      'sponsored', 'ad', '廣告', '广告',
      '贊助', '赞助', '広告', '스폰서', 'sponsorisé', 'gesponsert', 'patrocinado', 'publicidad'
    ],
    SUGGESTED_FALLBACK: [
      'suggested for you', 'suggested post', 'suggested page', 'people you may know',
      '為您推薦', '為你推薦', '推薦貼文', '你可能認識的朋友', '为你推荐', '推荐帖子', '可能认识的人',
      'おすすめ', '知り合いかも'
    ],
    SUGGESTED_GROUP: [
      'suggested group', 'suggested groups', 'groups you might like', 'groups for you', 'suggested groups for you',
      '建議的社團', '建議社團', '推薦社團', '推荐群组', 'おすすめのグループ',
      // Live header reads "你的社團建議"; substring rule also matches dismiss chrome.
      '你的社團建議', '社團建議', '你的群组建议', '群组建议'
    ],
    STORIES: ['stories', '限時動態', '限时动态', 'ストーリーズ', '스토리', 'storie'],
    // Singular "reel" matches the single-video pill.
    REELS: ['reels', 'reel', '連續短片', '短视频', '短影片', 'reels 和短影片', 'reels and short videos', 'リール', '릴스'],
    SUGGESTED_DOM: [
      '為你推薦', '为你推荐', 'Suggested for you', '推薦貼文', '推荐帖子', 'Suggested post',
      '推薦你加入', '推荐你加入', 'Popular across Facebook', 'Facebook 熱門內容'
    ],
    FOLLOW_ACTIONS: ['追蹤', 'follow', '關注', '追蹤粉絲專頁', 'follow page'],
    JOIN_ACTIONS: ['加入', 'join', '加入社團', 'join group'],
    NEGATIVE_ACTIONS: ['取消追蹤', '已追蹤', 'following', 'unfollow', '已加入', 'joined'],
    DIAGNOSTIC: ['追蹤', '加入', '推薦', 'SUBSCRIBE', 'JOIN', 'FOLLOW', 'SUGGEST']
  };

  // Facebook routes vs vanity handles; shared by permalink producers.
  const RESERVED_PROFILE_SEGMENTS = [
    'groups', 'pages', 'profile.php', 'stories', 'story.php', 'share', 'watch',
    'reel', 'reels', 'events', 'hashtag', 'photos', 'photo.php', 'media',
    'policies', 'privacy', 'help', 'settings'
  ];

  // Section 4: policy and validation helpers

  // Two parallel strategies: Relay survives redesign, DOM survives schema change.
  // Each mode runs exactly one engine.
  // per STRATEGY.md §1
  const DETECTION_MODES = ['relay', 'dom'];
  const DEFAULT_DETECTION_MODE = 'relay';

  // Retired values (lite/full/relay+dom) normalize to relay on read.
  const LEGACY_DETECTION_MODES = { lite: 'relay', full: 'relay', 'relay+dom': 'relay' };

  function normalizeDetectionMode(value, fallback = DEFAULT_DETECTION_MODE) {
    if (typeof value !== 'string') return fallback;
    if (DETECTION_MODES.indexOf(value) !== -1) return value;
    const legacy = LEGACY_DETECTION_MODES[value];
    if (legacy) return legacy;
    return fallback;
  }

  function normalizeFoldMode(value, fallback = 'off', minimizedFoldMode = false) {
    if (!value || value === 'off') return 'off';
    if (value === true || value === 'mini' || value === 'title') {
      return minimizedFoldMode ? 'mini' : 'title';
    }
    return fallback;
  }

  // Fold scope: allowlisted surfaces only; fail-open on unknown pathname.
  // per docs/architecture.md
  const FOLD_SCOPE_PREFIXES = ['/', '/home.php', '/search', '/marketplace'];

  function isFoldScopeAllowed(pathname) {
    if (typeof pathname !== 'string' || !pathname) return true;
    return FOLD_SCOPE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
  }

  // Fold bar title visibility: always/whenFolded/never.
  // per docs/architecture.md
  const VALID_TITLE_MODES = new Set(['always', 'whenFolded', 'never']);

  function normalizeTitleMode(value, fallback = 'whenFolded') {
    return VALID_TITLE_MODES.has(value) ? value : fallback;
  }

  // Fold bar tooltip: off/normal(16px)/large(28px). Retired values ('native',
  // 'custom') fall through to the default per user decision, no mapping.
  const VALID_TOOLTIP_MODES = new Set(['off', 'normal', 'large']);

  function normalizeTooltipMode(value, fallback = 'large') {
    return VALID_TOOLTIP_MODES.has(value) ? value : fallback;
  }

  // Custom tooltip font size (px) per mode; the options page exposes these as
  // 加大 (28px) / 一般 (16px), and the portal node applies the value inline.
  const TOOLTIP_FONT_SIZE_PX = { large: 28, normal: 16 };

  function tooltipFontSizePx(value, fallback = TOOLTIP_FONT_SIZE_PX.large) {
    const px = TOOLTIP_FONT_SIZE_PX[normalizeTooltipMode(value, '')];
    return px === undefined ? fallback : px;
  }

  function getTodayDateString(d) {
    const now = d || new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /** Walks dotted path; returns undefined when a hop is missing. */
  function readProp(object, path) {
    let current = object;
    for (const part of String(path).split('.')) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  // Hard-disable cache key: bridge.js write must match comet.js read.
  const SETTINGS_CACHE_KEY = 'fb_diet_settings_cache';

  /** Opaque unit ids shown as short fingerprint. */
  function shortUnitId(id, fallback = '') {
    if (!id) return fallback;
    return id.length > 10 ? '…' + id.slice(-10) : id;
  }

  /** Whether the fb_diet_debug=1 query flag is set. */
  function isDebugUrl(search) {
    return /[?&]fb_diet_debug=1(?:&|$)/.test(typeof search === 'string' ? search : '');
  }

  // Section 5: feed UI labels

  // Injected UI strings; extension pages use src/i18n/i18n.js instead.
  const FEED_LABELS = {
    en: {
      stories: 'Stories',
      reels: 'Reels',
      suggestedGroup: 'Suggested Groups',
      collapseBar: 'Collapse'
    },
    'zh-TW': {
      stories: '限時動態（朋友）',
      reels: '連續短片',
      suggestedGroup: '推薦社團列表',
      collapseBar: '收合'
    },
    es: {
      stories: 'Historias',
      reels: 'Reels',
      suggestedGroup: 'Grupos sugeridos',
      collapseBar: 'Plegar'
    }
  };

  const FEED_LOCALE_FALLBACK = 'en';

  /** Mirrors FBDietI18N.normalize; tests/i18n.test.js pins agreement. */
  function normalizeLocale(code) {
    if (!code || typeof code !== 'string') return FEED_LOCALE_FALLBACK;
    const c = code.toLowerCase().replace('_', '-');
    if (FEED_LABELS[c]) return c;
    if (c.indexOf('zh') === 0) return 'zh-TW';
    // One language, several region tags: es-ES, es-MX and es-419 are all "es", not a fallback.
    if (c === 'es' || c.indexOf('es-') === 0) return 'es';
    return FEED_LOCALE_FALLBACK;
  }

  /** Locale priority: settings.lang (unless 'auto'), then page lang, then browser lang. */
  function resolveFeedLocale(settings, doc, nav) {
    const chosen = settings && settings.lang;
    if (chosen && chosen !== 'auto') return normalizeLocale(chosen);

    const codes = [
      (doc && doc.documentElement && doc.documentElement.lang) || '',
      (nav && nav.language) || ''
    ];
    for (const code of codes) {
      const locale = normalizeLocale(code);
      if (locale !== FEED_LOCALE_FALLBACK) return locale;
    }
    return FEED_LOCALE_FALLBACK;
  }

  /** Label for a feed surface in `locale`, or '' when unnamed. */
  function getFeedLabel(key, locale) {
    const table = FEED_LABELS[normalizeLocale(locale)];
    const value = table ? table[key] : undefined;
    if (value !== undefined) return value;
    const fallbackTable = FEED_LABELS[FEED_LOCALE_FALLBACK];
    return (fallbackTable && fallbackTable[key]) || '';
  }

  const EXTENSION_VERSION = '2.10.5';

  globalThis.FB_DIET_DEFAULTS = {
    SETTINGS: DEFAULT_SETTINGS,
    COUNTS: DEFAULT_COUNTS,
    DETECTION_MODES: DETECTION_MODES,
    DEFAULT_DETECTION_MODE: DEFAULT_DETECTION_MODE,
    GROUP_BY_CATEGORY,
    SETTING_KEYS_BY_GROUP,
    SETTING_BY_CATEGORY,
    GROUP_META,
    KEYWORDS,
    FEED_LABELS,
    RESERVED_PROFILE_SEGMENTS,
    VERSION: EXTENSION_VERSION,
    SETTINGS_CACHE_KEY,
    getTodayDateString,
    shortUnitId,
    isDebugUrl,
    normalizeFoldMode,
    normalizeTitleMode,
    normalizeTooltipMode,
    TOOLTIP_FONT_SIZE_PX,
    tooltipFontSizePx,
    normalizeDetectionMode,
    normalizeLocale,
    resolveFeedLocale,
    getFeedLabel,
    resolveBadgeText,
    CATEGORY_BADGE_TEXT,
    isFoldScopeAllowed,
    readProp
  };
})();
