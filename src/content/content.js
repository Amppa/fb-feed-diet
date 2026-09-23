/**
 * FB Diet - Content Script
 * Observes Facebook feed/page elements, folds ads & suggestions into clean placeholders,
 * allows one-click expand/collapse, and sends throttled stats to storage.
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

  // How long to wait for the MAIN world proxy before falling back to DOM detection
  const FALLBACK_DELAY_MS = 8000;

  // True once the MAIN world proxy announced itself: it owns folding from then on
  let proxyActive = false;
  let fallbackTimer = null;

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

  function getTodayString() {
    if (typeof DEFAULTS.getTodayDateString === 'function') {
      return DEFAULTS.getTodayDateString();
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Builds a zeroed counts object (used for the buffer and storage fallbacks)
  function createEmptyCounts() {
    return Object.assign({}, DEFAULT_COUNTS, { date: getTodayString() });
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

    try {
      window.FBDietDOMFallback?.stopObservation?.();
    } catch (e) {
      // Ignore: observer may already be gone
    }

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

    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }

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

  /**
   * The proxy owns folding once it reports in. The DOM scanner is stopped and anything the
   * conservative DOM fallback already folded is restored, so the two engines never fight.
   */
  function activateProxyMode() {
    if (isShutDown || proxyActive) return;

    if (currentSettings.mode === 'dom') {
      console.info('[FB Diet] Operating in DOM mode: skipping proxy activation');
      startObservation();
      return;
    }

    proxyActive = true;

    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }

    try {
      window.FBDietDOMFallback?.restoreAllElements?.();
    } catch (e) {
      // Nothing folded yet: nothing to restore
    }

    window.FBDietDOMFallback?.stopObservation?.();

    announceToMain();
  }

  /**
   * Starts the conservative DOM fallback only when the MAIN world proxy never reported in
   * (older Chrome, blocked injection, Facebook change that defeats the hook).
   */
  function scheduleFallbackProbe() {
    if (fallbackTimer || proxyActive || isShutDown) return;

    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (proxyActive || isShutDown) return;
      startObservation();
    }, FALLBACK_DELAY_MS);
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
    if (!isExtensionValid()) return;

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
        activateProxyMode();
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

  // Initialise settings, then start the proxy handshake / fallback watchdog
  (async () => {
    const data = await safeStorageGet('settings');
    if (data?.settings) {
      currentSettings = { ...currentSettings, ...data.settings };
    }

    // Context was invalidated before we could even read settings: stay dormant.
    if (isShutDown) return;

    announceToMain();
    scheduleFallbackProbe();
  })();

  // Listen for real-time toggle changes from Popup
  function applyUpdatedSettings(newSettings) {
    if (!newSettings || typeof newSettings !== 'object') return;
    const oldEnabled = currentSettings.enabled;
    currentSettings = { ...currentSettings, ...newSettings };

    if (proxyActive) {
      announceToMain();
      return;
    }

    const fallback = window.FBDietDOMFallback;
    if (oldEnabled && !currentSettings.enabled) {
      fallback?.restoreAllElements?.();
    } else if (currentSettings.enabled) {
      fallback?.restoreAllElements?.();
      fallback?.scanPage?.(currentSettings, recordBlock);
    }
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
    proxyActive,
    fallbackPending: Boolean(fallbackTimer),
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

      const today = getTodayString();
      let counts = data.counts;
      if (!counts || counts.date !== today) {
        counts = createEmptyCounts();
      }

      counts.date = today;
      counts.total = (counts.total || 0) + delta.total;
      counts.filtered = (counts.filtered || 0) + (delta.filtered || 0);
      counts.sponsored = (counts.sponsored || 0) + delta.sponsored;
      counts.suggested = (counts.suggested || 0) + delta.suggested;
      counts.suggestedGroup = (counts.suggestedGroup || 0) + (delta.suggestedGroup || 0);
      counts.marketAds = (counts.marketAds || 0) + delta.marketAds;
      counts.searchingAds = (counts.searchingAds || 0) + delta.searchingAds;
      counts.stories = (counts.stories || 0) + (delta.stories || 0);
      counts.reels = (counts.reels || 0) + (delta.reels || 0);
      counts.regular = (counts.regular || 0) + (delta.regular || 0);

      await safeStorageSet({ counts });
    }, 3000);
  }

  /**
   * Tracks a blocked item and queues stats
   */
  function recordBlock(category) {
    countBuffer.total += 1;
    countBuffer.filtered = (countBuffer.filtered || 0) + 1;
    if (countBuffer[category] !== undefined) {
      countBuffer[category] += 1;
    }
    scheduleCountFlush();
  }

  /**
   * Tracks an allowed item (matched category but user filter disabled)
   */
  function recordAllowed(category) {
    countBuffer.total += 1;
    if (countBuffer[category] !== undefined) {
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

  /**
   * Sets up MutationObserver via DOM fallback to handle dynamic infinite scroll feeds
   */
  function startObservation() {
    if (isShutDown || proxyActive) return;
    const fallback = window.FBDietDOMFallback;
    if (fallback && typeof fallback.startObservation === 'function') {
      fallback.startObservation(() => currentSettings, recordBlock);
    }
  }

  window.__fbDietDebug = () => {
    const info = {
      mode: currentSettings.mode || 'proxy',
      enabled: currentSettings.enabled !== false,
      proxyActive,
      isShutDown,
      recentMainReports: mainReports.slice(-10),
      countBuffer,
      relayStoreReady: window.FBDietRelay ? window.FBDietRelay.isReady() : (window.___rs ? true : 'main-world')
    };
    console.log('[FB Diet Diagnostics]', info);
    return info;
  };
})();
