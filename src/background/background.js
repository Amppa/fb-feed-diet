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
  // A freshly installed build makes every already-open Facebook tab stale; that is exactly the
  // state the red marker exists for, so the badges are re-labelled here rather than on next load.
  updateFacebookBadges();
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
  if (area === 'local' && changes.settings) {
    pushSettingsToFacebookTabs(changes.settings.newValue);
    // Tabs that are already open would otherwise keep claiming the extension is on until the
    // user reloads them, which is the one moment the badge has to be right.
    updateFacebookBadges();
  }
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
          const health = comet.getModuleHealth();
          const fused = (health && Array.isArray(health.fused)) ? health.fused : [];
          return {
            present: true,
            version: version,
            available: true,
            hookActive: health && health.hookActive === true,
            installFailed: errors.some((entry) => entry && entry.context === 'installDDHook'),
            fusedCount: fused.length,
            fused: fused
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

/** Writes one tab's badge. Empty text clears the icon; a closed tab is never worth a rejection. */
async function setTabBadge(tabId, text, color) {
  if (typeof tabId !== 'number' || !chrome.action) return;
  try {
    await chrome.action.setBadgeText({ tabId, text: text || '' });
    if (color) await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch (e) {}
}

/**
 * Resolves one tab's badge: two signals only - `off` while the master switch is off, `!` when our
 * code is missing from the page, failed to install, or disagrees with the installed version.
 * Anything else, including a Facebook page we simply do not fold, clears it.
 */
async function updateTabBadge(tabId, tabUrl) {
  try {
    // No url is not a verdict about Facebook: keep the icon this tab already has.
    if (typeof tabId !== 'number' || typeof tabUrl !== 'string' || !chrome.action) return;
    const defaults = globalThis.FB_DIET_DEFAULTS;
    if (!defaults || typeof defaults.resolveActionBadge !== 'function') return;

    if (typeof defaults.isFacebookUrl === 'function' && !defaults.isFacebookUrl(tabUrl)) {
      await setTabBadge(tabId, '', '');
      return;
    }

    const data = await chrome.storage.local.get('settings');
    const settings = { ...DEFAULT_SETTINGS, ...(data && data.settings ? data.settings : {}) };
    // The switch-off answer needs nothing from the page, so no tab is injected to give it.
    const state = settings.enabled === false ? null : await readTabHookState(tabId);
    const badge = defaults.resolveActionBadge(state, settings, tabUrl);
    await setTabBadge(tabId, badge.text, badge.color);
  } catch (e) {
    // Fail open: a badge we cannot compute must never become a page problem.
  }
}

/** Re-labels every open Facebook tab. */
async function updateFacebookBadges() {
  if (!chrome.tabs || typeof chrome.tabs.query !== 'function') return;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: FACEBOOK_URL_PATTERNS });
  } catch (e) {
    return;
  }
  for (const tab of tabs) {
    if (tab && typeof tab.id === 'number') updateTabBadge(tab.id, tab.url);
  }
}

if (chrome.tabs && chrome.tabs.onUpdated && typeof chrome.tabs.onUpdated.addListener === 'function') {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      updateTabBadge(tabId, changeInfo.url || (tab && tab.url));
    }
  });
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

  if (message.type === 'MODULE_STAND_DOWN') {
    const tabId = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : null;
    const tabUrl = sender && sender.tab ? sender.tab.url : null;
    if (tabId !== null) {
      updateTabBadge(tabId, tabUrl);
    }
    return;
  }
});
