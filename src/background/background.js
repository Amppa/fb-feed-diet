/**
 * FB Diet - Background Service Worker
 * Manages initial extension state, settings persistence, and count synchronization.
 */

try {
  importScripts('../shared/defaults.js');
} catch (e) {
  // Ignore in environments where importScripts is not available
}

const DEFAULT_SETTINGS = (globalThis.FB_DIET_DEFAULTS && globalThis.FB_DIET_DEFAULTS.SETTINGS) || {
  enabled: true,
  mode: 'proxy',
  foldSponsored: true,
  foldSuggested: true,
  foldSuggestedGroup: true,
  foldMarketAds: true,
  foldSearchingAds: true,
  foldStories: true,
  foldReels: true,
  foldRegular: false,
  minimizedFoldMode: false,
  alwaysShowFoldBar: true,
  showFeedTitle: true,
  restrictFoldScope: true,
  debugProbe: false
};

const FACEBOOK_URL_PATTERNS = ['*://*.facebook.com/*'];

function getTodayString() {
  if (globalThis.FB_DIET_DEFAULTS && typeof globalThis.FB_DIET_DEFAULTS.getTodayDateString === 'function') {
    return globalThis.FB_DIET_DEFAULTS.getTodayDateString();
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DEFAULT_COUNTS = (globalThis.FB_DIET_DEFAULTS && globalThis.FB_DIET_DEFAULTS.COUNTS) || {
  date: getTodayString(),
  total: 0,
  filtered: 0,
  sponsored: 0,
  suggested: 0,
  suggestedGroup: 0,
  marketAds: 0,
  searchingAds: 0,
  stories: 0,
  reels: 0,
  regular: 0
};

// Initialize settings and counts on install/update
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['settings', 'counts']);

  if (!data.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  } else {
    // Migrate legacy key alwaysShowFoldTitle -> alwaysShowFoldBar if present
    const raw = data.settings;
    if (raw.alwaysShowFoldBar === undefined && raw.alwaysShowFoldTitle !== undefined) {
      raw.alwaysShowFoldBar = raw.alwaysShowFoldTitle;
    }
    // Ensure all keys exist in case of future updates
    const mergedSettings = { ...DEFAULT_SETTINGS, ...raw };
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
async function pushSettingsToFacebookTabs(providedSettings) {
  let settings = providedSettings;
  if (!settings) {
    const data = await chrome.storage.local.get('settings');
    settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  }

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: FACEBOOK_URL_PATTERNS });
  } catch (e) {
    return;
  }

  for (const tab of tabs) {
    if (!tab || typeof tab.id !== 'number') continue;
    try {
      chrome.scripting.executeScript({
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
      }).catch(() => {});

      chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED', settings }).catch(() => {});
    } catch (e) {
      // Tab is on a chrome:// page, still loading, or the MAIN world script is not there yet
    }
  }
}

// Keep every open Facebook tab in sync when a switch changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) pushSettingsToFacebookTabs(changes.settings.newValue);
});

// Handle incoming messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PUSH_SETTINGS') {
    pushSettingsToFacebookTabs(message.settings);
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'RESET_COUNTS') {
    const fresh = { ...DEFAULT_COUNTS, date: getTodayString() };
    chrome.storage.local.set({ counts: fresh }, () => {
      sendResponse({ success: true, counts: fresh });
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
