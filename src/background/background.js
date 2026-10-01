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

/**
 * Fresh counter row for today. Every load path declares defaults.js first (the manifest
 * `scripts` array, the service worker's `importScripts`, and Firefox's `scripts` array), but the
 * two DEFAULT_* constants above deliberately fail open to `{}` — this must not be the one call
 * that throws, because a throw would leave the popup/options Reset button waiting for a
 * response that never arrives.
 */
function resetCounts() {
  const defaults = globalThis.FB_DIET_DEFAULTS;
  const date = defaults && typeof defaults.getTodayDateString === 'function'
    ? defaults.getTodayDateString()
    // Only reachable when defaults.js failed to load, where a UTC day boundary is acceptable.
    : new Date().toISOString().slice(0, 10);
  return { ...DEFAULT_COUNTS, date };
}

/**
 * Nothing readable from the page: a chrome:// tab, a mid-navigation frame, or a Facebook page
 * that the extension was never injected into. `present` is absent rather than false because the
 * distinction between "no answer" and "no FB Diet here" belongs to the page, not to the failure.
 */
const unavailable = { available: false };

/**
 * The version of the extension that is installed right now.
 *
 * `getManifest()` is the only live source: after an update or a manual reload the manifest is
 * the new one, while every tab that was already open keeps running the build that was injected
 * into it. Fails open to null — a version nobody can read must not invent a mismatch.
 */
function readInstalledVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    return manifest && typeof manifest.version === 'string' ? manifest.version : null;
  } catch (e) {
    return null;
  }
}

/**
 * Reads whether one tab can actually fold right now, and which build it is running.
 *
 * The master switch in chrome.storage is user *intent*; the __d hook in the MAIN world is the
 * *ability* to honour it. They diverge whenever the switch was turned on after the page loaded,
 * because the hook cannot retroactively intercept modules Facebook already defined. Only the page
 * knows its own hook state, so this reads it once per popup open. It is never polled: a repeated
 * cross-world read on a timer is how this extension once leaked gigabytes of RAM.
 *
 * `present` and `version` answer a different question from the hook state: whether the page is
 * running FB Diet at all, and which build. A tab that outlived an update reports the old version,
 * and a tab that was never injected reports nothing — both of which look exactly like a working
 * page from the outside, because the popup cannot fold anything either way.
 */
async function readTabHookState(tabId) {
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          const defaults = window.FB_DIET_DEFAULTS;
          // The build baked into this page. defaults.js is the first file the manifest injects,
          // so its presence is what says "the script list ran here at all".
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
      // Only a version on both sides can disagree. No live manifest, or no page build, is not a
      // mismatch: it is an absence of evidence, and this must never cry wolf.
      staleBuild: typeof result.version === 'string' && extensionVersion !== null && result.version !== extensionVersion
    });
  } catch (e) {
    // chrome:// page, mid-navigation, or the MAIN world script is not there yet
    return unavailable;
  }
}

// Handle incoming messages from the popup
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
