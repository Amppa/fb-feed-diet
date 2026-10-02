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
    dietMode: 'relay',
    foldAds: true,
    foldRegular: false,
    foldSuggested: false,
    foldMedia: true,
    foldOther: true,
    minimizedFoldMode: false,
    alwaysShowFoldBar: true,
    showTitleMode: 'whenFolded',
    tooltipMode: 'native',
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
      // Exact-match only (see DOMSponsored.matchSponsoredText), so the short "ad" is safe here
      // while it would be catastrophic as a substring: "Brad" and "Address" are common.
      // "廣告"/"广告" are the zh forms; "広告" above is the Japanese one, not a substitute.
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
      // "你的社團建議" is what the live tray header actually reads (field report 2026-09-29). The
      // bare 社團建議 / 群组建议 forms are there because the same wording recurs in the tray's own
      // chrome — every card's dismiss control is aria-label="移除<社團>的社團建議" — so the substring
      // rule in dom-surface.js reads the fact off the chrome even when the header is not a heading.
      '你的社團建議', '社團建議', '你的群组建议', '群组建议'
    ],
    STORIES: ['stories', '限時動態', '限时动态', 'ストーリーズ', '스토리', 'storie'],
    // The singular "reel" matters as much as the plural: Facebook draws a "Reel" pill on a single
    // video, and dom-suggested.js reads KEYWORDS.REELS to tell that pill apart from a follow button.
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

  // First path segments that are Facebook routes rather than vanity handles. Shared by
  // both permalink producers (ui.js synthesis and relay-metadata.js username extraction) because
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

  // Detection modes name where the classifier gets its evidence, not how heavy the page is.
  // They are two parallel strategies with opposite failure modes, and neither is a subset of
  // the other: Relay survives a visual redesign, DOM survives a GraphQL schema change. Each
  // mode runs exactly one engine, so the question a mode answers is never "who outranks whom".
  //   relay      — the Relay store (and the free props) decide; no per-unit DOM scanning
  //   dom        — the mounted-DOM detectors are the sole authority (decision #40). Since
  //                decision #41 every category has a DOM rule of its own, so what this mode
  //                costs is confidence, not coverage: structure plus a rendered label is a
  //                different basis from a schema field, not a weaker kind of evidence, and a
  //                peer of `relay` rather than a diagnostic.
  const DETECTION_MODES = ['relay', 'dom'];
  const DEFAULT_DETECTION_MODE = 'relay';

  // Stored values that are no longer modes, from two renames and one retirement. A profile that
  // chose Lite must keep behaving as it did: 'lite' means no DOM scanning, which is exactly
  // 'relay'. 'relay+dom' was the 1.0 hybrid — the store decided everything the DOM was not
  // allowed to touch — and is retired in favour of 'relay', which is the half of it that
  // actually decided. Normalising on read (rather than rewriting storage on upgrade) means an
  // old profile and a freshly installed one converge on the same behaviour without a write.
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

  // Hover tooltip for the fold bar (the TitleBar `tooltipMode` prop): 'off' shows
  // nothing, 'native' keeps the browser title tooltip, 'custom' shows the large
  // portal popup. Unknown values fall back to the schema default.
  const VALID_TOOLTIP_MODES = new Set(['off', 'native', 'custom']);

  function normalizeTooltipMode(value, fallback = 'native') {
    return VALID_TOOLTIP_MODES.has(value) ? value : fallback;
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

  // The localStorage key the hard-disable read (comet.js) and the settings cache write
  // (bridge.js) must agree on. One definition: the two run at different times and in
  // different worlds, so a drift here is silent.
  const SETTINGS_CACHE_KEY = 'fb_diet_settings_cache';

  /**
   * Unit ids are opaque base64 blobs; show a short fingerprint instead. The fallback differs
   * per surface ('' in the log, '-' on a classify console line), so it is a parameter rather
   * than a constant.
   */
  function shortUnitId(id, fallback = '') {
    if (!id) return fallback;
    return id.length > 10 ? '…' + id.slice(-10) : id;
  }

  /** Whether the fb_diet_debug=1 query flag is set. The caller passes the query it owns. */
  function isDebugUrl(search) {
    return /[?&]fb_diet_debug=1(?:&|$)/.test(typeof search === 'string' ? search : '');
  }

  // ---------------------------------------------------------------------------
  // Section 5: feed UI labels
  // ---------------------------------------------------------------------------

  // The one place the *injected* UI gets its words. This file is the only module the MAIN world
  // and the extension pages already load in common (both content-script lists start with it), so
  // a label added here reaches both worlds without adding a request on facebook.com.
  //
  // The extension's own pages keep a separate dictionary in src/i18n/i18n.js. The split is
  // deliberate: that one carries the settings prose the feed never renders, and it is not
  // fetched on facebook.com at all. A string's home follows the surface that shows it.
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
    }
  };

  const FEED_LOCALE_FALLBACK = 'en';

  /**
   * Mirrors FBDietI18N.normalize: `zh*` collapses onto the one Chinese locale the project
   * ships, and a code naming anything else becomes the fallback. The two are separate
   * implementations on purpose — the pages' dictionary has to stay usable without this module —
   * and tests/i18n.test.js pins that they agree on every input, so the rule cannot drift unseen.
   */
  function normalizeLocale(code) {
    if (!code || typeof code !== 'string') return FEED_LOCALE_FALLBACK;
    const c = code.toLowerCase().replace('_', '-');
    if (FEED_LABELS[c]) return c;
    if (c.indexOf('zh') === 0) return 'zh-TW';
    return FEED_LOCALE_FALLBACK;
  }

  /**
   * The locale the injected UI renders in, from the most specific source down:
   *
   *   1. `settings.lang` — the language the user picked on the Options page. It is intent rather
   *      than a guess, so it wins outright, including when it says English.
   *   2. `documentElement.lang` — Facebook's own statement of the page language. The feed reads a
   *      page it does not control, and that attribute is not always present.
   *   3. `navigator.language` — the browser's UI language, for the renders where it is absent.
   *
   * The last two count as signals only when they name a locale the table has: a source that
   * normalises to the fallback says no more than a missing one, so an `en-US` page attribute must
   * not out-vote a Chinese browser.
   */
  function resolveFeedLocale(settings, doc, nav) {
    const chosen = settings && settings.lang;
    if (chosen) return normalizeLocale(chosen);

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

  /** The label for a feed surface in `locale`, or '' when the table has no name for it. */
  function getFeedLabel(key, locale) {
    const table = FEED_LABELS[normalizeLocale(locale)];
    const value = table ? table[key] : undefined;
    if (value !== undefined) return value;
    const fallbackTable = FEED_LABELS[FEED_LOCALE_FALLBACK];
    return (fallbackTable && fallbackTable[key]) || '';
  }

  const EXTENSION_VERSION = '2.9.4';

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
    normalizeDetectionMode,
    normalizeLocale,
    resolveFeedLocale,
    getFeedLabel,
    isFoldScopeAllowed,
    readProp
  };
})();
