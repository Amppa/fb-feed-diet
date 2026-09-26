'use strict';
/**
 * Focused contract tests for src/content/content.js.
 *
 * The content script is an IIFE, so these tests load the real file in a minimal
 * isolated-world VM. They cover only the storage buffers and lifecycle boundary;
 * all classification and folding lives in the MAIN world (src/inject/*).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, loadDefaults } = require('./harness');

const MAIN_SOURCE = 'fb-diet/main';

function createHarness(options = {}) {
  const storageData = { settings: {}, counts: options.counts || null };
  const timers = [];
  const listeners = new Map();
  const messages = [];

  const sandbox = {
    console: { log() {}, debug() {}, info() {} },
    location: { search: '', pathname: '/' },
    Date,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    postMessage(message) {
      messages.push(message);
    },
    chrome: {
      runtime: { id: options.runtimeId === undefined ? 'test-extension' : options.runtimeId },
      storage: {
        local: {
          async get(keys) {
            if (keys === 'settings') return { settings: storageData.settings };
            if (keys === 'counts') return { counts: storageData.counts };
            if (keys === 'fbDietLog') return { fbDietLog: storageData.fbDietLog || [] };
            return {};
          },
          async set(values) {
            Object.assign(storageData, values);
          }
        },
        onChanged: { addListener() {} }
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  sandbox.window = vm.runInContext('globalThis', sandbox);
  sandbox.self = sandbox.window;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'defaults.js'), 'utf8'), sandbox);
  for (const [key, value] of Object.entries(options.extraCounts || {})) {
    sandbox.FB_DIET_DEFAULTS.COUNTS[key] = value;
  }
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'content', 'content.js'), 'utf8'), sandbox);

  function dispatchMain(type, payload = {}) {
    for (const callback of listeners.get('message') || []) {
      callback({ source: sandbox.window, data: { source: MAIN_SOURCE, type, payload } });
    }
  }

  function runTimer(delay) {
    const timer = timers.find((entry) => entry.delay === delay && !entry.cleared);
    if (!timer) return Promise.resolve(false);
    timer.cleared = true;
    return Promise.resolve(timer.callback()).then(() => true);
  }

  function hasPendingTimer(delay) {
    return timers.some((entry) => entry.delay === delay && !entry.cleared);
  }

  return {
    sandbox,
    storageData,
    timers,
    dispatchMain,
    runTimer,
    hasPendingTimer,
    get messages() { return messages; }
  };
}

async function settleContentScript() {
  await new Promise((resolve) => setImmediate(resolve));
}

function run(checker) {
  const defaults = loadDefaults();
  const today = defaults.getTodayDateString();

  // The retired ISOLATED-world DOM fallback engine must never come back (STRATEGY.md #32).
  const source = fs.readFileSync(path.join(ROOT, 'src', 'content', 'content.js'), 'utf8');
  checker.ok('content.js references no DOM fallback engine', source.indexOf('FBDietDOMFallback') === -1);
  // Settings arrive through exactly one channel: chrome.storage.onChanged (STRATEGY.md #33).
  checker.ok('content.js has no second runtime settings channel', source.indexOf('SETTINGS_CHANGED') === -1);
  checker.ok('content.js keeps the single-engine debug surface', source.indexOf('currentSettings.dietMode') !== -1);

  return (async () => {
    const counts = createHarness();
    await settleContentScript();
    counts.dispatchMain('blocked', { category: 'sponsored', unitId: 'blocked-1' });
    counts.dispatchMain('allowed', { category: 'suggested', unitId: 'allowed-1' });
    counts.dispatchMain('regular', { unitId: 'regular-1' });
    checker.ok('count flush timer starts after reports', counts.hasPendingTimer(3000));
    const flushed = await counts.runTimer(3000);
    checker.ok('count flush timer runs', flushed);
    checker.equals('count flush persists the schema totals', counts.storageData.counts && counts.storageData.counts.total, 3);
    checker.equals('count flush preserves ads totals', counts.storageData.counts && counts.storageData.counts.ads, 1);
    checker.equals('count flush preserves suggested totals', counts.storageData.counts && counts.storageData.counts.suggested, 1);
    checker.equals('count flush preserves regular totals', counts.storageData.counts && counts.storageData.counts.regular, 1);
    checker.equals('count flush uses the current date', counts.storageData.counts && counts.storageData.counts.date, today);

    const extended = createHarness({ extraCounts: { experimentalCategory: 0 } });
    extended.dispatchMain('blocked', { category: 'experimentalCategory', unitId: 'blocked-extended' });
    await extended.runTimer(3000);
    checker.equals(
      'count flush includes newly declared schema fields',
      extended.storageData.counts && extended.storageData.counts.experimentalCategory,
      1
    );

    const logs = createHarness();
    await settleContentScript();
    logs.dispatchMain('regular', { unitId: 'log-1234567890' });
    const logFlushed = await logs.runTimer(2000);
    checker.ok('diagnostic log flush timer runs', logFlushed);
    checker.equals('diagnostic log flush persists reports', logs.storageData.fbDietLog && logs.storageData.fbDietLog.length, 1);
    checker.equals('diagnostic log keeps its short unit fingerprint', logs.storageData.fbDietLog && logs.storageData.fbDietLog[0].unitId, '…1234567890');

    const invalidLog = createHarness();
    await settleContentScript();
    invalidLog.dispatchMain('regular', { unitId: 'invalid-log-1234567890' });
    invalidLog.sandbox.chrome.runtime.id = '';
    await invalidLog.runTimer(2000);
    checker.equals('invalid extension shuts down a pending log flush', invalidLog.sandbox.__fbDietDebug().isShutDown, true);
    checker.equals('invalid extension drops pending diagnostic logs', invalidLog.sandbox.__fbDietStatus().pendingLogEntries, 0);

    const invalid = createHarness({ runtimeId: '' });
    await settleContentScript();
    invalid.dispatchMain('regular', { unitId: 'invalid-1' });
    checker.ok('invalid extension queues no count flush', !invalid.timers.some((timer) => timer.delay === 3000 && !timer.cleared));
    checker.equals('invalid extension is shut down after receiving a report', invalid.sandbox.__fbDietDebug().isShutDown, true);

    /* --- Handshake loop prevention (ping-pong guard) --- */
    const hs = createHarness();
    await settleContentScript();
    const initialMsgCount = hs.messages.length;
    checker.ok('initial announce sent settings and ping', initialMsgCount >= 2);
    checker.equals('initial handshake is not done yet', hs.sandbox.__fbDietStatus().handshakeDone, false);

    // First ready message completes handshake
    hs.dispatchMain('ready', {});
    checker.equals('first ready marks handshakeDone', hs.sandbox.__fbDietStatus().handshakeDone, true);
    const countAfterFirstReady = hs.messages.length;
    checker.ok('first ready pushed settings', countAfterFirstReady > initialMsgCount);
    const lastMsg = hs.messages[hs.messages.length - 1];
    checker.equals('first ready sends settings without ping', lastMsg.type, 'settings');

    // Subsequent ready messages must be completely ignored (no ping-pong loop)
    hs.dispatchMain('ready', {});
    hs.dispatchMain('ready', {});
    checker.equals('subsequent ready messages trigger no further messages', hs.messages.length, countAfterFirstReady);
  })();
}

module.exports = { run };
