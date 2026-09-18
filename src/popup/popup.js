/**
 * FB Diet - Popup Controller
 * Minimal popup: master toggle, total count, and link to options page.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const masterToggle = document.getElementById('enabled');
  const totalCounter = document.getElementById('totalCount');
  const settingsBtn = document.getElementById('settingsBtn');

  // Load initial state
  const data = await chrome.storage.local.get(['settings', 'counts']);
  const settings = data.settings || {};
  const counts = data.counts || {};

  masterToggle.checked = settings.enabled !== false;
  totalCounter.textContent = (counts.total || 0).toLocaleString();

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
          totalCounter.textContent = (res.counts.total || 0).toLocaleString();
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
        totalCounter.textContent = (changes.counts.newValue.total || 0).toLocaleString();
      }
      if (changes.settings) {
        const s = changes.settings.newValue;
        if (s.enabled !== undefined && s.enabled !== masterToggle.checked) {
          masterToggle.checked = s.enabled;
        }
      }
    }
  });
});
