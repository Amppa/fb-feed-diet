/**
 * FB Diet - Popup Controller
 * Manages switch states, real-time count rendering, and reset action.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const masterToggle = document.getElementById('enabled');
  const featuresList = document.getElementById('featuresList');
  const resetBtn = document.getElementById('resetBtn');

  const switches = {
    removeSponsored: document.getElementById('removeSponsored'),
    removeSuggested: document.getElementById('removeSuggested'),
    removeMarketAds: document.getElementById('removeMarketAds'),
    removeSearchingAds: document.getElementById('removeSearchingAds')
  };

  const counters = {
    total: document.getElementById('totalCount'),
    sponsored: document.getElementById('sponsoredCount'),
    suggested: document.getElementById('suggestedCount'),
    marketAds: document.getElementById('marketCount'),
    searchingAds: document.getElementById('searchCount')
  };

  /**
   * Updates count numbers on the UI
   */
  function renderCounts(counts) {
    if (!counts) return;
    counters.total.textContent = (counts.total || 0).toLocaleString();
    counters.sponsored.textContent = (counts.sponsored || 0).toLocaleString();
    counters.suggested.textContent = (counts.suggested || 0).toLocaleString();
    counters.marketAds.textContent = (counts.marketAds || 0).toLocaleString();
    counters.searchingAds.textContent = (counts.searchingAds || 0).toLocaleString();
  }

  /**
   * Updates sub-switches visual state according to master switch
   */
  function updateFeaturesListState(isEnabled) {
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

  // Initialize switches
  masterToggle.checked = settings.enabled !== false;
  updateFeaturesListState(masterToggle.checked);

  for (const [key, checkbox] of Object.entries(switches)) {
    if (checkbox) {
      checkbox.checked = settings[key] !== false;
    }
  }

  // Initialize counts
  renderCounts(counts);

  // Handle Master Toggle change
  masterToggle.addEventListener('change', async () => {
    const isEnabled = masterToggle.checked;
    updateFeaturesListState(isEnabled);

    const { settings: current } = await chrome.storage.local.get('settings');
    const updated = { ...current, enabled: isEnabled };
    await chrome.storage.local.set({ settings: updated });
  });

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
        renderCounts({ total: 0, sponsored: 0, suggested: 0, marketAds: 0, searchingAds: 0 });
      }
    });
  });

  // Listen for storage changes from active content scripts in background
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.counts) {
        renderCounts(changes.counts.newValue);
      }
      if (changes.settings) {
        const s = changes.settings.newValue;
        if (s.enabled !== undefined && s.enabled !== masterToggle.checked) {
          masterToggle.checked = s.enabled;
          updateFeaturesListState(s.enabled);
        }
      }
    }
  });
});
