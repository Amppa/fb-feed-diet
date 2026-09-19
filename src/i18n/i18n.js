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
      appName: 'FB Diet',
      optionsTitle: 'FB Diet Options',
      optionsSubtitle: 'Configure your feed diet preferences',
      masterToggleTitle: 'Master Toggle',
      masterStatusActive: 'Active',
      masterStatusDisabled: 'Disabled',
      itemsFoldedOnDiet: 'Items Folded on Diet',
      reset: 'Reset',
      resetOptionsTitle: 'Reset all counter stats',
      labelSponsored: 'Sponsored',
      labelSuggested: 'Suggested',
      labelGroups: 'Groups',
      labelMarket: 'Market',
      labelSearch: 'Search',
      labelStories: 'Stories',
      labelReels: 'Reels',
      sectionEngineMode: 'DETECTION ENGINE MODE',
      modeProxyTitle: 'Proxy Mode',
      modeRecommended: 'Recommended',
      modeProxyDesc: 'Direct React & Relay interceptor. Zero CPU overhead.',
      modeDomTitle: 'DOM Mode',
      modeDomDesc: 'Traditional MutationObserver text scanner. Scans on-screen text and attributes directly.',
      sectionDietOptions: 'DIET OPTIONS',
      featSponsoredTitle: 'Remove Sponsored',
      featSponsoredDesc: 'Fold sponsored ads & sidebar promos',
      featSuggestedTitle: 'Remove Suggested Posts',
      featSuggestedDesc: 'Fold recommended posts, pages & people',
      featSuggestedGroupTitle: 'Remove Suggested Groups',
      featSuggestedGroupDesc: 'Fold recommended groups & community suggestions',
      featStoriesTitle: 'Remove Stories',
      featStoriesDesc: 'Fold stories tray & top feed story tiles',
      featReelsTitle: 'Remove Reels',
      featReelsDesc: 'Fold reels feed units, trays & video recommendations',
      featMarketAdsTitle: 'Remove Market Ads',
      featMarketAdsDesc: 'Fold sponsored items in Marketplace',
      featSearchingAdsTitle: 'Remove Searching Ads',
      featSearchingAdsDesc: 'Fold ad results in search page',
      langToggleTitle: 'Switch language',
      popupSubtitle: 'Feed Declutter & Diet',
      optionsBtn: '⚙️ Options',
      resetPopupTitle: 'Reset counter'
    },
    'zh-TW': {
      appName: 'FB Diet',
      optionsTitle: 'FB Diet 設定',
      optionsSubtitle: '設定你的動態牆「減肥」偏好',
      masterToggleTitle: '總開關',
      masterStatusActive: '已啟用',
      masterStatusDisabled: '已停用',
      itemsFoldedOnDiet: '已摺疊的內容數',
      reset: '重設',
      resetOptionsTitle: '重設所有計數統計',
      labelSponsored: '贊助內容',
      labelSuggested: '推薦貼文',
      labelGroups: '社團',
      labelMarket: '市集',
      labelSearch: '搜尋',
      labelStories: '限時動態',
      labelReels: '連續短片',
      sectionEngineMode: '偵測引擎模式',
      modeProxyTitle: '代理模式',
      modeRecommended: '推薦',
      modeProxyDesc: '直接攔截 React 與 Relay 資料，CPU 零負擔。',
      modeDomTitle: 'DOM 模式',
      modeDomDesc: '傳統 MutationObserver 文字掃描器，直接掃描畫面上的文字與屬性。',
      sectionDietOptions: '減肥選項',
      featSponsoredTitle: '移除贊助貼文',
      featSponsoredDesc: '摺疊贊助廣告與側欄促銷',
      featSuggestedTitle: '移除推薦貼文',
      featSuggestedDesc: '摺疊推薦貼文、粉絲專頁與人物',
      featSuggestedGroupTitle: '移除推薦社團',
      featSuggestedGroupDesc: '摺疊推薦社團與社群建議',
      featStoriesTitle: '移除限時動態',
      featStoriesDesc: '摺疊限時動態列與頂部動態磚',
      featReelsTitle: '移除連續短片',
      featReelsDesc: '摺疊連續短片單元、橫列與影片推薦',
      featMarketAdsTitle: '移除市集廣告',
      featMarketAdsDesc: '摺疊 Marketplace 中的贊助商品',
      featSearchingAdsTitle: '移除搜尋廣告',
      featSearchingAdsDesc: '摺疊搜尋頁面的廣告結果',
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