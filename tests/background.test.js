'use strict';
/**
 * Focused contract tests for src/background/background.js.
 *
 * The service worker only talks to chrome.*, so it is loaded into a vm with a minimal chrome
 * double: install / storage / runtime / tabs / scripting listeners are captured so the test can
 * drive them, and FB_DIET_DEFAULTS is injected the way the real `importScripts` call would —
 * including the case where that call silently failed.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, loadDefaults } = require('./harness');

// The service worker fires pushSettingsToFacebookTabs() without awaiting it (a tab push must not
// block the storage event), so a test has to let that work settle before asserting on it.
const settle = () => new Promise((resolve) => setImmediate(resolve));

function createHarness(options = {}) {
  const storage = Object.assign({}, options.storage || {});
  const listeners = { installed: [], changed: [], message: [] };
  const executed = [];
  const writes = [];

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (key in storage) out[key] = storage[key];
          return out;
        },
        set(values, callback) {
          writes.push(values);
          Object.assign(storage, values);
          if (typeof callback === 'function') callback();
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener(callback) {
          listeners.changed.push(callback);
        }
      }
    },
    runtime: {
      onInstalled: {
        addListener(callback) {
          listeners.installed.push(callback);
        }
      },
      onMessage: {
        addListener(callback) {
          listeners.message.push(callback);
        }
      },
      getManifest() {
        if (options.manifestThrows) throw new Error('no manifest in this context');
        return { version: options.manifestVersion || '9.9.9' };
      }
    },
    tabs: {
      async query() {
        return options.tabs || [];
      }
    },
    scripting: {
      async executeScript(details) {
        executed.push(details);
        if (options.scriptThrows) throw new Error('this page cannot be injected');
        return options.scriptResult === undefined ? [] : [{ result: options.scriptResult }];
      }
    }
  };

  const sandbox = {
    chrome,
    console: { log() {}, info() {}, warn() {}, error() {} },
    Date,
    importScripts() {}
  };
  sandbox.globalThis = sandbox;
  if (!options.withoutDefaults) sandbox.FB_DIET_DEFAULTS = loadDefaults();

  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'src', 'background', 'background.js'), 'utf8'),
    sandbox,
    { filename: 'src/background/background.js' }
  );

  return { chrome, sandbox, storage, listeners, executed, writes };
}

async function run(c) {
  const t = createHarness({ tabs: [{ id: 7 }, { id: 'no-numeric-id' }] });
  const defaults = t.sandbox.FB_DIET_DEFAULTS;
  c.equals('background registers an install listener', t.listeners.installed.length, 1);
  c.equals('background registers one storage listener', t.listeners.changed.length, 1);
  c.equals('background registers one message listener', t.listeners.message.length, 1);

  /* --- install bootstrap --- */
  await t.listeners.installed[0]();
  await settle();
  c.equals('install writes defaults merged with stored settings', t.storage.settings.dietMode, defaults.SETTINGS.dietMode);
  c.equals('install seeds the default counter row', t.storage.counts.ads, defaults.COUNTS.ads);
  c.equals('install pushes settings to the numeric tab only', t.executed.length, 1);
  c.equals('the push targets that tab', t.executed[0].target.tabId, 7);
  c.equals('the push runs in the MAIN world', t.executed[0].world, 'MAIN');
  c.equals('the push carries the merged settings', t.executed[0].args[0].dietMode, defaults.SETTINGS.dietMode);

  /* --- one settings write produces exactly one fan-out --- */
  const before = t.executed.length;
  t.listeners.changed[0]({ settings: { newValue: { dietMode: 'lite' } } }, 'local');
  await settle();
  c.equals('a local settings change pushes once', t.executed.length, before + 1);
  c.equals('the pushed payload is the new settings object', t.executed[before].args[0].dietMode, 'lite');
  t.listeners.changed[0]({ counts: { newValue: {} } }, 'local');
  await settle();
  c.equals('a counts change pushes nothing', t.executed.length, before + 1);
  t.listeners.changed[0]({ settings: { newValue: {} } }, 'sync');
  await settle();
  c.equals('a non-local settings change pushes nothing', t.executed.length, before + 1);

  /* --- RESET_COUNTS answers with a full row for today --- */
  const response = await new Promise((resolve) => {
    const kept = t.listeners.message[0]({ type: 'RESET_COUNTS' }, {}, resolve);
    c.equals('the reset handler keeps the response channel open', kept, true);
  });
  c.equals('reset reports success', response.success, true);
  c.equals('reset uses the shared date helper', response.counts.date, defaults.getTodayDateString());
  c.equals(
    'reset returns every counter group',
    Object.keys(defaults.COUNTS).sort().join(','),
    Object.keys(response.counts).sort().join(',')
  );
  c.equals('reset persisted the row', t.storage.counts.date, response.counts.date);
  c.equals('an unknown message is ignored', t.listeners.message[0]({ type: 'GET_DATA' }, {}, () => {}), undefined);

  /* --- GET_TAB_STATE: one-shot read of the page's hook capability --- */
  const ask = (harness, message) =>
    new Promise((resolve) => {
      const kept = harness.listeners.message[0](message, {}, resolve);
      c.equals('the tab state handler keeps the response channel open', kept, true);
    });

  {
    const h = createHarness();
    const state = await ask(h, { type: 'GET_TAB_STATE', tabId: 12 });
    c.equals('the read targets that tab', h.executed[0].target.tabId, 12);
    c.equals('the read runs in the MAIN world', h.executed[0].world, 'MAIN');
    c.ok('the read function is self-contained (no closure)', typeof h.executed[0].func === 'function' && h.executed[0].func.length === 0);
    c.equals('an empty injection result is not a state', state.available, false);
  }
  {
    const h = createHarness({ scriptResult: { available: true, hookActive: false, installFailed: false } });
    const state = await ask(h, { type: 'GET_TAB_STATE', tabId: 12 });
    c.equals('a hook-less page is reported as such', state.hookActive, false);
    c.equals('the read stays available', state.available, true);
    c.equals('no install error is invented', state.installFailed, false);
    c.equals('a page with no version cannot be stale', state.staleBuild, false);
  }
  {
    const h = createHarness({ scriptThrows: true });
    const state = await ask(h, { type: 'GET_TAB_STATE', tabId: 12 });
    c.equals('an uninjected tab answers unavailable', state.available, false);
  }
  {
    const h = createHarness();
    const state = await ask(h, { type: 'GET_TAB_STATE' });
    c.equals('a state read without a tab id is unavailable', state.available, false);
    c.equals('and nothing is injected', h.executed.length, 0);
  }

  /* --- a tab that outlived an update is told so instead of looking healthy --- */
  {
    const h = createHarness({ manifestVersion: '2.8.3', scriptResult: { present: true, version: '2.8.2', available: true, hookActive: true, installFailed: false } });
    const state = await ask(h, { type: 'GET_TAB_STATE', tabId: 12 });
    c.equals('the installed build is reported back', state.extensionVersion, '2.8.3');
    c.equals('a page running the old build is stale', state.staleBuild, true);
    c.equals('both versions travel with the answer', state.version + ' → ' + state.extensionVersion, '2.8.2 → 2.8.3');
    c.equals('a stale page keeps its own hook state', state.hookActive, true);
  }
  {
    // A tab the extension never reached at all: no code, so no version to disagree with.
    const h = createHarness({ manifestVersion: '2.8.3', scriptResult: { present: false, version: null, available: false } });
    const state = await ask(h, { type: 'GET_TAB_STATE', tabId: 12 });
    c.equals('a page with no FB Diet code says so', state.present, false);
    c.equals('and is not called stale for it', state.staleBuild, false);
  }
  {
    const h = createHarness({ manifestThrows: true, scriptResult: { present: true, version: '2.8.2', available: true, hookActive: true, installFailed: false } });
    const state = await ask(h, { type: 'GET_TAB_STATE', tabId: 12 });
    c.equals('an unreadable manifest reports no live version', state.extensionVersion, null);
    c.equals('and never invents a mismatch', state.staleBuild, false);
  }

  /* --- fail-open when defaults.js never loaded (importScripts swallows its own failure) --- */
  const bare = createHarness({ withoutDefaults: true });
  const bareResponse = await new Promise((resolve) => {
    bare.listeners.message[0]({ type: 'RESET_COUNTS' }, {}, resolve);
  });
  c.equals('reset still answers without defaults.js', bareResponse.success, true);
  c.ok('reset falls back to a YYYY-MM-DD date', /^\d{4}-\d{2}-\d{2}$/.test(bareResponse.counts.date));
}

module.exports = { run };
