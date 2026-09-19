/**
 * FB Diet - Options Page Controller
 * Manages all feature switches, stat counters, and reset action.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const resetBtn = document.getElementById('resetBtn');
  const featuresList = document.getElementById('featuresList');
  const masterToggle = document.getElementById('enabled');
  const masterStatus = document.getElementById('masterStatus');
  const modeProxy = document.getElementById('modeProxy');
  const modeDom = document.getElementById('modeDom');

  const DEFAULTS = {
    removeSponsored: true,
    removeSuggested: true,
    removeSuggestedGroup: true,
    removeStories: true,
    removeReels: true,
    removeMarketAds: true,
    removeSearchingAds: true
  };

  const switches = {};
  document.querySelectorAll('#featuresList input[type="checkbox"]').forEach(input => {
    if (input.id) switches[input.id] = input;
  });

  const counters = {
    total: document.getElementById('totalCount'),
    sponsored: document.getElementById('sponsoredCount'),
    suggested: document.getElementById('suggestedCount'),
    suggestedGroup: document.getElementById('suggestedGroupCount'),
    marketAds: document.getElementById('marketCount'),
    searchingAds: document.getElementById('searchCount'),
    stories: document.getElementById('storiesCount'),
    reels: document.getElementById('reelsCount')
  };

  function renderCounts(counts) {
    if (!counts) return;
    counters.total.textContent = (counts.total || 0).toLocaleString();
    counters.sponsored.textContent = (counts.sponsored || 0).toLocaleString();
    counters.suggested.textContent = (counts.suggested || 0).toLocaleString();
    counters.suggestedGroup.textContent = (counts.suggestedGroup || 0).toLocaleString();
    counters.marketAds.textContent = (counts.marketAds || 0).toLocaleString();
    counters.searchingAds.textContent = (counts.searchingAds || 0).toLocaleString();
    if (counters.stories) counters.stories.textContent = (counts.stories || 0).toLocaleString();
    if (counters.reels) counters.reels.textContent = (counts.reels || 0).toLocaleString();
  }

  function updateMasterUI(isEnabled) {
    if (masterToggle) masterToggle.checked = isEnabled;
    if (masterStatus) masterStatus.textContent = isEnabled ? 'Active' : 'Disabled';
    if (isEnabled) {
      featuresList.classList.remove('disabled');
    } else {
      featuresList.classList.add('disabled');
    }
  }

  function updateModeUI(mode) {
    if (mode === 'dom') {
      if (modeDom) modeDom.checked = true;
    } else {
      if (modeProxy) modeProxy.checked = true;
    }
  }

  // Load initial settings and counts
  const data = await chrome.storage.local.get(['settings', 'counts']);
  const settings = data.settings || {};
  const counts = data.counts || {};

  // Initialize master switch, mode & feature switches
  updateMasterUI(settings.enabled !== false);
  updateModeUI(settings.mode || 'proxy');

  for (const [key, checkbox] of Object.entries(switches)) {
    if (checkbox) {
      const defaultValue = DEFAULTS[key] ?? true;
      checkbox.checked = settings[key] !== undefined ? settings[key] : defaultValue;
    }
  }

  // Initialize counts
  renderCounts(counts);

  // Handle Master toggle
  if (masterToggle) {
    masterToggle.addEventListener('change', async () => {
      const active = masterToggle.checked;
      updateMasterUI(active);
      const { settings: current } = await chrome.storage.local.get('settings');
      const updated = { ...current, enabled: active };
      await chrome.storage.local.set({ settings: updated });
    });
  }

  // Handle Engine Mode toggle
  async function handleModeSelect(selectedMode) {
    const { settings: current } = await chrome.storage.local.get('settings');
    const updated = { ...current, mode: selectedMode };
    await chrome.storage.local.set({ settings: updated });
  }

  if (modeProxy) {
    modeProxy.addEventListener('change', () => {
      if (modeProxy.checked) handleModeSelect('proxy');
    });
  }
  if (modeDom) {
    modeDom.addEventListener('change', () => {
      if (modeDom.checked) handleModeSelect('dom');
    });
  }

  // Handle Sub-switches changes
  for (const [key, checkbox] of Object.entries(switches)) {
    if (checkbox) {
      checkbox.addEventListener('change', async () => {
        const { settings: current } = await chrome.storage.local.get('settings');
        const updated = { ...current, [key]: checkbox.checked };
        await chrome.storage.local.set({ settings: updated });
      });
    }
  }

  // Handle Reset button
  resetBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_COUNTS' }, (res) => {
      if (res && res.counts) {
        renderCounts(res.counts);
      } else {
        renderCounts({ total: 0, sponsored: 0, suggested: 0, suggestedGroup: 0, marketAds: 0, searchingAds: 0, stories: 0, reels: 0 });
      }
    });
  });

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.counts) {
        renderCounts(changes.counts.newValue);
      }
      if (changes.settings) {
        const s = changes.settings.newValue;
        if (s) {
          if (s.enabled !== undefined) updateMasterUI(s.enabled !== false);
          if (s.mode) updateModeUI(s.mode);
        }
      }
    }
  });
});
