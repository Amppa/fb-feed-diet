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
      labelRegular: 'Regular',
      sectionEngineMode: 'DETECTION ENGINE MODE',
      modeProxyTitle: 'Proxy Mode',
      modeRecommended: 'Recommended',
      modeProxyDesc: 'Direct React & Relay interceptor. Zero CPU overhead.',
      modeDomTitle: 'DOM Mode',
      modeDomDesc: 'Traditional MutationObserver text scanner. Scans on-screen text and attributes directly.',
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
      sectionFoldAppearance: 'Fold Appearance Settings',
      featAlwaysShowTitleTitle: 'Always Show Fold Bar',
      featAlwaysShowTitleDesc: 'Keep a top bar when posts are unfolded for identification and quick re-folding',
      featMinimizedFoldTitle: 'Minimized Fold Bar',
      featMinimizedFoldDesc: 'Use compact 18px bar instead of 36px title bar (switches 36/18pixel)',
      featProbeTitle: 'Show Feed Probe Buttons',
      featProbeDesc: 'Adds a copy-diagnostics button to every feed unit (debugging)',
      sectionDebug: 'DEBUG',
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
      sectionEngineMode: '偵測引擎模式',
      modeProxyTitle: '代理模式',
      modeRecommended: '推薦',
      modeProxyDesc: '直接攔截 React 與 Relay 資料。',
      modeDomTitle: 'DOM 模式',
      modeDomDesc: '傳統 MutationObserver 掃描畫面上的文字與屬性。偶爾 miss。',
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
      sectionFoldAppearance: '摺疊外觀設定',
      featAlwaysShowTitleTitle: '常駐顯示摺疊列',
      featAlwaysShowTitleDesc: '貼文展開或未摺疊時，頂端常駐保留橫條以供辨識及隨時再次摺疊',
      featMinimizedFoldTitle: '極簡摺疊列 (18px)',
      featMinimizedFoldDesc: '使用 18px 迷你列取代 36px 標題列（切換 36/18pixel）',
      featProbeTitle: '顯示 Feed 診斷按鈕',
      featProbeDesc: '在每則貼文旁顯示可複製診斷資訊的按鈕（除錯用）',
      sectionDebug: '除錯',
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