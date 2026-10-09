/**
 * FB Diet - Popup Controller
 * Minimal popup: master toggle, total count, and link to options page.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const masterToggle = document.getElementById('enabled');
  const totalCounter = document.getElementById('totalCount');
  const filteredCounter = document.getElementById('filteredCount');
  const settingsBtn = document.getElementById('settingsBtn');

  const i18n = window.FBDietI18N;

  // The dictionary module owns the attribute contract; this page has nothing to add to it.
  function applyTranslations() {
    if (!i18n) return;
    i18n.applyTo(document);
  }

  function resolveEffectiveTheme(mode, detectedFb) {
    if (mode === 'light') return 'light';
    if (mode === 'dark') return 'dark';
    if (detectedFb === 'light' || detectedFb === 'dark') return detectedFb;
    const isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDark ? 'dark' : 'light';
  }

  function resolveEffectiveLang(mode) {
    if (mode && mode !== 'auto') {
      return i18n ? i18n.normalize(mode) : mode;
    }
    return i18n ? i18n.detect() : 'en';
  }

  function applyTheme(theme) {
    if (typeof document !== 'undefined' && document.documentElement && typeof document.documentElement.setAttribute === 'function') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  const SHARED_DEFAULTS = globalThis.FB_DIET_DEFAULTS || {};

  // Load initial state
  const data = await chrome.storage.local.get(['settings', 'counts', 'detectedFbTheme']);
  const settings = { ...(SHARED_DEFAULTS.SETTINGS || {}), ...(data.settings || {}) };
  const counts = { ...(SHARED_DEFAULTS.COUNTS || {}), ...(data.counts || {}) };
  let detectedFbTheme = data.detectedFbTheme;

  // Fallback to system color scheme if Facebook theme has not been detected yet
  if (!detectedFbTheme) {
    const isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    detectedFbTheme = isDark ? 'dark' : 'light';
    chrome.storage.local.set({ detectedFbTheme }).catch(() => {});
  }
  applyTheme(resolveEffectiveTheme(settings.themeMode, detectedFbTheme));

  if (i18n) i18n.setLang(resolveEffectiveLang(settings.lang));
  applyTranslations();

  // Version footer reads the single source of truth (bump-version keeps it
  // level with manifest.json); guarded so the test double without it stays quiet.
  const extVersion = document.getElementById('extVersion');
  if (extVersion && SHARED_DEFAULTS.VERSION) {
    extVersion.textContent = 'v' + SHARED_DEFAULTS.VERSION;
  }

  masterToggle.checked = settings.enabled !== false;

  // Stat headline is the filtered/total pair (今日總覽：已過濾／總貼文數),
  // styled like the options stat row: gradient filtered, plain total.
  function renderStat(counts) {
    const c = counts || {};
    const filtered = c.filtered !== undefined ? c.filtered : (c.total || 0);
    const total = c.total || 0;
    if (filteredCounter) filteredCounter.textContent = filtered.toLocaleString();
    totalCounter.textContent = total.toLocaleString();
  }
  renderStat(counts);

  // The toggle is user intent; the page hook is the ability to act on it. A tab that loaded
  // while the extension was off never armed the hook, so folding stays inactive there even
  // though intent now says on. Healthy pages show nothing at all.
  const statusLine = document.getElementById('statusLine');
  let tabHookState = null;

  /**
   * One status line, four facts it can report, in the order the user has to act on them.
   *
   * The first two are about *which build the page is running* and are shown even when the toggle
   * is off, because both keep lying after the user turns folding on: a tab that survived an
   * update runs code the installed build no longer has, and a tab that was never injected has no
   * code to turn anything on. The last two are about the hook, and there intent is the gate.
   */
  function renderHookStatus() {
    if (!tabHookState) return;
    const state = tabHookState;

    if (state.staleBuild) {
      statusLine.textContent = i18n.t('statusVersionMismatch') + ' (' + state.version + ' → ' + state.extensionVersion + ')';
      statusLine.classList.add('error');
      statusLine.hidden = false;
      return;
    }

    // A facebook.com tab with no FB Diet code in it at all used to be reported as silence, on the
    // grounds that a missing answer is not a broken extension. On this tab it is the opposite:
    // the page was never injected, so nothing folds and the popup looks perfectly healthy.
    if (state.present === false) {
      if (!masterToggle.checked) {
        statusLine.hidden = true;
        return;
      }
      statusLine.textContent = i18n.t('statusNotInjected');
      statusLine.classList.add('error');
      statusLine.hidden = false;
      return;
    }

    if (!masterToggle.checked || state.hookActive) {
      statusLine.hidden = true;
      return;
    }

    statusLine.textContent = i18n.t(state.installFailed ? 'statusHookBlocked' : 'statusNeedsReload');
    statusLine.classList.toggle('error', Boolean(state.installFailed));
    statusLine.hidden = false;
  }

  function readHookState() {
    if (!i18n) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      // Without a Facebook tab there is no page to ask, and a missing answer must never be
      // reported as a broken extension.
      if (!tab || typeof tab.id !== 'number' || !/^https?:\/\/([\w-]+\.)*facebook\.com\//.test(tab.url || '')) return;
      chrome.runtime.sendMessage({ type: 'GET_TAB_STATE', tabId: tab.id }, (state) => {
        if (chrome.runtime.lastError) return;
        if (!state) return;
        tabHookState = state;
        renderHookStatus();
      });
    });
  }

  readHookState();

  // Handle Master Toggle
  masterToggle.addEventListener('change', async () => {
    const { settings: current } = await chrome.storage.local.get('settings');
    const updated = { ...current, enabled: masterToggle.checked };
    await chrome.storage.local.set({ settings: updated });
    renderHookStatus();
  });

  // Open Options page
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Open Facebook's built-in chronological feed in a new tab.
  const feedBtn = document.getElementById('feedBtn');
  if (feedBtn) {
    feedBtn.addEventListener('click', () => {
      const url = 'https://www.facebook.com/?filter=all&sk=h_chr';
      if (chrome && chrome.tabs && typeof chrome.tabs.create === 'function') {
        chrome.tabs.create({ url });
      } else {
        window.open(url, '_blank');
      }
    });
  }

  // Handle Reset button
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'RESET_COUNTS' }, (res) => {
        renderStat(res && res.counts ? res.counts : null);
      });
    });
  }

  // Listen for live updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.detectedFbTheme) {
        detectedFbTheme = changes.detectedFbTheme.newValue;
        applyTheme(resolveEffectiveTheme(settings.themeMode, detectedFbTheme));
      }
      if (changes.counts) {
        renderStat(changes.counts.newValue);
      }
      if (changes.settings) {
        const s = changes.settings.newValue;
        if (s) {
          if (s.themeMode !== undefined) {
            settings.themeMode = s.themeMode;
            applyTheme(resolveEffectiveTheme(s.themeMode, detectedFbTheme));
          }
          if (s.enabled !== undefined && s.enabled !== masterToggle.checked) {
            masterToggle.checked = s.enabled;
            renderHookStatus();
          }
          if (s.lang !== undefined && i18n) {
            settings.lang = s.lang;
            const effective = resolveEffectiveLang(s.lang);
            if (effective !== i18n.getLang()) {
              i18n.setLang(effective);
              applyTranslations();
            }
          }
        }
      }
    }
  });

  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
      if (settings.themeMode === 'auto') {
        const fallback = e.matches ? 'dark' : 'light';
        applyTheme(resolveEffectiveTheme('auto', detectedFbTheme || fallback));
      }
    });
  }
});
