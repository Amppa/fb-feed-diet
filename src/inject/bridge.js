/**
 * FB Diet - MAIN world bridge
 *
 * MAIN world scripts cannot use chrome.* APIs, so this module is the only place that owns
 * runtime state inside the page:
 *   - settings pushed from the service worker (window.__fbDietSetSettings) or from the
 *     content script (postMessage)
 *   - per feed unit expand/collapse state plus the "already reported" dedupe sets
 *   - blocked / allowed / regular events posted back to the content script, which keeps
 *     writing the throttled counters to chrome.storage
 *
 * Message protocol
 *   MAIN    -> content : { source: 'fb-diet/main',    type: ready | blocked | allowed | regular | settings-applied }
 *   content -> MAIN    : { source: 'fb-diet/content', type: ping | settings }
 *
 * Loading order (manifest): proxy.js -> relay.js -> classify.js -> bridge.js -> fold.js
 */
window.FBDietBridge = (() => {
  'use strict';

  const SOURCE_MAIN = 'fb-diet/main';
  const SOURCE_CONTENT = 'fb-diet/content';
  const VERSION = 1;

  // Folding is enabled out of the box; per-category switches stay available for tuning.
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
    debugProbe: false
  };

  const MAX_EXPANDED = 400;
  const MAX_REPORTS = 200;
  const MAX_REGULAR = 150;

  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let lastError = null;
  let debugEnabled = /[?&]fb_diet_debug=1(?:&|$)/.test(window.location.search);

  function debugLog(event, payload) {
    if (!debugEnabled) return;
    console.info('[FB Diet][MAIN]', event, payload || '');
  }

  const expanded = [];
  const expandedSet = new Set();
  const reportedBlocked = [];
  const reportedBlockedSet = new Set();
  const reportedRegular = [];
  const reportedRegularSet = new Set();
  const reportedAllowed = [];
  const reportedAllowedSet = new Set();
  const recentReports = [];

  function recordError(error) {
    lastError = error && error.message ? error.message : String(error);
  }

  function post(type, payload) {
    try {
      window.postMessage({ source: SOURCE_MAIN, version: VERSION, type, payload: payload || null }, window.location.origin);
    } catch (e) {
      recordError(e);
    }
  }

  /** FIFO-bounded set insert. Returns false when the key was already present. */
  function remember(list, set, key, max) {
    if (set.has(key)) return false;
    set.add(key);
    list.push(key);
    while (list.length > max) set.delete(list.shift());
    return true;
  }

  function isExpanded(unitId) {
    return Boolean(unitId) && expandedSet.has(unitId);
  }

  function setExpanded(unitId, value) {
    if (!unitId) return false;

    if (value) return remember(expanded, expandedSet, unitId, MAX_EXPANDED);

    expandedSet.delete(unitId);
    const index = expanded.indexOf(unitId);
    if (index !== -1) expanded.splice(index, 1);
    return false;
  }

  function toggle(unitId) {
    return setExpanded(unitId, !isExpanded(unitId));
  }

  function getSettings() {
    return settings;
  }

  /**
   * Applies settings coming from the extension. Only known keys are accepted so a stray
   * message cannot inject arbitrary state.
   */
  function setSettings(next) {
    if (!next || typeof next !== 'object') return settings;

    const merged = Object.assign({}, settings);
    let changed = false;
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in next && merged[key] !== next[key]) {
        merged[key] = next[key];
        changed = true;
      }
    }

    settings = merged;
    if (changed) {
      debugLog('settings-applied', settings);
      post('settings-applied', { settings });
      // Existing feed units do not necessarily re-render when a storage value
      // changes.  The fold wrapper subscribes to this event so master/category
      // toggles apply immediately without requiring a page refresh.
      window.dispatchEvent(new CustomEvent('fb-diet:settings-changed'));
    }
    return settings;
  }

  function isEnabled(category) {
    return window.FBDietClassify ? window.FBDietClassify.isCategoryEnabled(category, settings) : false;
  }

  function attachReport(type, payload) {
    recentReports.push(Object.assign({ type, at: Date.now() }, payload));
    while (recentReports.length > MAX_REPORTS) recentReports.shift();
  }
  function reportBlocked(result) {
    const key = result.unitId + ':' + result.category;
    if (!remember(reportedBlocked, reportedBlockedSet, key, MAX_EXPANDED)) return;
    post('blocked', {
      category: result.category,
      unitId: result.unitId,
      reason: result.reason,
      unitTypename: result.unitTypename || null,
      moduleName: result.moduleName || null,
      evidence: result.evidence || null
    });
    attachReport('blocked', result);
    debugLog('folded', {
      category: result.category,
      unitId: result.unitId,
      reason: result.reason,
      unitTypename: result.unitTypename || null,
      moduleName: result.moduleName || null,
      evidence: result.evidence || null
    });
  }

  function reportAllowed(result) {
    const key = result.unitId + ':' + result.category;
    if (!remember(reportedAllowed, reportedAllowedSet, key, MAX_EXPANDED)) return;
    post('allowed', {
      category: result.category,
      unitId: result.unitId,
      reason: result.reason,
      unitTypename: result.unitTypename || null,
      moduleName: result.moduleName || null,
      evidence: result.evidence || null
    });
    attachReport('allowed', result);
    debugLog('allowed', {
      category: result.category,
      unitId: result.unitId,
      reason: result.reason,
      unitTypename: result.unitTypename || null,
      moduleName: result.moduleName || null,
      evidence: result.evidence || null
    });
  }

  function reportRegular(result) {
    const key = (result.unitTypename || 'none') + ':' + (result.unitId || 'none');
    if (!remember(reportedRegular, reportedRegularSet, key, MAX_REGULAR)) return;
    post('regular', {
      unitId: result.unitId,
      unitTypename: result.unitTypename,
      reason: result.reason,
      evidence: result.evidence,
      moduleName: result.moduleName || null
    });
    attachReport('regular', result);
    debugLog('regular', {
      unitTypename: result.unitTypename,
      unitId: result.unitId,
      reason: result.reason,
      evidence: result.evidence,
      moduleName: result.moduleName || null
    });
  }

  function announceReady(reason) {
    post('ready', {
      reason,
      hooks: window.FBDietProxy ? window.FBDietProxy.listRegistered() : null,
      proxy: window.FBDietProxy ? window.FBDietProxy.getStats() : null,
      relayReady: window.FBDietRelay ? window.FBDietRelay.isReady() : false,
      settings
    });
  }

  function handleMessage(event) {
    try {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.source !== SOURCE_CONTENT) return;

      if (data.type === 'ping') {
        announceReady('ping');
        return;
      }

      if (data.type === 'settings') {
        setSettings(data.payload && data.payload.settings);
      }
    } catch (e) {
      recordError(e);
    }
  }

  window.addEventListener('message', handleMessage);

  // Entry point used by the service worker through chrome.scripting.executeScript
  window.__fbDietSetSettings = setSettings;

  // Console helper: window.__fbDietDebug(true) enables bounded diagnostic logs.
  window.__fbDietDebug = (enabled) => {
    if (typeof enabled === 'boolean') debugEnabled = enabled;
    return {
    debugEnabled,
    settings,
    proxy: window.FBDietProxy ? window.FBDietProxy.getStats() : null,
    proxyErrors: window.FBDietProxy ? window.FBDietProxy.getErrors() : null,
    registered: window.FBDietProxy ? window.FBDietProxy.listRegistered() : null,
    relay: {
      ready: window.FBDietRelay ? window.FBDietRelay.isReady() : false,
      sources: window.FBDietRelay ? window.FBDietRelay.getSourceCount() : 0,
      module: window.FBDietRelay ? window.FBDietRelay.RELAY_PROXY_MODULE : null
    },
    counts: {
      blocked: reportedBlocked.length,
      regular: reportedRegular.length,
      expanded: expanded.length
    },
    lastError,
    recent: recentReports.slice(-25)
    };
  };

  // Composition root: hand the Relay store reader to the classifier. Both are optional so
  // a partially loaded MAIN world (or a unit test) never throws here.
  if (window.FBDietClassify && window.FBDietRelay) {
    window.FBDietClassify.setRelayReader((ids, path, options) => window.FBDietRelay.read(ids, path, options));
  }

  return {
    SOURCE_MAIN,
    SOURCE_CONTENT,
    DEFAULT_SETTINGS,
    getSettings,
    setSettings,
    isEnabled,
    isExpanded,
    setExpanded,
    toggle,
    reportBlocked,
    reportAllowed,
    reportRegular,
    debugLog,
    isDebugEnabled: () => debugEnabled,
    announceReady,
    getRecentReports: () => recentReports.slice(),
    getLastError: () => lastError
  };
})();
