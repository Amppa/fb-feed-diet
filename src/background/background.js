/**
 * FB Diet - Background Service Worker
 * Manages initial extension state, settings persistence, and count synchronization.
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  removeSponsored: true,
  removeSuggested: true,
  removeMarketAds: true,
  removeSearchingAds: true
};

const DEFAULT_COUNTS = {
  total: 0,
  sponsored: 0,
  suggested: 0,
  marketAds: 0,
  searchingAds: 0
};

// Initialize settings and counts on install/update
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['settings', 'counts']);

  if (!data.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  } else {
    // Ensure all keys exist in case of future updates
    const mergedSettings = { ...DEFAULT_SETTINGS, ...data.settings };
    await chrome.storage.local.set({ settings: mergedSettings });
  }

  if (!data.counts) {
    await chrome.storage.local.set({ counts: DEFAULT_COUNTS });
  }
});

// Handle incoming messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RESET_COUNTS') {
    chrome.storage.local.set({ counts: { ...DEFAULT_COUNTS } }, () => {
      sendResponse({ success: true, counts: DEFAULT_COUNTS });
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'GET_DATA') {
    chrome.storage.local.get(['settings', 'counts'], (data) => {
      sendResponse({
        settings: data.settings || DEFAULT_SETTINGS,
        counts: data.counts || DEFAULT_COUNTS
      });
    });
    return true;
  }
});
