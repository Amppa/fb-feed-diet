/**
 * FB Diet - i18n core (en + zh-TW)
 *
 * Pure, dependency-free module that works in every world the extension runs in:
 *   - the options / popup pages (isolated window)
 *   - the isolated content scripts (content.js, detector.js)
 *   - the MAIN world scripts (fold.js)
 *
 * It owns no state beyond the dictionaries and the currently resolved language.
 * Callers that have their own language source (chrome.storage / settings.lang)
 * use setLang() explicitly; everywhere else detect() falls back on the browser UI.
 */
window.FBDietI18N = (() => {
  'use strict';

  const FALLBACK = 'en';

  const LOCALES = {
    en: {
      appName: 'FB Feed Diet',
      optionsTitle: 'FB Feed Diet Options',
      optionsSubtitle: 'Classify feeds and fold ads on your wall.',
      masterToggleTitle: 'Master Toggle',
      masterStatusActive: 'Active',
      masterStatusDisabled: 'Disabled',
      itemsFoldedOnDiet: 'Items Folded on Diet',
      todayFilteredPrefix: 'Filtered today:',
      dailyPostStatsDesc: 'Daily posts viewed & filtered',
      reset: 'Reset',
      resetOptionsTitle: 'Reset all counter stats',
      labelSponsored: 'Sponsored',
      labelSuggested: 'Suggested',
      labelGroups: 'Groups',
      labelMarket: 'Market',
      labelSearch: 'Search',
      labelStories: 'Stories',
      labelReels: 'Reels',
      sectionDietMode: 'OPERATION MODE',
      modeLiteTitle: 'Lite Mode',
      modeLiteDesc: 'Pure in-memory filter for Ads & Reels. Zero flash, minimal RAM.',
      modeFullTitle: 'Full Mode',
      modeFullDesc: 'Deep filtering with post author & snippet display on folded header.',
      modeOff: 'Unfold',
      modeTitle: 'Title',
      modeMini: 'Mini',
      sectionDietOptions: 'Feed Classifies',
      groupAdsTitle: 'Ads',
      groupAdsDesc: 'Fold sponsored posts, Marketplace & search ads',
      groupRegularTitle: 'Regular posts',
      groupRegularDesc: 'Posts from friends & people you follow',
      groupSuggestedTitle: 'Suggested by Facebook',
      groupSuggestedDesc: "Fold posts from people you don't follow",
      groupMediaTitle: 'Reels & Stories',
      groupMediaDesc: 'Fold Reels & Stories carousels',
      groupOtherTitle: 'Other',
      groupOtherDesc: 'Fold suggested groups to join, etc.',
      sectionFoldAppearance: 'Appearance Settings',
      featAlwaysShowBarTitle: 'Show Header on Expanded Posts',
      featAlwaysShowBarDesc: 'Shows a Header when posts are expanded or unfiltered so you can fold them; when off, posts have no Header and cannot be folded',
      featTitleModeTitle: 'Header Snippet Display',
      featTitleModeDesc: 'Set to hide snippet, always show snippet, or show only when folded',
      featTitleModeAlways: 'Always Show',
      featTitleModeWhenFolded: 'Only When Folded (Default)',
      featTitleModeNever: 'Always Hide',
      featMinimizedFoldTitle: 'Minimized Header (18px)',
      featMinimizedFoldDesc: 'Switch to 18px ultra-slim height (default is 36px)',
      featFoldScopeTitle: 'Only Filter on Home, Search & Marketplace',
      featFoldScopeDesc: 'Other pages remain untouched',
      featProbeTitle: 'Enable Feed Probe (Debug)',
      featProbeDesc: 'Add probe information button to every feed',
      resetAppearanceBtn: 'Defaults',
      resetAppearanceDesc: 'Reset appearance settings to defaults',
      projectUrlLabel: 'Project URL:',
      langToggleTitle: 'Switch language',
      popupSubtitle: 'Clean & fold Facebook feeds',
      optionsBtn: '⚙️ Options',
      resetPopupTitle: 'Reset counter'
    },
    'zh-TW': {
      appName: 'FB Feed Diet',
      optionsTitle: 'FB Feed Diet 設定',
      optionsSubtitle: '過濾facebook的廣告與推薦內容',
      masterToggleTitle: '總開關',
      masterStatusActive: '已啟用',
      masterStatusDisabled: '已停用',
      itemsFoldedOnDiet: '已過濾的內容數',
      todayFilteredPrefix: '今日已過濾:',
      dailyPostStatsDesc: '統計每日過濾的內容數',
      reset: '重設',
      resetOptionsTitle: '重設所有計數統計',
      labelSponsored: '贊助廣告',
      labelSuggested: '推薦貼文',
      labelGroups: '推薦社團文',
      labelMarket: '市集廣告',
      labelSearch: '搜尋廣告',
      labelStories: '限時動態',
      labelReels: '連續短片',
      labelRegular: '一般貼文',
      sectionDietMode: '運行模式',
      modeLiteTitle: 'Lite 模式',
      modeLiteDesc: '純記憶體攔截廣告與 Reels。0 閃爍、更省 RAM。',
      modeFullTitle: 'Full 模式',
      modeFullDesc: '深度過濾，折疊後 Header 可顯示作者與貼文。',
      modeOff: '展開',
      modeTitle: '標題',
      modeMini: '迷你',
      sectionDietOptions: '貼文分類',
      groupAdsTitle: '廣告',
      groupAdsDesc: '摺疊贊助貼文、Marketplace 與搜尋廣告',
      groupRegularTitle: '一般貼文',
      groupRegularDesc: '來自朋友與你追蹤對象的貼文',
      groupSuggestedTitle: 'Facebook 推薦',
      groupSuggestedDesc: '摺疊你不認識、還沒追蹤的貼文',
      groupMediaTitle: 'Reels 與限時動態',
      groupMediaDesc: '摺疊 Reels 與限時動態卡片列',
      groupOtherTitle: '其他',
      groupOtherDesc: '摺疊推薦加入的社團等',
      sectionFoldAppearance: '外觀設定',
      featAlwaysShowBarTitle: '展開的貼文是否顯示 Header',
      featAlwaysShowBarDesc: '貼文展開或未過濾時顯示 Header，可手動摺疊；關閉則無 Header 將無法手動摺疊',
      featTitleModeTitle: 'Header 顯示作者與摘要',
      featTitleModeDesc: '可設定隱藏摘要、必顯示摘要，或摺疊時才顯示',
      featTitleModeAlways: '永遠顯示',
      featTitleModeWhenFolded: '僅摺疊時顯示 (預設)',
      featTitleModeNever: '永遠隱藏',
      featMinimizedFoldTitle: '極簡 Header (18px)',
      featMinimizedFoldDesc: '切換為 18px 極簡高度（預設為 36px 舒適高度）',
      featFoldScopeTitle: '僅在首頁、搜尋頁與市集啟用過濾',
      featFoldScopeDesc: '其他頁面不摺疊。若關閉，則臉書全域都應用過濾器',
      featProbeTitle: '啟用 Feed 診斷（除錯）',
      featProbeDesc: '在每則貼文旁顯示診斷資訊',
      resetAppearanceBtn: '回復預設',
      resetAppearanceDesc: '將外觀設定回復為預設值',
      projectUrlLabel: '專案網址：',
      langToggleTitle: '切換語言',
      popupSubtitle: '動態牆瘦身清理',
      optionsBtn: '⚙️ 選項',
      resetPopupTitle: '重設計數器'
    }
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

  return {
    LOCALES,
    FALLBACK,
    detect,
    setLang,
    getLang,
    normalize,
    t
  };
})();