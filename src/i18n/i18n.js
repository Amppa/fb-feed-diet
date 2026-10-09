/**
 * FB Diet - i18n core (en + zh-TW + es)
 *
 * Dependency-free module holding the dictionaries plus the one walk that writes them into a
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

  const ES_COMMON = {
    masterToggleTitle: 'Interruptor principal',
    reset: 'Restablecer'
  };

  // popup.html only. The four status* strings are read through i18n.t() rather than a
  // data-i18n attribute, because the status line is filled in at runtime.
  const EN_POPUP = {
    popupOverview: 'Today\'s overview (filtered/total)',
    popupSubtitle: 'Clean & fold Facebook feeds',
    optionsBtn: '⚙️ Options',
    resetPopupTitle: 'Reset counter',
    directFeedBtn: 'Direct to Feed ↗',
    directFeedSub: '(no suggest post from stranger)',
    directFeedTitle: 'Built-in Facebook feature, only shows your subscription and group posts, not ad-free',
    statusNeedsReload: 'Folding is not armed on this tab yet: reload it.',
    statusHookBlocked: 'Facebook blocked the module hook, please check F12.',
    statusVersionMismatch: 'This tab is running another build of the extension. Restart your browser to finish the update.',
    statusNotInjected: 'This tab was never hooked. Restart your browser, then reopen this tab.'
  };

  const ZH_POPUP = {
    popupOverview: '今日總覽（已過濾／總貼文數）',
    popupSubtitle: '動態牆瘦身清理',
    optionsBtn: '⚙️ 選項',
    resetPopupTitle: '重設計數器',
    directFeedBtn: '動態消息 ↗',
    directFeedSub: '(僅顯示你訂閱，無陌生人推薦貼文)',
    directFeedTitle: '官網內建，只會顯示你的訂閱和社團貼文，但有廣告',
    statusNeedsReload: '此分頁還沒掛上過濾器，請重新整理。',
    statusHookBlocked: '過濾器 hook 掛載失敗，可能 facebook 改版，或是有其他外掛搶占，請打開 F12 檢查錯誤訊息。',
    statusVersionMismatch: '此分頁正在執行另一個版本的外掛，請完全重啟瀏覽器以完成更新。',
    statusNotInjected: '此分頁從未掛上過濾器，請完全重啟瀏覽器後再重新開啟此分頁。'
  };

  const ES_POPUP = {
    popupOverview: 'Resumen de hoy (filtradas/total)',
    popupSubtitle: 'Limpia y pliega los feeds de Facebook',
    optionsBtn: '⚙️ Opciones',
    resetPopupTitle: 'Restablecer contador',
    directFeedBtn: 'Feed cronológico ↗',
    directFeedSub: '(sin publicaciones sugeridas de desconocidos)',
    directFeedTitle: 'Función integrada de Facebook: solo muestra las publicaciones de tus páginas y grupos, pero con anuncios',
    statusNeedsReload: 'El plegado todavía no está activo en esta pestaña: recárgala.',
    statusHookBlocked: 'Facebook bloqueó el enganche del módulo; revisa la consola con F12.',
    statusVersionMismatch: 'Esta pestaña está ejecutando otra versión de la extensión. Reinicia el navegador por completo para terminar la actualización.',
    statusNotInjected: 'Esta pestaña nunca fue enganchada. Reinicia el navegador por completo y vuelve a abrirla.'
  };

  // options.html only, in the order the page lays them out.
  const EN_OPTIONS = {
    optionsTitle: 'Feed Diet Options',
    optionsSubtitle: 'Diet on Facebook feeds: get rid of ads or reels.',
    masterStatusActive: 'Active',
    masterStatusDisabled: 'Disabled',
    statReceivedPrefix: 'Today\'s overview:',
    statFilteredShort: 'Filtered',
    statEmpty: 'No data yet',
    dailyPostStatsDesc: 'Counters are not recalculated after changing settings; manual reset is recommended',
    resetOptionsTitle: 'Reset all counter stats',
    featDetectionTitle: 'Detection Source',
    featDetectionDesc: 'Relay: reads Facebook input (saves CPU); DOM: scans rendered elements.',
    featDetectionRelay: 'Relay (Default)',
    featDetectionDomOnly: 'DOM',
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
    sectionClassifierSettings: 'Classifier Settings',
    featTitleModeTitle: 'Header Bar Content',
    featTitleModeDesc: 'Similar to a forum "post title"',
    featTitleModeAlways: 'Always Show',
    featTitleModeWhenFolded: 'Only When Folded (Default)',
    featTitleModeNever: 'Always Hide',
    featTooltipModeTitle: 'Show full content on hover',
    featTooltipModeDesc: 'Hover over the header bar to pop up full text preview',
    featTooltipModeOff: 'Don\'t show',
    featTooltipModeLarge: 'Large (28px) (Default)',
    featTooltipModeNormal: 'Normal (16px)',
    featMinimizedFoldTitle: 'Header Height',
    featMinimizedFoldDesc: '',
    featFoldHeight18: 'Compact (18px) (Default)',
    featFoldHeight36: 'Comfortable (36px)',
    featFoldScopeTitle: 'Filter Scope',
    featFoldScopeDesc: 'Choose which Facebook pages the filters apply to',
    featFoldScopeScoped: 'Home, Search & Marketplace only (Default)',
    featFoldScopeAll: 'All Facebook pages',
    featThemeModeTitle: 'Theme',
    featThemeModeDesc: 'Choose light, dark, or automatic theme',
    themeModeAuto: 'Auto (Default)',
    themeModeLight: 'Light',
    themeModeDark: 'Dark',
    featLangTitle: 'Language',
    featLangDesc: 'Choose the display language for options and menus',
    featLangAuto: 'Auto (Default)',
    featLangEn: 'English',
    featLangZhTw: '繁體中文',
    featLangEs: 'Español',
    featProbeTitle: 'Enable Feed Probe (Debug)',
    featProbeDesc: 'Show a diagnostic button on the left of each post header bar',
    resetAppearanceBtn: 'Defaults',
    resetAppearanceDesc: 'Reset appearance settings to defaults',
    projectUrlLabel: 'Project URL:',
    langToggleTitle: 'Switch language'
  };

  const ZH_OPTIONS = {
    optionsTitle: 'Feed Diet 設定',
    optionsSubtitle: '臉書減肥: 擺脫廣告與短影音',
    masterStatusActive: '已啟用',
    masterStatusDisabled: '已停用',
    statReceivedPrefix: '今日總覽：',
    statFilteredShort: '已過濾',
    statEmpty: '尚無資料',
    dailyPostStatsDesc: '調整設定後建議手動重設。',
    resetOptionsTitle: '重設所有計數統計',
    featDetectionTitle: '貼文分類器 讀取來源',
    featDetectionDesc: 'Relay: 讀取 Facebook 輸入，較省CPU；DOM: 掃描已渲染的物件。',
    featDetectionRelay: 'Relay（預設）',
    featDetectionDomOnly: 'DOM',
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
    sectionClassifierSettings: '分類器設定',
    featTitleModeTitle: '標題列顯示內容',
    featTitleModeDesc: '類似網路論壇的"文章標題"',
    featTitleModeAlways: '永遠顯示',
    featTitleModeWhenFolded: '僅摺疊時顯示 (預設)',
    featTitleModeNever: '永遠隱藏',
    featTooltipModeTitle: '滑鼠旋停時顯示完整內容',
    featTooltipModeDesc: '滑鼠在標題列時，跳出浮動視窗，顯示全部文字',
    featTooltipModeOff: '不顯示',
    featTooltipModeLarge: '加大 (28px)（預設）',
    featTooltipModeNormal: '一般 (16px)',
    featMinimizedFoldTitle: '標題列高度',
    featMinimizedFoldDesc: '',
    featFoldHeight18: '極簡 (18px)（預設）',
    featFoldHeight36: '舒適 (36px)',
    featFoldScopeTitle: '過濾範圍',
    featFoldScopeDesc: '設定過濾器要作用的頁面',
    featFoldScopeScoped: '僅首頁、搜尋頁與市集 (預設)',
    featFoldScopeAll: 'Facebook 全站',
    featThemeModeTitle: '主題顏色',
    featThemeModeDesc: '選擇淺色、深色或自動跟隨主題',
    themeModeAuto: '自動（預設）',
    themeModeLight: '淺色',
    themeModeDark: '深色',
    featLangTitle: '介面語言',
    featLangDesc: '選擇選項與選單的顯示語言',
    featLangAuto: '自動（預設）',
    featLangEn: 'English',
    featLangZhTw: '繁體中文',
    featLangEs: 'Español',
    featProbeTitle: '啟用 Feed 診斷（除錯）',
    featProbeDesc: '在每則貼文標題列左側，顯示診斷按鈕',
    resetAppearanceBtn: '回復預設',
    resetAppearanceDesc: '將外觀設定回復為預設值',
    projectUrlLabel: '專案網址：',
    langToggleTitle: '切換語言'
  };

  const ES_OPTIONS = {
    optionsTitle: 'Feed Diet Opciones',
    optionsSubtitle: 'Ponte a dieta con los feeds de Facebook: deshazte de anuncios y reels.',
    masterStatusActive: 'Activo',
    masterStatusDisabled: 'Desactivado',
    statReceivedPrefix: 'Resumen de hoy:',
    statFilteredShort: 'Filtradas',
    statEmpty: 'Todavía no hay datos',
    dailyPostStatsDesc: 'Los contadores no se recalculan al cambiar los ajustes; conviene restablecerlos a mano',
    resetOptionsTitle: 'Restablecer todas las estadísticas',
    featDetectionTitle: 'Fuente de detección',
    featDetectionDesc: 'Relay: lee la entrada de Facebook (ahorra CPU); DOM: escanea los elementos ya renderizados.',
    featDetectionRelay: 'Relay (predeterminado)',
    featDetectionDomOnly: 'DOM',
    sectionDietOptions: 'Clasificación del feed',
    groupAdsTitle: 'Anuncios',
    groupAdsDesc: 'Plegar publicaciones patrocinadas, anuncios de Marketplace y anuncios de búsqueda',
    groupRegularTitle: 'Publicaciones normales',
    groupRegularDesc: 'Publicaciones de cuentas que sigues, de amigos, páginas o grupos a los que te uniste',
    groupSuggestedTitle: 'Sugeridas por Facebook',
    groupSuggestedDesc: 'Plegar publicaciones de desconocidos, normalmente recomendadas por los algoritmos de Facebook (usuarios, páginas, grupos)',
    groupMediaTitle: 'Reels e Historias',
    groupMediaDesc: 'Plegar los carruseles (listas) de Reels e Historias',
    groupOtherTitle: 'Otros',
    groupOtherDesc: 'p. ej., carruseles (listas) de grupos que podrían interesarte',
    sectionFoldAppearance: 'Ajustes de apariencia',
    sectionClassifierSettings: 'Ajustes del clasificador',
    featTitleModeTitle: 'Contenido de la barra de título',
    featTitleModeDesc: 'Como el "título de publicación" de un foro',
    featTitleModeAlways: 'Mostrar siempre',
    featTitleModeWhenFolded: 'Solo cuando está plegado (predeterminado)',
    featTitleModeNever: 'Ocultar siempre',
    featTooltipModeTitle: 'Mostrar el contenido completo al pasar el cursor',
    featTooltipModeDesc: 'Al pasar el cursor por la barra de título aparece una vista previa con todo el texto',
    featTooltipModeOff: 'No mostrar',
    featTooltipModeLarge: 'Grande (28px) (predeterminado)',
    featTooltipModeNormal: 'Normal (16px)',
    featMinimizedFoldTitle: 'Altura de la barra',
    featMinimizedFoldDesc: '',
    featFoldHeight18: 'Compacta (18px) (predeterminado)',
    featFoldHeight36: 'Cómoda (36px)',
    featFoldScopeTitle: 'Ámbito del filtro',
    featFoldScopeDesc: 'Elige en qué páginas de Facebook se aplican los filtros',
    featFoldScopeScoped: 'Solo Inicio, Búsqueda y Marketplace (predeterminado)',
    featFoldScopeAll: 'Todas las páginas de Facebook',
    featThemeModeTitle: 'Tema',
    featThemeModeDesc: 'Elige el tema claro, oscuro o automático',
    themeModeAuto: 'Automático (predeterminado)',
    themeModeLight: 'Claro',
    themeModeDark: 'Oscuro',
    featLangTitle: 'Idioma',
    featLangDesc: 'Elige el idioma de la interfaz de opciones y menús',
    featLangAuto: 'Automático (predeterminado)',
    featLangEn: 'English',
    featLangZhTw: '繁體中文',
    featLangEs: 'Español',
    featProbeTitle: 'Activar Feed Probe (depuración)',
    featProbeDesc: 'Mostrar un botón de diagnóstico a la izquierda de la barra de título de cada publicación',
    resetAppearanceBtn: 'Predeterminados',
    resetAppearanceDesc: 'Restablecer los ajustes de apariencia a los valores predeterminados',
    projectUrlLabel: 'URL del proyecto:',
    langToggleTitle: 'Cambiar idioma'
  };

  // The groups must stay disjoint: a key listed in two of them is silently overwritten by the
  // last spread, which is the one mistake this shape cannot report on itself. `tests/i18n.test.js`
  // pins the resulting key count for exactly that reason.
  const LOCALES = {
    en: { ...EN_COMMON, ...EN_POPUP, ...EN_OPTIONS },
    'zh-TW': { ...ZH_COMMON, ...ZH_POPUP, ...ZH_OPTIONS },
    es: { ...ES_COMMON, ...ES_POPUP, ...ES_OPTIONS }
  };

  let current = detect();

  function normalize(code) {
    if (!code || typeof code !== 'string') return FALLBACK;
    const c = code.toLowerCase().replace('_', '-');
    if (LOCALES[c]) return c;
    if (c.indexOf('zh') === 0) return 'zh-TW';
    // One language, several region tags: es-ES, es-MX and es-419 are all "es", not a fallback.
    if (c === 'es' || c.indexOf('es-') === 0) return 'es';
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