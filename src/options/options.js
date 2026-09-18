/**
 * FB Diet - Options Page Controller
 * Manages all feature switches, stat counters, and reset action.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const resetBtn = document.getElementById('resetBtn');
  const featuresList = document.getElementById('featuresList');
  const masterToggle = document.getElementById('enabled');
  const masterStatus = document.getElementById('masterStatus');

  const switches = {
    removeSponsored: document.getElementById('removeSponsored'),
    removeSuggested: document.getElementById('removeSuggested'),
    removeSuggestedGroup: document.getElementById('removeSuggestedGroup'),
    removeStories: document.getElementById('removeStories'),
    removeReels: document.getElementById('removeReels'),
    removeMarketAds: document.getElementById('removeMarketAds'),
    removeSearchingAds: document.getElementById('removeSearchingAds')
  };

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

  // Load initial settings and counts
  const data = await chrome.storage.local.get(['settings', 'counts']);
  const settings = data.settings || {};
  const counts = data.counts || {};

  // Initialize master switch & feature switches
  updateMasterUI(settings.enabled !== false);

  for (const [key, checkbox] of Object.entries(switches)) {
    if (checkbox) {
      checkbox.checked = settings[key] !== false;
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
        if (s && s.enabled !== undefined) {
          updateMasterUI(s.enabled !== false);
        }
      }
    }
  });
});
