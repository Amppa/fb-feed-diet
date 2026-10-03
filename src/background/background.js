/** FB Diet - Background Service Worker: settings + counts sync. */

try {
  importScripts('../shared/defaults.js');
} catch (e) {
  // Ignore in environments where importScripts is not available
}

const DEFAULT_SETTINGS = (globalThis.FB_DIET_DEFAULTS && globalThis.FB_DIET_DEFAULTS.SETTINGS) || {};

const FACEBOOK_URL_PATTERNS = ['*://*.facebook.com/*'];

const DEFAULT_COUNTS = (globalThis.FB_DIET_DEFAULTS && globalThis.FB_DIET_DEFAULTS.COUNTS) || {};

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['settings', 'counts']);
  const mergedSettings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});

  await chrome.storage.local.set({
    settings: mergedSettings,
    counts: data.counts || DEFAULT_COUNTS
  });

  pushSettingsToFacebookTabs(mergedSettings);
});

/** Fan-out settings to MAIN world of every Facebook tab (authoritative path). */
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) pushSettingsToFacebookTabs(changes.settings.newValue);
});

/** Fresh counter row for today; never throws (Reset button waits on it). */
function resetCounts() {
  const defaults = globalThis.FB_DIET_DEFAULTS;
  const date = defaults && typeof defaults.getTodayDateString === 'function'
    ? defaults.getTodayDateString()
    // Only reachable when defaults.js failed to load, where a UTC day boundary is acceptable.
    : new Date().toISOString().slice(0, 10);
  return { ...DEFAULT_COUNTS, date };
}

/** No answer from page (chrome://, mid-navigation, never injected). */
const unavailable = { available: false };

/** Installed version via getManifest(); fails open to null. */
function readInstalledVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    return manifest && typeof manifest.version === 'string' ? manifest.version : null;
  } catch (e) {
    return null;
  }
}

/**
 * Read one tab's hook state + build. Once per popup open, never polled
 * (repeated cross-world reads leaked RAM).
 */
async function readTabHookState(tabId) {
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          const defaults = window.FB_DIET_DEFAULTS;
          // defaults.js first in manifest; presence proves injection ran.
          const version = defaults && typeof defaults.VERSION === 'string' ? defaults.VERSION : null;
          const comet = window.FBDietComet;
          if (!comet || typeof comet.getModuleHealth !== 'function') {
            return { present: version !== null || Boolean(window.FBDietComet), version: version, available: false };
          }
          const errors = typeof comet.getErrors === 'function' ? comet.getErrors() : [];
          return {
            present: true,
            version: version,
            available: true,
            hookActive: comet.getModuleHealth().hookActive === true,
            installFailed: errors.some((entry) => entry && entry.context === 'installDDHook')
          };
        } catch (e) {
          return { available: false };
        }
      }
    });
    const result = injection && injection[0] ? injection[0].result : null;
    if (!result) return unavailable;
    const extensionVersion = readInstalledVersion();
    return Object.assign({}, result, {
      extensionVersion: extensionVersion,
      // Absence of evidence is not a mismatch.
      staleBuild: typeof result.version === 'string' && extensionVersion !== null && result.version !== extensionVersion
    });
  } catch (e) {
    return unavailable;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TAB_STATE') {
    (async () => {
      const tabId = typeof message.tabId === 'number' ? message.tabId : null;
      sendResponse(tabId === null ? { available: false } : await readTabHookState(tabId));
    })();
    return true;
  }

  if (message.type === 'RESET_COUNTS') {
    const fresh = resetCounts();
    chrome.storage.local.set({ counts: fresh }, () => {
      sendResponse({ success: true, counts: fresh });
    });
    return true; // Keep message channel open for async response
  }
});
