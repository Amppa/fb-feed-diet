/**
 * FB Diet - Background Service Worker
 * Manages initial extension state, settings persistence, and count synchronization.
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: 'proxy',
  removeSponsored: true,
  removeSuggested: true,
  removeSuggestedGroup: true,
  removeMarketAds: true,
  removeSearchingAds: true,
  removeStories: true,
  removeReels: true,
  // Section 2: Hide UI Buttons
  hideLeftMetaAI: false,
  hideLeftReels: false,
  hideLeftMemories: false,
  hideLeftSaved: false,
  hideLeftMarketplace: false,
  hideTopReels: false,
  hideTopMarketplace: false,
  hideTopGaming: false,
  hideRightSponsoredHeader: true
};

const FACEBOOK_URL_PATTERNS = ['*://*.facebook.com/*'];

const DEFAULT_COUNTS = {
  total: 0,
  sponsored: 0,
  suggested: 0,
  suggestedGroup: 0,
  marketAds: 0,
  searchingAds: 0,
  stories: 0,
  reels: 0
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

  pushSettingsToFacebookTabs();
});

/**
 * Pushes the current settings straight into the MAIN world of every open Facebook tab.
 *
 * MAIN world scripts have no chrome.* access, so this is the authoritative settings path.
 * The content script also forwards settings over postMessage, which covers tabs where the
 * extension was reloaded and the service worker injection is not needed.
 */
async function pushSettingsToFacebookTabs() {
  const data = await chrome.storage.local.get('settings');
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: FACEBOOK_URL_PATTERNS });
  } catch (e) {
    return;
  }

  for (const tab of tabs) {
    if (!tab || typeof tab.id !== 'number') continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: (payload) => {
          try {
            if (typeof window.__fbDietSetSettings === 'function') window.__fbDietSetSettings(payload);
          } catch (e) {
            // The page may be mid-navigation; the content script covers this case
          }
        },
        args: [settings]
      });
    } catch (e) {
      // Tab is on a chrome:// page, still loading, or the MAIN world script is not there yet
    }
  }
}

// Keep every open Facebook tab in sync when a switch changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) pushSettingsToFacebookTabs();
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
