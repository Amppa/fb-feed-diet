/**
 * FB Diet - i18n core (en + zh-TW)
 *
 * Pure, dependency-free module. It is loaded only by the extension's own pages — `options.html`
 * and `popup.html` include it with a <script> tag — because it is a classic script, not a module,
 * and the MAIN world is loaded through the manifest's flat script list instead. The feed pages
 * have no UI of their own to translate, so nothing there needs it.
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
      optionsTitle: 'Feed Diet Options',
      optionsSubtitle: 'Diet on Facebook feeds: fold ads and recommendations.',
      masterToggleTitle: 'Master Toggle',
      masterStatusActive: 'Active',
      masterStatusDisabled: 'Disabled',
      itemsFoldedOnDiet: 'Items Folded on Diet',
      todayFilteredPrefix: 'Filtered today:',
      dailyPostStatsDesc: 'Counters are not recalculated after changing settings; reset them manually',
      reset: 'Reset',
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
      featMinimizedFoldTitle: 'Minimized Header (18px)',
      featMinimizedFoldDesc: 'Off: Comfortable height (36px). On: Minimized height (18px)',
      featFoldScopeTitle: 'Only Filter on Home, Search & Marketplace',
      featFoldScopeDesc: 'If disabled, filters apply across all Facebook pages',
      featProbeTitle: 'Enable Feed Probe (Debug)',
      featProbeDesc: 'Show a diagnostic button on the left of each post with Relay & DOM info',
      resetAppearanceBtn: 'Defaults',
      resetAppearanceDesc: 'Reset appearance settings to defaults',
      projectUrlLabel: 'Project URL:',
      langToggleTitle: 'Switch language',
      popupSubtitle: 'Clean & fold Facebook feeds',
      optionsBtn: '⚙️ Options',
      resetPopupTitle: 'Reset counter',
      statusNeedsReload: 'Folding is not armed on this tab yet: reload it.',
      statusHookBlocked: 'Facebook blocked the module hook, please check F12.',
      statusVersionMismatch: 'This tab is running another build of the extension. Restart your browser to finish the update.',
      statusNotInjected: 'This tab was never hooked. Restart your browser, then reopen this tab.'
    },
    'zh-TW': {
      optionsTitle: 'Feed Diet 設定',
      optionsSubtitle: '臉書減肥: 對廣告與推薦內容縮短顯示',
      masterToggleTitle: '總開關',
      masterStatusActive: '已啟用',
      masterStatusDisabled: '已停用',
      itemsFoldedOnDiet: '已過濾的內容數',
      todayFilteredPrefix: '今日已過濾:',
      dailyPostStatsDesc: '調整設定後不會重新計算，請手動重設。',
      reset: '重設',
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
      featMinimizedFoldTitle: '極簡標題列 (18px)',
      featMinimizedFoldDesc: '關閉：舒適高度(36px)。開啟：極簡高度(18px)',
      featFoldScopeTitle: '僅在首頁、搜尋頁與市集啟用過濾',
      featFoldScopeDesc: '若關閉，則臉書全域都應用過濾器',
      featProbeTitle: '啟用 Feed 診斷（除錯）',
      featProbeDesc: '在每則貼文左側顯示診斷按鈕，包含 Relay 和 DOM 資訊',
      resetAppearanceBtn: '回復預設',
      resetAppearanceDesc: '將外觀設定回復為預設值',
      projectUrlLabel: '專案網址：',
      langToggleTitle: '切換語言',
      popupSubtitle: '動態牆瘦身清理',
      optionsBtn: '⚙️ 選項',
      resetPopupTitle: '重設計數器',
      statusNeedsReload: '此分頁還沒掛上過濾器，請重新整理。',
      statusHookBlocked: '過濾器 hook 掛載失敗，可能 facebook 改版，或是有其他外掛搶占，請打開 F12 檢查錯誤訊息。',
      statusVersionMismatch: '此分頁正在執行另一個版本的外掛，請完全重啟瀏覽器以完成更新。',
      statusNotInjected: '此分頁從未掛上過濾器，請完全重啟瀏覽器後再重新開啟此分頁。'
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