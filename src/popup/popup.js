/**
 * FB Diet - Popup Controller
 * Minimal popup: master toggle, total count, and link to options page.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const masterToggle = document.getElementById('enabled');
  const totalCounter = document.getElementById('totalCount');
  const settingsBtn = document.getElementById('settingsBtn');

  const i18n = window.FBDietI18N;

  // Apply all data-i18n / data-i18n-title texts for the active language.
  function applyTranslations() {
    if (!i18n) return;
    document.documentElement.lang = i18n.getLang();
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = i18n.t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = i18n.t(el.dataset.i18nTitle);
    });
  }

  const SHARED_DEFAULTS = globalThis.FB_DIET_DEFAULTS || {};

  // Load initial state
  const data = await chrome.storage.local.get(['settings', 'counts']);
  const settings = { ...(SHARED_DEFAULTS.SETTINGS || {}), ...(data.settings || {}) };
  const counts = { ...(SHARED_DEFAULTS.COUNTS || {}), ...(data.counts || {}) };

  if (i18n) i18n.setLang(settings.lang || i18n.detect());
  applyTranslations();

  masterToggle.checked = settings.enabled !== false;
  const initialFiltered = counts.filtered !== undefined ? counts.filtered : (counts.total || 0);
  totalCounter.textContent = initialFiltered.toLocaleString();

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

  // Handle Reset button
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'RESET_COUNTS' }, (res) => {
        if (res && res.counts) {
          const val = res.counts.filtered !== undefined ? res.counts.filtered : (res.counts.total || 0);
          totalCounter.textContent = val.toLocaleString();
        } else {
          totalCounter.textContent = '0';
        }
      });
    });
  }

  // Listen for live count updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.counts) {
        const c = changes.counts.newValue || {};
        const val = c.filtered !== undefined ? c.filtered : (c.total || 0);
        totalCounter.textContent = val.toLocaleString();
      }
      if (changes.settings) {
        const s = changes.settings.newValue;
        if (s.enabled !== undefined && s.enabled !== masterToggle.checked) {
          masterToggle.checked = s.enabled;
          renderHookStatus();
        }
        if (s.lang && i18n && s.lang !== i18n.getLang()) {
          i18n.setLang(s.lang);
          applyTranslations();
        }
      }
    }
  });
});
