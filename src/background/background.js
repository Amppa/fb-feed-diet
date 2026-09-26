/**
 * FB Diet - Background Service Worker
 * Manages initial extension state, settings persistence, and count synchronization.
 */

try {
  importScripts('../shared/defaults.js');
} catch (e) {
  // Ignore in environments where importScripts is not available
}

const DEFAULT_SETTINGS = (globalThis.FB_DIET_DEFAULTS && globalThis.FB_DIET_DEFAULTS.SETTINGS) || {};

const FACEBOOK_URL_PATTERNS = ['*://*.facebook.com/*'];

const DEFAULT_COUNTS = (globalThis.FB_DIET_DEFAULTS && globalThis.FB_DIET_DEFAULTS.COUNTS) || {};

// Initialize settings and counts on install/update
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['settings', 'counts']);
  const mergedSettings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});

  await chrome.storage.local.set({
    settings: mergedSettings,
    counts: data.counts || DEFAULT_COUNTS
  });

  pushSettingsToFacebookTabs(mergedSettings);
});

/**
 * Pushes the current settings straight into the MAIN world of every open Facebook tab.
 *
 * MAIN world scripts have no chrome.* access, so this is the authoritative settings path.
 * The content script independently observes the same storage write and forwards it over
 * postMessage, which covers tabs where the extension was reloaded and service worker
 * injection is not available. One storage write therefore triggers exactly one fan-out.
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
    } catch (e) {
      // Tab is on a chrome:// page, still loading, or the MAIN world script is not there yet
    }
  }
}

// Keep every open Facebook tab in sync when a switch changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) pushSettingsToFacebookTabs(changes.settings.newValue);
});

// Handle incoming messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RESET_COUNTS') {
    const fresh = { ...DEFAULT_COUNTS, date: globalThis.FB_DIET_DEFAULTS.getTodayDateString() };
    chrome.storage.local.set({ counts: fresh }, () => {
      sendResponse({ success: true, counts: fresh });
    });
    return true; // Keep message channel open for async response
  }
});
