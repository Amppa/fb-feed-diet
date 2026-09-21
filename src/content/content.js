/**
 * FB Diet - Content Script
 * Observes Facebook feed/page elements, folds ads & suggestions into clean placeholders,
 * allows one-click expand/collapse, and sends throttled stats to storage.
 */

(() => {
  const DEFAULTS = globalThis.FB_DIET_DEFAULTS || {};
  const DEFAULT_SETTINGS = DEFAULTS.SETTINGS || {
    enabled: true,
    mode: 'proxy',
    foldSponsored: true,
    foldSuggested: true,
    foldSuggestedGroup: true,
    foldMarketAds: true,
    foldSearchingAds: true,
    foldStories: true,
    foldReels: true,
    debugProbe: false
  };
  const DEFAULT_COUNTS = DEFAULTS.COUNTS || {
    date: '',
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
  let observer = null;
  let scanScheduled = false;
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
      observer?.disconnect();
    } catch (e) {
      // Ignore: observer may already be gone
    }
    observer = null;

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
        window.location.origin
      );
      window.postMessage({ source: CONTENT_SOURCE, type: 'ping' }, window.location.origin);
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
      restoreAllElements();
    } catch (e) {
      // Nothing folded yet: nothing to restore
    }

    try {
      observer?.disconnect();
    } catch (e) {
      // Ignore: observer may already be gone
    }
    observer = null;

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
      if (type === 'unknown' && payload.reason === 'unknown' && payload.unitTypename === 'Story') {
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

      if (data.type === 'regular' || data.type === 'unknown') {
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
  function registerStorageListener() {
    if (!isExtensionValid() || !chrome.storage?.onChanged) return;

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!isExtensionValid()) {
          shutdown();
          return;
        }

        if (area === 'local' && changes.settings) {
          const oldEnabled = currentSettings.enabled;
          currentSettings = { ...currentSettings, ...changes.settings.newValue };

          if (proxyActive) {
            // The MAIN world wrapper renders live, so pushing settings is all that is
            // needed. No re-scan and no page reload.
            announceToMain();
            return;
          }

          // If master switch was toggled off, restore all folded items
          if (oldEnabled && !currentSettings.enabled) {
            restoreAllElements();
          } else if (!oldEnabled && currentSettings.enabled) {
            scanPage();
          }
        }
      });
    } catch (e) {
      // Extension context invalidated while registering the listener
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
   * Builds the folding placeholder element
   */
  function createPlaceholder(type, originalElement) {
    const config = {
      sponsored: {
        badgeClass: 'fb-diet-badge-sponsored',
        badgeText: 'Sponsored'
      },
      suggested: {
        badgeClass: 'fb-diet-badge-suggested',
        badgeText: 'Suggested post'
      },
      suggestedGroup: {
        badgeClass: 'fb-diet-badge-group',
        badgeText: 'Suggested group'
      },
      marketAds: {
        badgeClass: 'fb-diet-badge-market',
        badgeText: 'Market ad'
      },
      searchingAds: {
        badgeClass: 'fb-diet-badge-search',
        badgeText: 'Search ad'
      },
      stories: {
        badgeClass: 'fb-diet-badge-stories',
        badgeText: 'Stories'
      },
      reels: {
        badgeClass: 'fb-diet-badge-reels',
        badgeText: 'Reels'
      }
    }[type] || {
      badgeClass: 'fb-diet-badge-sponsored',
      badgeText: 'Sponsored'
    };

    const bar = document.createElement('div');
    bar.className = 'fb-diet-placeholder';
    bar.setAttribute('data-fb-diet-type', type);
    bar.title = 'Show post';

    bar.innerHTML = `
      <div class="fb-diet-placeholder-left">
        <span class="fb-diet-badge ${config.badgeClass}">${config.badgeText}</span>
      </div>
      <span class="fb-diet-toggle-symbol">[+]</span>
    `;

    let isExpanded = false;

    bar.addEventListener('click', () => {
      isExpanded = !isExpanded;
      const symbol = bar.querySelector('.fb-diet-toggle-symbol');
      const badge = bar.querySelector('.fb-diet-badge');

      if (isExpanded) {
        originalElement.classList.add('fb-diet-is-expanded');
        bar.classList.add('fb-diet-state-expanded');
        bar.title = 'Re-fold';
        if (symbol) symbol.textContent = '[-]';
        if (badge) badge.textContent = config.badgeText;
      } else {
        originalElement.classList.remove('fb-diet-is-expanded');
        bar.classList.remove('fb-diet-state-expanded');
        bar.title = 'Show post';
        if (symbol) symbol.textContent = '[+]';
        if (badge) badge.textContent = config.badgeText;
      }
    });

    return bar;
  }

  /**
   * Folds a target element and injects the interactive placeholder
   */
  function foldElement(element, type) {
    if (!element || element.dataset.fbDietFolded === 'true') return;
    // Node may already be detached by Facebook's virtualized re-render
    if (!element.isConnected || !element.parentElement) return;

    element.dataset.fbDietFolded = 'true';
    element.classList.add('fb-diet-folded-original');

    try {
      const placeholder = createPlaceholder(type, element);
      element.parentElement.insertBefore(placeholder, element);
    } catch (e) {
      // Roll back so the element can be evaluated again later
      element.classList.remove('fb-diet-folded-original');
      delete element.dataset.fbDietFolded;
      return;
    }

    recordBlock(type);
  }

  /**
   * Restores all folded items back to normal
   */
  function restoreAllElements() {
    document.querySelectorAll('.fb-diet-placeholder').forEach((p) => p.remove());
    document.querySelectorAll('.fb-diet-folded-original').forEach((el) => {
      el.classList.remove('fb-diet-folded-original', 'fb-diet-is-expanded');
      delete el.dataset.fbDietFolded;
      delete el.dataset.fbDietChecked;
    });
  }

  /**
   * Runs a detector predicate defensively: a detector throwing must never break the scan loop.
   */
  function safeDetect(predicate, element) {
    try {
      return predicate(element) === true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Evaluates a single DOM node against active filters
   */
  function evaluateElement(el) {
    if (!currentSettings.enabled || !el || el.dataset.fbDietFolded === 'true') return;

    // detector.js is injected before content.js, but never let a missing detector throw
    const detector = window.FBDietDetector;
    if (!detector || typeof detector.isSponsored !== 'function') return;

    // Check Stories
    if (currentSettings.foldStories && safeDetect(detector.isStories, el)) {
      foldElement(el, 'stories');
      return;
    }

    // Check Reels
    if (currentSettings.foldReels && safeDetect(detector.isReels, el)) {
      foldElement(el, 'reels');
      return;
    }

    // Check Marketplace Ads
    if (currentSettings.foldMarketAds && safeDetect(detector.isMarketAd, el)) {
      foldElement(el, 'marketAds');
      return;
    }

    // Check Search Result Ads
    if (currentSettings.foldSearchingAds && safeDetect(detector.isSearchAd, el)) {
      foldElement(el, 'searchingAds');
      return;
    }

    // Check Sponsored Feed posts
    if (currentSettings.foldSponsored && safeDetect(detector.isSponsored, el)) {
      foldElement(el, 'sponsored');
      return;
    }

    // Check Suggested Groups
    if (currentSettings.foldSuggestedGroup && safeDetect(detector.isSuggestedGroup, el)) {
      foldElement(el, 'suggestedGroup');
      return;
    }

    // Check Suggested Feed posts
    if (currentSettings.foldSuggested && safeDetect(detector.isSuggested, el)) {
      foldElement(el, 'suggested');
      return;
    }
  }

  /**
   * Scans all relevant feed and card elements on the page
   */
  function scanPage() {
    if (!currentSettings.enabled || isShutDown) return;
    // The MAIN world proxy owns detection once it is active; the DOM fallback must stay
    // out of the way so the two engines never fight over the same posts.
    if (proxyActive) return;

    // Always scope to the main column so the left navigation / right rail can never be folded
    const scope = document.querySelector('div[role="main"]') ? 'div[role="main"]' : 'body';

    // Standard feed items, articles, and cards
    const selectors = [
      `${scope} [role="feed"] > div`,
      `${scope} [role="article"]`,
      `${scope} div[data-pagelet^="FeedUnit"]`,
      `${scope} div[data-virtualized="false"]`,
      // Stories & Reels containers
      `${scope} div[data-pagelet*="Stories"]`,
      `${scope} div[aria-label="Stories"]`,
      `${scope} div[aria-label="限時動態"]`,
      `${scope} div[data-pagelet*="Reel"]`,
      `${scope} div[aria-label*="Reels"]`,
      `${scope} div[aria-label*="連續短片"]`,
      // Marketplace item cards
      `${scope} div[aria-label="Collection of Marketplace items"] > div`,
      `${scope} a[href*="/marketplace/item/"]`
    ];

    const elements = document.querySelectorAll(selectors.join(', '));
    elements.forEach((el) => {
      try {
        // Find suitable top-level wrapper if inspecting an article
        let target = el;
        if (el.getAttribute('role') === 'article') {
          const container = el.closest('[role="feed"] > div') || el.closest('[data-pagelet]') || el;
          target = container;
        }

        if (!target) return;

        // Never fold a container that holds several posts at once (virtualized mega-wrappers)
        if (target.querySelectorAll('[role="article"]').length > 1) return;

        // Facebook often inserts the Sponsored label after the feed wrapper is
        // first mounted.  Keep a small fingerprint instead of a permanent
        // "checked" flag so changed units are evaluated again, while unchanged
        // units remain inexpensive during MutationObserver bursts.
        const fingerprint = `${target.textContent || ''}\u0000${target.querySelectorAll('[aria-label], [data-ad-rendering-role], [data-ad-preview], [data-ad-comet-preview], [data-ad-id]').length}`;
        if (target.dataset.fbDietFingerprint === fingerprint) return;
        target.dataset.fbDietFingerprint = fingerprint;
        window.FBDietDetector?.clearTextCache?.(target);
        target.querySelectorAll('[role="article"], header').forEach((node) => {
          window.FBDietDetector?.clearTextCache?.(node);
        });

        evaluateElement(target);
      } catch (e) {
        // One bad node must never abort the whole scan
      }
    });
  }

  // Throttle scanPage calls during DOM mutations
  function triggerThrottledScan() {
    if (scanScheduled || isShutDown) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      if (isShutDown) return;
      try {
        scanPage();
      } catch (e) {
        // A failed scan is retried on the next mutation; never bubble into the page console
      }
    });
  }

  /**
   * Sets up MutationObserver to handle dynamic infinite scroll feeds
   */
  function startObservation() {
    if (observer || isShutDown || proxyActive) return;

    // Initial scan
    try {
      scanPage();
    } catch (e) {
      // The initial DOM may still be hydrating; the observer will pick it up
    }

    const body = document.body;
    if (!body) return;

    observer = new MutationObserver((mutations) => {
      if (isShutDown) return;

      // The extension was reloaded/updated while this tab stayed open:
      // stop all work quietly instead of throwing on every storage access.
      if (!isExtensionValid()) {
        shutdown();
        return;
      }

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          triggerThrottledScan();
          break;
        }
      }
    });

    observer.observe(body, {
      childList: true,
      subtree: true
    });
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
