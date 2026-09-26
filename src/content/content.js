/**
 * FB Diet - Content Script (ISOLATED world)
 * Pure bridge: owns chrome.storage (settings, counters, diagnostic log) and relays
 * settings to the MAIN world, which performs all classification and folding.
 */

(() => {
  const DEFAULTS = globalThis.FB_DIET_DEFAULTS || {};
  const DEFAULT_SETTINGS = DEFAULTS.SETTINGS || {};
  const DEFAULT_COUNTS = DEFAULTS.COUNTS || {};

  // Runtime configuration state
  let currentSettings = Object.assign({}, DEFAULT_SETTINGS);

  // MAIN world bridge protocol (see src/inject/bridge.js)
  const MAIN_SOURCE = 'fb-diet/main';
  const CONTENT_SOURCE = 'fb-diet/content';

  // Ring buffer of reports from the MAIN world proxy (diagnostics)
  const mainReports = [];
  const MAX_MAIN_REPORTS = 200;
  const MAX_MAIN_REPORT_LOGS = 30;

  // Persistent diagnostic log (chrome.storage.local key "fbDietLog"). It survives SPA
  // navigation and page reloads, so a misclassification seen while casually scrolling
  // can still be diagnosed afterwards. Writes are batched: the buffer is flushed every
  // LOG_FLUSH_DELAY_MS with a read-merge-write, capped at MAX_PERSISTED_LOGS entries.
  const LOG_KEY = 'fbDietLog';
  const MAX_PERSISTED_LOGS = 300;
  const LOG_FLUSH_DELAY_MS = 2000;
  let logBuffer = [];
  let logFlushTimer = null;

  // Buffer for throttled stats updates (transferred every 3 seconds)
  let countBuffer = Object.assign({}, DEFAULT_COUNTS);
  let flushTimer = null;
  let isShutDown = false;

  // Builds a zeroed counts object (used for the buffer and storage fallbacks)
  function createEmptyCounts() {
    return Object.assign({}, DEFAULT_COUNTS, { date: DEFAULTS.getTodayDateString() });
  }

  // Unit ids are opaque base64 blobs; show a short fingerprint instead.
  function shortUnitId(id) {
    if (!id) return '';
    return id.length > 10 ? '…' + id.slice(-10) : id;
  }

  // Diagnostic logs are intentionally silent unless fb_diet_debug=1 is on.
  function isDebugUrl() {
    return /[?&]fb_diet_debug=1(?:&|$)/.test(window.location.search);
  }

  /**
   * Helper to check if the extension context is still valid.
   * After the extension is reloaded/updated, chrome.* APIs are torn down on already-open
   * tabs, so chrome.storage becomes undefined and any call would throw.
   * Returns false once we have shut down, so no further work is attempted.
   */
  function isExtensionValid() {
    try {
      if (isShutDown) return false;
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id) && Boolean(chrome.storage?.local);
    } catch (e) {
      return false;
    }
  }

  /**
   * Stops all background work once the extension context is gone (e.g. the extension was
   * reloaded while this tab stayed open). Keeps the orphaned script completely silent
   * instead of throwing "Cannot read properties of undefined (reading 'local')" every 3s.
   */
  function shutdown() {
    if (isShutDown) return;
    isShutDown = true;

    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    // Pending diagnostic entries can no longer be written anywhere, drop them silently.
    if (logFlushTimer) {
      clearTimeout(logFlushTimer);
      logFlushTimer = null;
    }
    logBuffer = [];

    // Pending stats can no longer be written anywhere, drop them silently.
    countBuffer = createEmptyCounts();
  }

  /**
   * Safe wrapper around chrome.storage.local.get.
   * Returns null (and shuts the script down) when the extension context is invalidated.
   */
  async function safeStorageGet(keys) {
    if (!isExtensionValid()) {
      shutdown();
      return null;
    }

    try {
      const data = await chrome.storage.local.get(keys);
      return data || null;
    } catch (e) {
      // Only tear down when the context is really gone; transient errors are recoverable.
      if (!isExtensionValid()) shutdown();
      return null;
    }
  }

  /**
   * Safe wrapper around chrome.storage.local.set.
   * Resolves to false (and shuts the script down) when the extension context is invalidated.
   */
  async function safeStorageSet(values) {
    if (!isExtensionValid()) {
      shutdown();
      return false;
    }

    try {
      await chrome.storage.local.set(values);
      return true;
    } catch (e) {
      if (!isExtensionValid()) shutdown();
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * MAIN world proxy bridge
   *
   * The MAIN world scripts (src/inject/*) classify feed units from Relay data and report
   * here. This isolated world keeps ownership of chrome.storage (settings + counters),
   * which also means the MAIN world can never hit "extension context invalidated".
   * ------------------------------------------------------------------ */

  /**
   * Sends the current settings to the MAIN world and asks for a handshake. The MAIN world
   * may not be listening yet, which is why it answers a ping and we also announce on
   * every settings change.
   */
  function announceToMain() {
    try {
      window.postMessage(
        { source: CONTENT_SOURCE, type: 'settings', payload: { settings: currentSettings } },
        '*'
      );
      window.postMessage({ source: CONTENT_SOURCE, type: 'ping' }, '*');
    } catch (e) {
      // postMessage should never fail, but never let it break the content script
    }
  }

  function storeMainReport(type, payload) {
    mainReports.push({ type, at: Date.now(), ...payload });
    while (mainReports.length > MAX_MAIN_REPORTS) mainReports.shift();

    pushPersistedLog(type, payload);

    if (mainReports.length <= MAX_MAIN_REPORT_LOGS && isDebugUrl()) {
      if (type === 'regular' && payload.reason === 'no-match' && payload.unitTypename === 'Story') {
        console.debug('[FB Diet] Normal/unclassified feed story:', shortUnitId(payload.unitId));
      } else {
        console.info(
          '[FB Diet]',
          type,
          payload.unitTypename || '-',
          payload.category || '-',
          payload.reason || '',
          payload.moduleName || '-',
          shortUnitId(payload.unitId)
        );
      }
    }
  }

  /**
   * Normalized single entry for the persistent diagnostic log. The full unitId is
   * shortened: the raw base64 blob is unreadable in a log table and bloats storage.
   */
  function toLogEntry(type, payload) {
    return {
      at: Date.now(),
      type,
      category: payload.category || null,
      reason: payload.reason || null,
      unitTypename: payload.unitTypename || null,
      unitId: shortUnitId(payload.unitId) || null,
      moduleName: payload.moduleName || null,
      evidence: payload.evidence || null,
      page: window.location && window.location.pathname ? window.location.pathname : null
    };
  }

  function pushPersistedLog(type, payload) {
    if (isShutDown) return;
    logBuffer.push(toLogEntry(type, payload));
    if (logBuffer.length > MAX_PERSISTED_LOGS) logBuffer.splice(0, logBuffer.length - MAX_PERSISTED_LOGS);
    scheduleLogFlush();
  }

  function scheduleLogFlush() {
    if (logFlushTimer || isShutDown) return;
    if (!isExtensionValid()) return;
    logFlushTimer = setTimeout(flushPersistedLog, LOG_FLUSH_DELAY_MS);
  }

  /** Read-merge-write so concurrent tabs converge on one capped ring buffer. */
  async function flushPersistedLog() {
    logFlushTimer = null;
    if (isShutDown || logBuffer.length === 0) return;
    if (!isExtensionValid()) {
      shutdown();
      return;
    }

    const pending = logBuffer.splice(0, logBuffer.length);
    const data = await safeStorageGet(LOG_KEY);
    if (!data || isShutDown) return;

    const existing = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
    const merged = existing.concat(pending);
    if (merged.length > MAX_PERSISTED_LOGS) merged.splice(0, merged.length - MAX_PERSISTED_LOGS);

    await safeStorageSet({ [LOG_KEY]: merged });
  }

  function handleMainMessage(event) {
    try {
      if (isShutDown || event.source !== window) return;

      const data = event.data;
      if (!data || typeof data !== 'object' || data.source !== MAIN_SOURCE) return;

      if (data.type === 'ready' || data.type === 'hello') {
        announceToMain();
        return;
      }

      if (data.type === 'blocked') {
        const category = data.payload && data.payload.category;
        if (category) recordBlock(category);
        storeMainReport(data.type, data.payload || {});
        return;
      }

      if (data.type === 'allowed') {
        const category = data.payload && data.payload.category;
        if (category) recordAllowed(category);
        storeMainReport(data.type, data.payload || {});
        return;
      }

      if (data.type === 'regular') {
        recordRegular();
        storeMainReport(data.type, data.payload || {});
      }
    } catch (e) {
      // A malformed message must never break the content script
    }
  }

  window.addEventListener('message', handleMainMessage);

  // Initialise settings, then start the proxy handshake
  (async () => {
    const data = await safeStorageGet('settings');
    if (data?.settings) {
      currentSettings = { ...currentSettings, ...data.settings };
    }

    // Context was invalidated before we could even read settings: stay dormant.
    if (isShutDown) return;

    announceToMain();
  })();

  // Applies a settings update pushed from Popup/Options and forwards it to the MAIN world
  function applyUpdatedSettings(newSettings) {
    if (!newSettings || typeof newSettings !== 'object') return;
    currentSettings = { ...currentSettings, ...newSettings };
    announceToMain();
  }

  // Listen for real-time toggle changes from Popup or Options
  function registerStorageListener() {
    if (!isExtensionValid() || !chrome.storage?.onChanged) return;

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!isExtensionValid()) {
          shutdown();
          return;
        }

        if (area === 'local' && changes.settings) {
          applyUpdatedSettings(changes.settings.newValue);
        }
      });
    } catch (e) {
      // Extension context invalidated while registering the listener
    }
  }

  if (isExtensionValid() && chrome.runtime?.onMessage) {
    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (!isExtensionValid()) {
          shutdown();
          return;
        }
        if (message && message.type === 'SETTINGS_CHANGED') {
          applyUpdatedSettings(message.settings);
        }
      });
    } catch (e) {
      // Extension context invalidated
    }
  }

  registerStorageListener();

  // When the tab goes away, drop the observer & pending timers
  window.addEventListener('pagehide', shutdown, { once: true });

  // Debug helpers (isolated world): pick the content script context in DevTools to use them
  window.__fbDietStatus = () => ({
    settings: { ...currentSettings },
    reports: mainReports.slice(-25),
    pendingLogEntries: logBuffer.length
  });
  window.__fbDietReports = () => mainReports.slice();

  // Persistent diagnostic log helpers (content script context in DevTools):
  //   __fbDietDumpLog()   -> prints & returns the last MAX_PERSISTED_LOGS classification events
  //   __fbDietClearLog()  -> wipes the persisted log
  window.__fbDietDumpLog = async () => {
    const data = await safeStorageGet(LOG_KEY);
    const entries = (data && data[LOG_KEY]) || [];
    console.info('[FB Diet] persisted log (' + entries.length + ' entries):', entries);
    return entries;
  };
  window.__fbDietClearLog = async () => {
    logBuffer = [];
    if (logFlushTimer) {
      clearTimeout(logFlushTimer);
      logFlushTimer = null;
    }
    return safeStorageSet({ [LOG_KEY]: [] });
  };

  /**
   * Schedules a flush of accumulated block counts to chrome.storage.local
   */
  function scheduleCountFlush() {
    if (flushTimer) return;
    // Never queue work when the extension context is gone (orphaned content script).
    if (!isExtensionValid()) {
      shutdown();
      return;
    }

    flushTimer = setTimeout(async () => {
      flushTimer = null;
      if (countBuffer.total === 0) return;

      if (!isExtensionValid()) {
        shutdown();
        return;
      }

      const delta = { ...countBuffer };
      // Reset buffer
      countBuffer = createEmptyCounts();

      const data = await safeStorageGet('counts');
      if (!data || isShutDown) return;

      const today = DEFAULTS.getTodayDateString();
      let counts = data.counts;
      if (!counts || counts.date !== today) {
        counts = createEmptyCounts();
      }

      counts.date = today;
      for (const key of Object.keys(DEFAULT_COUNTS)) {
        if (key === 'date') continue;
        counts[key] = (counts[key] || 0) + (delta[key] || 0);
      }

      await safeStorageSet({ counts });
    }, 3000);
  }

  /**
   * Tracks a blocked item and queues stats
   */
  function recordBlock(category) {
    countBuffer.total += 1;
    countBuffer.filtered = (countBuffer.filtered || 0) + 1;
    const group = (DEFAULTS.GROUP_BY_CATEGORY && DEFAULTS.GROUP_BY_CATEGORY[category]) || category;
    if (countBuffer[group] !== undefined) {
      countBuffer[group] += 1;
    } else if (countBuffer[category] !== undefined) {
      countBuffer[category] += 1;
    }
    scheduleCountFlush();
  }

  /**
   * Tracks an allowed item (matched category but user filter disabled)
   */
  function recordAllowed(category) {
    countBuffer.total += 1;
    const group = (DEFAULTS.GROUP_BY_CATEGORY && DEFAULTS.GROUP_BY_CATEGORY[category]) || category;
    if (countBuffer[group] !== undefined) {
      countBuffer[group] += 1;
    } else if (countBuffer[category] !== undefined) {
      countBuffer[category] += 1;
    }
    scheduleCountFlush();
  }

  /**
   * Tracks a regular (normal) feed post
   */
  function recordRegular() {
    countBuffer.total += 1;
    countBuffer.regular = (countBuffer.regular || 0) + 1;
    scheduleCountFlush();
  }

  window.__fbDietDebug = () => {
    const info = {
      dietMode: currentSettings.dietMode || DEFAULT_SETTINGS.dietMode,
      enabled: currentSettings.enabled !== false,
      isShutDown,
      recentMainReports: mainReports.slice(-10),
      countBuffer
    };
    console.log('[FB Diet Diagnostics]', info);
    return info;
  };
})();
