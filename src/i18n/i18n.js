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
      sectionDietMode: 'OPERATION MODE',
      modeLiteTitle: 'Lite Mode',
      modeLiteDesc: 'Lightweight mode: does not scan feed content, shows category badges only, uses less memory. Cannot distinguish regular posts from suggested posts.',
      modeFullTitle: 'Full Mode',
      modeFullDesc: 'Full mode: full deep filtering; the header can preview the group name, author, and snippet.',
      modeOff: 'Unfold',
      modeTitle: 'Title',
      modeMini: 'Mini',
      sectionDietOptions: 'Feed Classifies',
      groupAdsTitle: 'Ads',
      groupAdsDesc: 'Fold Sponsored posts, Marketplace ads, and Search ads',
      groupRegularTitle: 'Regular posts',
      groupRegularDesc: 'Fold posts from your friends, followed accounts, or joined groups',
      groupSuggestedTitle: 'Suggested by Facebook',
      groupSuggestedDesc: 'Fold unfamiliar posts recommended by Facebook algorithms (users, pages, groups)',
      groupMediaTitle: 'Reels & Stories',
      groupMediaDesc: 'Fold Reels & Stories carousels (lists)',
      groupOtherTitle: 'Other',
      groupOtherDesc: 'e.g., Groups you might like carousels (lists)',
      sectionFoldAppearance: 'Appearance Settings',
      featAlwaysShowBarTitle: 'Show Header on Expanded Posts',
      featAlwaysShowBarDesc: 'Shows a Header when posts are expanded or unfiltered so you can fold them; when off, posts have no Header and cannot be folded',
      featTitleModeTitle: 'Header Snippet Display',
      featTitleModeDesc: 'Set to hide snippet, always show snippet, or show only when folded',
      featTitleModeAlways: 'Always Show',
      featTitleModeWhenFolded: 'Only When Folded (Default)',
      featTitleModeNever: 'Always Hide',
      featMinimizedFoldTitle: 'Minimized Header (18px)',
      featMinimizedFoldDesc: 'Off: Comfortable height (36px). On: Minimized height (18px)',
      featFoldScopeTitle: 'Only Filter on Home, Search & Marketplace',
      featFoldScopeDesc: 'If disabled, filters apply across all Facebook pages',
      featProbeTitle: 'Enable Feed Probe (Debug)',
      featProbeDesc: 'Show a diagnostic button on the left of each post with proxy & DOM info',
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
      sectionDietMode: '運行模式',
      modeLiteTitle: 'Lite 模式',
      modeLiteDesc: '輕量模式：不掃描feed內容，只顯示分類標籤，較省記憶體。無法分辨一般貼文與陌生貼文。',
      modeFullTitle: 'Full 模式',
      modeFullDesc: '完整模式：完整深度過濾，header可預覽社團名稱、作者與摘要。',
      modeOff: '展開',
      modeTitle: '標題',
      modeMini: '迷你',
      sectionDietOptions: '貼文分類',
      groupAdsTitle: '廣告',
      groupAdsDesc: '摺疊 贊助貼文、Marketplace廣告、搜尋廣告',
      groupRegularTitle: '一般貼文',
      groupRegularDesc: '摺疊貼文，來自你的 朋友／追蹤對象／已加入社團',
      groupSuggestedTitle: 'Facebook 推薦',
      groupSuggestedDesc: '摺疊陌生貼文，來自臉書演算法推薦的 用戶／粉絲團／社團',
      groupMediaTitle: 'Reels 與限時動態',
      groupMediaDesc: '摺疊 Reels 與限時動態卡片列(清單)',
      groupOtherTitle: '其他',
      groupOtherDesc: '例如: 建議你可能有興趣的社團(清單)',
      sectionFoldAppearance: '外觀設定',
      featAlwaysShowBarTitle: '展開的貼文是否顯示 Header',
      featAlwaysShowBarDesc: '貼文展開或未過濾時顯示 Header，可手動摺疊；關閉則無 Header 將無法手動摺疊',
      featTitleModeTitle: 'Header 顯示作者與摘要',
      featTitleModeDesc: '可設定隱藏摘要、必顯示摘要，或摺疊時才顯示',
      featTitleModeAlways: '永遠顯示',
      featTitleModeWhenFolded: '僅摺疊時顯示 (預設)',
      featTitleModeNever: '永遠隱藏',
      featMinimizedFoldTitle: '極簡 Header (18px)',
      featMinimizedFoldDesc: '關閉：舒適高度(36px)。開啟：極簡高度(18px)',
      featFoldScopeTitle: '僅在首頁、搜尋頁與市集啟用過濾',
      featFoldScopeDesc: '若關閉，則臉書全域都應用過濾器',
      featProbeTitle: '啟用 Feed 診斷（除錯）',
      featProbeDesc: '在每則貼文左側顯示診斷按鈕，包含proxy和DOM資訊',
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