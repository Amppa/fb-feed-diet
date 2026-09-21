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

  // Handle Master Toggle
  masterToggle.addEventListener('change', async () => {
    const { settings: current } = await chrome.storage.local.get('settings');
    const updated = { ...current, enabled: masterToggle.checked };
    await chrome.storage.local.set({ settings: updated });
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
        }
        if (s.lang && i18n && s.lang !== i18n.getLang()) {
          i18n.setLang(s.lang);
          applyTranslations();
        }
      }
    }
  });
});
