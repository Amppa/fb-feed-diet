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
      sectionDietOptions: 'DIET OPTIONS',
      featSponsoredTitle: 'Fold Sponsored Posts',
      featSponsoredDesc: 'Fold sponsored ads & sidebar promos',
      featSuggestedTitle: 'Fold Suggested Posts',
      featSuggestedDesc: 'Fold recommended posts, pages & people',
      featSuggestedGroupTitle: 'Fold Suggested Groups',
      featSuggestedGroupDesc: 'Fold recommended groups & community suggestions',
      featStoriesTitle: 'Fold Stories',
      featStoriesDesc: 'Fold stories tray & top feed story tiles',
      featReelsTitle: 'Fold Reels',
      featReelsDesc: 'Fold reels feed units, trays & video recommendations',
      featMarketAdsTitle: 'Fold Marketplace Ads',
      featMarketAdsDesc: 'Fold sponsored items in Marketplace',
      featSearchingAdsTitle: 'Fold Search Ads',
      featSearchingAdsDesc: 'Fold ad results in search page',
      featProbeTitle: 'Show Feed Probe Buttons',
      featProbeDesc: 'Adds a copy-diagnostics button to every feed unit (debugging)',
      sectionDebug: 'DEBUG',
      probeAnalyzerTitle: 'Analyze a copied probe report',
      probeAnalyzerDesc: 'Paste the JSON copied with a feed 🔍 button, then run the classifier on it.',
      probeInputPlaceholder: '{"at": "...", "classify": {...}, "payload": {...}}',
      probeRunBtn: 'Analyze',
      probeCapturedLabel: 'Captured classification',
      probeCurrentLabel: 'Re-run with current rules',
      probeModuleLabel: 'Module',
      probeNoteSnapshotLimited: 'The snapshot holds only the first record, so linked Relay records are unavailable and the re-run may be incomplete (known limitation).',
      probeErrorNotJson: 'This is not valid JSON. Copy the full report with the 🔍 button and paste it here.',
      probeErrorMissingClassify: 'This JSON does not look like a probe report: the "classify" field is missing.',
      probeErrorMissingPayload: 'This probe report has no "payload", so the classifier cannot re-run it.',
      probeErrorGeneric: 'Could not analyze this report.',
      probeErrorNoClassifier: 'Classifier module failed to load. Reload this page and try again.',
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
      sectionDietOptions: '過濾選項',
      featSponsoredTitle: '摺疊贊助貼文',
      featSponsoredDesc: '摺疊贊助廣告與側欄促銷',
      featSuggestedTitle: '摺疊推薦貼文',
      featSuggestedDesc: '由演算法推薦，來自陌生人的貼文、陌生粉絲專業的內容',
      featSuggestedGroupTitle: '摺疊推薦社團文',
      featSuggestedGroupDesc: '摺疊由演算法推薦的未加入社團與社群貼文',
      featStoriesTitle: '摺疊限時動態',
      featStoriesDesc: '摺疊限時動態列與頂部動態磚',
      featReelsTitle: '摺疊連續短片',
      featReelsDesc: '摺疊連續短片單元、橫列與影片推薦',
      featMarketAdsTitle: '摺疊市集廣告',
      featMarketAdsDesc: '摺疊 Marketplace 中的贊助商品',
      featSearchingAdsTitle: '摺疊搜尋廣告',
      featSearchingAdsDesc: '摺疊搜尋頁面的廣告結果',
      featProbeTitle: '顯示 Feed 診斷按鈕',
      featProbeDesc: '在每則貼文旁顯示可複製診斷資訊的按鈕（除錯用）',
      sectionDebug: '除錯',
      probeAnalyzerTitle: '分析複製的診斷報告',
      probeAnalyzerDesc: '貼上用 🔍 按鈕複製的 JSON，然後用分類器重新判斷。',
      probeInputPlaceholder: '{"at": "...", "classify": {...}, "payload": {...}}',
      probeRunBtn: '判斷',
      probeCapturedLabel: '當時的分類結果',
      probeCurrentLabel: '以目前規則重跑',
      probeModuleLabel: '元件模組',
      probeNoteSnapshotLimited: '快照只包含第一筆記錄，無法讀取連結的 Relay 記錄，重跑結果可能不完整（已知限制）。',
      probeErrorNotJson: '這不是合法的 JSON。請用 🔍 按鈕複製完整報告後再貼上。',
      probeErrorMissingClassify: '這段 JSON 看起來不是診斷報告：缺少 "classify" 欄位。',
      probeErrorMissingPayload: '這份診斷報告沒有 "payload"，分類器無法重跑。',
      probeErrorGeneric: '無法分析這份報告。',
      probeErrorNoClassifier: '分類器模組載入失敗，請重新整理本頁再試。',
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