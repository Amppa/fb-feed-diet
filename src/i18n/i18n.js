/**
 * FB Diet - i18n core (en + zh-TW)
 *
 * Dependency-free module holding the two dictionaries plus the one walk that writes them into a
 * page. It is loaded only by the extension's own pages — `options.html` and `popup.html` include
 * it with a <script> tag — because it is a classic script, not a module, and the MAIN world is
 * loaded through the manifest's flat script list instead. The feed pages have no UI of their own
 * to translate, so nothing there needs it.
 *
 * It owns no state beyond the dictionaries and the currently resolved language.
 * Callers that have their own language source (chrome.storage / settings.lang)
 * use setLang() explicitly; everywhere else detect() falls back on the browser UI.
 *
 * One caveat for tests: `applyTo` is the only DOM-aware part, and it takes the document as an
 * argument instead of reaching for a global. Nothing here may touch `document` at load time —
 * tests/ loads this file in a sandbox that has no document at all.
 */
window.FBDietI18N = (() => {
  'use strict';

  const FALLBACK = 'en';

  // Read by both pages, so they have exactly one copy to disagree over.
  const EN_COMMON = {
    masterToggleTitle: 'Master Toggle',
    reset: 'Reset'
  };

  const ZH_COMMON = {
    masterToggleTitle: '總開關',
    reset: '重設'
  };

  // popup.html only. The four status* strings are read through i18n.t() rather than a
  // data-i18n attribute, because the status line is filled in at runtime.
  const EN_POPUP = {
    itemsFoldedOnDiet: 'Items Folded on Diet',
    popupSubtitle: 'Clean & fold Facebook feeds',
    optionsBtn: '⚙️ Options',
    resetPopupTitle: 'Reset counter',
    directFeedBtn: 'Direct Feed ↗',
    directFeedTitle: 'Built-in Facebook feature, only shows your subscription and group posts',
    statusNeedsReload: 'Folding is not armed on this tab yet: reload it.',
    statusHookBlocked: 'Facebook blocked the module hook, please check F12.',
    statusVersionMismatch: 'This tab is running another build of the extension. Restart your browser to finish the update.',
    statusNotInjected: 'This tab was never hooked. Restart your browser, then reopen this tab.'
  };

  const ZH_POPUP = {
    itemsFoldedOnDiet: '已過濾的內容數',
    popupSubtitle: '動態牆瘦身清理',
    optionsBtn: '⚙️ 選項',
    resetPopupTitle: '重設計數器',
    directFeedBtn: '直連 動態消息 ↗',
    directFeedTitle: '官網內建，只會顯示你的訂閱和社團貼文',
    statusNeedsReload: '此分頁還沒掛上過濾器，請重新整理。',
    statusHookBlocked: '過濾器 hook 掛載失敗，可能 facebook 改版，或是有其他外掛搶占，請打開 F12 檢查錯誤訊息。',
    statusVersionMismatch: '此分頁正在執行另一個版本的外掛，請完全重啟瀏覽器以完成更新。',
    statusNotInjected: '此分頁從未掛上過濾器，請完全重啟瀏覽器後再重新開啟此分頁。'
  };

  // options.html only, in the order the page lays them out.
  const EN_OPTIONS = {
    optionsTitle: 'Feed Diet Options',
    optionsSubtitle: 'Diet on Facebook feeds: fold ads and recommendations.',
    masterStatusActive: 'Active',
    masterStatusDisabled: 'Disabled',
    todayFilteredPrefix: 'Filtered today:',
    dailyPostStatsDesc: 'Counters are not recalculated after changing settings; reset them manually',
    resetOptionsTitle: 'Reset all counter stats',
    featDetectionTitle: 'Detection Source',
    featDetectionDesc: 'Relay: reads Facebook input; DOM: scans the rendered page.',
    featDetectionRelay: 'Relay Only (Default)',
    featDetectionDomOnly: 'DOM Only',
    sectionDietOptions: 'Feed Classifies',
    groupAdsTitle: 'Ads',
    groupAdsDesc: 'Fold Sponsored posts, Marketplace ads, and Search ads',
    groupRegularTitle: 'Regular posts',
    groupRegularDesc: 'Posts from accounts you follow, friends, pages, or groups you joined',
    groupSuggestedTitle: 'Suggested by Facebook',
    groupSuggestedDesc: 'Fold unfamiliar posts, usually recommended by Facebook algorithms (users, pages, groups)',
    groupMediaTitle: 'Reels & Stories',
    groupMediaDesc: 'Fold Reels & Stories carousels (lists)',
    groupOtherTitle: 'Other',
    groupOtherDesc: 'e.g., Groups you might like carousels (lists)',
    sectionFoldAppearance: 'Appearance Settings',
    featAlwaysShowBarTitle: 'Show Header on Expanded Posts',
    featAlwaysShowBarDesc: 'Shows a Header when posts are expanded or unfiltered so you can fold a single post; when off, posts have no Header and cannot be folded',
    featTitleModeTitle: 'Header Snippet Display',
    featTitleModeDesc: 'Set to hide snippet, always show snippet, or show only when folded',
    featTitleModeAlways: 'Always Show',
    featTitleModeWhenFolded: 'Only When Folded (Default)',
    featTitleModeNever: 'Always Hide',
    featTooltipModeTitle: 'Show content on hover',
    featTooltipModeDesc: 'Choose whether hovering the header bar previews the full content',
    featTooltipModeOff: 'Don\'t show',
    featTooltipModeNative: 'Native (Default)',
    featTooltipModeCustom: 'Large',
    featMinimizedFoldTitle: 'Minimized Header (18px)',
    featMinimizedFoldDesc: 'Off: Comfortable height (36px). On: Minimized height (18px)',
    featFoldScopeTitle: 'Only Filter on Home, Search & Marketplace',
    featFoldScopeDesc: 'If disabled, filters apply across all Facebook pages',
    featProbeTitle: 'Enable Feed Probe (Debug)',
    featProbeDesc: 'Show a diagnostic button on the left of each post with Relay & DOM info',
    resetAppearanceBtn: 'Defaults',
    resetAppearanceDesc: 'Reset appearance settings to defaults',
    projectUrlLabel: 'Project URL:',
    langToggleTitle: 'Switch language'
  };

  const ZH_OPTIONS = {
    optionsTitle: 'Feed Diet 設定',
    optionsSubtitle: '臉書減肥: 對廣告與推薦內容縮短顯示',
    masterStatusActive: '已啟用',
    masterStatusDisabled: '已停用',
    todayFilteredPrefix: '今日已過濾:',
    dailyPostStatsDesc: '調整設定後不會重新計算，請手動重設。',
    resetOptionsTitle: '重設所有計數統計',
    featDetectionTitle: '貼文分類器 讀取來源',
    featDetectionDesc: 'Relay: 讀取 Facebook 輸入；DOM: 掃描已渲染的物件',
    featDetectionRelay: '僅 Relay（預設）',
    featDetectionDomOnly: '僅 DOM',
    sectionDietOptions: '貼文分類',
    groupAdsTitle: '廣告',
    groupAdsDesc: '摺疊 贊助貼文、Marketplace廣告、搜尋廣告',
    groupRegularTitle: '一般貼文',
    groupRegularDesc: '來自你的 追蹤對象／朋友／粉絲專頁／已加入社團 的一般貼文',
    groupSuggestedTitle: 'Facebook 推薦',
    groupSuggestedDesc: '摺疊陌生貼文，通常來自臉書演算法推薦的 用戶／粉絲專頁／社團',
    groupMediaTitle: 'Reels 與限時動態',
    groupMediaDesc: '摺疊 Reels 與限時動態卡片列(清單)',
    groupOtherTitle: '其他',
    groupOtherDesc: '例如: 你可能有興趣的社團(清單)',
    sectionFoldAppearance: '外觀設定',
    featAlwaysShowBarTitle: '展開的貼文是否顯示標題列',
    featAlwaysShowBarDesc: '貼文展開或未過濾時顯示標題列，可手動摺疊單一貼文；關閉則無標題列將無法手動摺疊',
    featTitleModeTitle: '標題列顯示作者與摘要',
    featTitleModeDesc: '可設定隱藏摘要、必顯示摘要，或摺疊時才顯示',
    featTitleModeAlways: '永遠顯示',
    featTitleModeWhenFolded: '僅摺疊時顯示 (預設)',
    featTitleModeNever: '永遠隱藏',
    featTooltipModeTitle: '滑鼠停留時顯示內容',
    featTooltipModeDesc: '設定滑鼠停留在標題列時，是否顯示完整內容',
    featTooltipModeOff: '不顯示',
    featTooltipModeNative: '原生 (預設)',
    featTooltipModeCustom: '大字',
    featMinimizedFoldTitle: '極簡標題列 (18px)',
    featMinimizedFoldDesc: '關閉：舒適高度(36px)。開啟：極簡高度(18px)',
    featFoldScopeTitle: '僅在首頁、搜尋頁與市集啟用過濾',
    featFoldScopeDesc: '若關閉，則臉書全域都應用過濾器',
    featProbeTitle: '啟用 Feed 診斷（除錯）',
    featProbeDesc: '在每則貼文左側顯示診斷按鈕，包含 Relay 和 DOM 資訊',
    resetAppearanceBtn: '回復預設',
    resetAppearanceDesc: '將外觀設定回復為預設值',
    projectUrlLabel: '專案網址：',
    langToggleTitle: '切換語言'
  };

  // The groups must stay disjoint: a key listed in two of them is silently overwritten by the
  // last spread, which is the one mistake this shape cannot report on itself. `tests/i18n.test.js`
  // pins the resulting key count for exactly that reason.
  const LOCALES = {
    en: { ...EN_COMMON, ...EN_POPUP, ...EN_OPTIONS },
    'zh-TW': { ...ZH_COMMON, ...ZH_POPUP, ...ZH_OPTIONS }
  };

  let current = detect();

  function normalize(code) {
    if (!code || typeof code !== 'string') return FALLBACK;
    const c = code.toLowerCase().replace('_', '-');
    if (LOCALES[c]) return c;
    if (c.indexOf('zh') === 0) return 'zh-TW';
    return FALLBACK;
  }

  function detect() {
    let lang = FALLBACK;
    try {
      if (typeof navigator !== 'undefined' && navigator.language) {
        lang = String(navigator.language);
      }
    } catch (e) {
      // navigator may be unavailable in some non-DOM contexts
    }
    return normalize(lang);
  }

  function setLang(code) {
    current = normalize(code);
    return current;
  }

  function getLang() {
    return current;
  }

  /**
   * Returns the translated string for key (in the given language or the module's
   * current language). Falls back to English and finally to the key itself.
   */
  function t(key, lang) {
    const dict = lang ? LOCALES[normalize(lang)] : null;
    const resolved = dict || LOCALES[current] || LOCALES[FALLBACK];
    if (resolved && key in resolved) return resolved[key];
    if (LOCALES[FALLBACK] && key in LOCALES[FALLBACK]) return LOCALES[FALLBACK][key];
    return key;
  }

  /**
   * Writes the active language into a document and returns. Both pages call this, so the
   * attribute contract lives here once instead of once per page:
   *
   *   data-i18n             -> textContent
   *   data-i18n-title       -> title
   *   data-i18n-placeholder -> placeholder
   *   data-i18n-aria        -> aria-label
   *
   * plus documentElement.lang, so assistive technology follows the UI's language. Page-local
   * work (a translated document.title, the language switch's active state, a dynamic status)
   * stays in the page that owns it.
   */
  function applyTo(doc) {
    const target = doc || (typeof document !== 'undefined' ? document : null);
    if (!target || typeof target.querySelectorAll !== 'function') return;
    try {
      if (target.documentElement) target.documentElement.lang = current;
      target.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.dataset.i18n);
      });
      target.querySelectorAll('[data-i18n-title]').forEach((el) => {
        el.title = t(el.dataset.i18nTitle);
      });
      target.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
      });
      target.querySelectorAll('[data-i18n-aria]').forEach((el) => {
        el.setAttribute('aria-label', t(el.dataset.i18nAria));
      });
    } catch (e) {
      // A page that cannot be walked keeps its static English attributes; never a thrown error
      // that would abort the caller's own initialization.
    }
  }

  return {
    LOCALES,
    FALLBACK,
    detect,
    setLang,
    getLang,
    normalize,
    t,
    applyTo
  };
})();