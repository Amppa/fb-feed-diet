'use strict';
/**
 * The popup's status line is the only place the user is told their tab cannot fold,
 * so its precedence is contract: which fact is reported, and which facts are allowed to
 * stay silent. src/popup/popup.js is loaded for real against a minimal document double
 * and a chrome double, driven through DOMContentLoaded the way the browser does.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, loadDefaults } = require('./harness');

const FACEBOOK_TAB = { id: 7, url: 'https://www.facebook.com/feed' };

/** The five elements popup.html gives the controller, plus the two list queries it makes. */
function createDocument() {
  // popup.html ships the status line with the `hidden` attribute already on it, so "no status"
  // is the element's initial state and every failure to reach a branch has to hide it again.
  const make = (id) => ({
    id,
    textContent: '',
    title: '',
    checked: false,
    hidden: id === 'statusLine',
    dataset: {},
    classes: [],
    listeners: {},
    classList: {
      add(name) { if (!this.owner.classes.includes(name)) this.owner.classes.push(name); },
      remove(name) { this.owner.classes = this.owner.classes.filter((x) => x !== name); },
      toggle(name, force) {
        const on = force === undefined ? !this.owner.classes.includes(name) : Boolean(force);
        if (on) this.add(name); else this.remove(name);
        return on;
      },
      contains(name) { return this.owner.classes.includes(name); }
    },
    addEventListener(type, fn) { this.listeners[type] = fn; }
  });

  const elements = {
    enabled: make('enabled'),
    totalCount: make('totalCount'),
    settingsBtn: make('settingsBtn'),
    statusLine: make('statusLine'),
    resetBtn: make('resetBtn')
  };
  // classList needs a back-reference to the element it belongs to.
  for (const el of Object.values(elements)) el.classList.owner = el;

  return {
    documentElement: { lang: 'en' },
    getElementById: (id) => elements[id] || null,
    querySelectorAll: () => [],
    addEventListener(type, fn) { this.ready = fn; },
    elements
  };
}

/**
 * Drives the real popup.js once and hands back the elements it wrote to.
 * `tabState` is what the service worker answers with; `settings` what storage holds.
 */
async function openPopup(options = {}) {
  const storage = Object.assign({ settings: { enabled: options.enabled !== false, lang: options.lang || 'en' } }, options.storage);
  const doc = createDocument();

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (key in storage) out[key] = storage[key];
          return out;
        },
        async set(values) { Object.assign(storage, values); }
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (message.type === 'GET_TAB_STATE') {
          const answer = options.tabUrl && options.tabUrl !== FACEBOOK_TAB.url
            ? null
            : (options.tabState === undefined ? null : options.tabState);
          // The real API is asynchronous, so answer on a later turn like it does.
          setImmediate(() => callback(answer));
          return;
        }
        setImmediate(() => callback(null));
      }
    },
    tabs: {
      query(_query, callback) { callback([options.tab || FACEBOOK_TAB]); }
    }
  };

  const sandbox = {
    window: null,
    document: doc,
    chrome,
    console,
    navigator: { language: 'en-US' },
    setTimeout,
    clearTimeout,
    globalThis: null
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.FB_DIET_DEFAULTS = loadDefaults();
  vm.createContext(sandbox);

  for (const file of ['src/i18n/i18n.js', 'src/popup/popup.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  }
  doc.ready();
  // Two turns: the popup awaits storage, then the tab-state answer arrives.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  return doc.elements;
}

const HEALTHY = { present: true, available: true, hookActive: true, installFailed: false, version: '2.8.3', extensionVersion: '2.8.3', staleBuild: false };

async function run(c) {
  /* --- a page that can fold says nothing at all --- */
  {
    const ui = await openPopup({ tabState: HEALTHY });
    c.equals('a healthy page shows no status', ui.statusLine.hidden, true);
  }
  {
    const ui = await openPopup({ tabState: { ...HEALTHY, hookActive: false, installFailed: false }, enabled: true });
    c.equals('a page whose hook never armed says reload', ui.statusLine.textContent, 'Folding is not armed on this tab yet: reload it.');
    c.equals('and is not styled as an error', ui.statusLine.classList.contains('error'), false);
  }
  {
    const ui = await openPopup({ tabState: { ...HEALTHY, hookActive: false, installFailed: true }, enabled: true });
    c.equals('a blocked hook says so', ui.statusLine.textContent, 'Facebook blocked the module hook, please check F12.');
    c.equals('and is styled as an error', ui.statusLine.classList.contains('error'), true);
  }
  {
    const ui = await openPopup({ tabState: { ...HEALTHY, hookActive: false }, enabled: false });
    c.equals('an unarmed page under a disabled switch stays quiet', ui.statusLine.hidden, true);
  }

  /* --- a tab that survived an extension update --- */
  {
    const ui = await openPopup({
      tabState: { present: true, available: true, hookActive: true, installFailed: false, version: '2.8.2', extensionVersion: '2.8.3', staleBuild: true },
      enabled: true
    });
    c.ok('a stale build is named', ui.statusLine.textContent.indexOf('another build') !== -1, ui.statusLine.textContent);
    c.ok('and both versions are shown', ui.statusLine.textContent.indexOf('2.8.2 → 2.8.3') !== -1, ui.statusLine.textContent);
    // Field evidence, 2026-09-29: reloading the extension and hard-reloading the tab did not
    // clear it; only restarting the browser did. So the restart is the advice, not the fallback.
    c.ok('and it tells the user to restart the browser', /restart/i.test(ui.statusLine.textContent), ui.statusLine.textContent);
    c.equals('a stale build is an error, not a hint', ui.statusLine.classList.contains('error'), true);
    c.equals('a stale build is not hidden', ui.statusLine.hidden, false);
  }
  {
    // The toggle is off, but the page is still running code the installed build no longer has:
    // that keeps being true after the user turns folding on, so the warning outranks intent.
    const ui = await openPopup({
      tabState: { present: true, available: true, hookActive: true, installFailed: false, version: '2.8.2', extensionVersion: '2.8.3', staleBuild: true },
      enabled: false
    });
    c.equals('a stale build is reported even with the switch off', ui.statusLine.hidden, false);
  }

  /* --- a tab the extension never reached --- */
  {
    // This is the report that used to be silence: the popup looked healthy while the page had no
    // FB Diet code in it at all, which is what "no header, no folding, reopen the tab fixes it"
    // actually is.
    const ui = await openPopup({ tabState: { present: false, available: false, version: null, extensionVersion: '2.8.3', staleBuild: false }, enabled: true });
    c.ok('a tab with no FB Diet code says so', /never hooked/.test(ui.statusLine.textContent), ui.statusLine.textContent);
    c.ok('and leads with the browser restart, which is what was observed to work', /restart/i.test(ui.statusLine.textContent), ui.statusLine.textContent);
    c.equals('and is styled as an error', ui.statusLine.classList.contains('error'), true);
  }
  {
    const ui = await openPopup({ tabState: { present: false, available: false, version: null, extensionVersion: '2.8.3', staleBuild: false }, enabled: false });
    c.equals('with the switch off it stays quiet, as before', ui.statusLine.hidden, true);
  }

  /* --- nothing to report is never reported as broken --- */
  {
    const ui = await openPopup({ tabState: null });
    c.equals('a tab that answers nothing shows no status', ui.statusLine.hidden, true);
  }
  {
    const ui = await openPopup({ tab: { id: 7, url: 'https://example.com/' }, tabState: HEALTHY });
    c.equals('a non-Facebook tab is not asked and not warned about', ui.statusLine.hidden, true);
  }

  /* --- the two new strings exist in every language --- */
  {
    const en = await openPopup({ tabState: { present: false, available: false, version: null, extensionVersion: '2.8.3', staleBuild: false }, enabled: true, lang: 'en' });
    c.ok('English has the not-injected string', en.statusLine.textContent.length > 0);
    const zh = await openPopup({ tabState: { present: false, available: false, version: null, extensionVersion: '2.8.3', staleBuild: false }, enabled: true, lang: 'zh-TW' });
    c.ok('zh-TW has the not-injected string', zh.statusLine.textContent.indexOf('從未掛上過濾器') !== -1, zh.statusLine.textContent);
    c.ok('zh-TW names the browser restart', zh.statusLine.textContent.indexOf('重啟瀏覽器') !== -1, zh.statusLine.textContent);
    const zhStale = await openPopup({
      tabState: { present: true, available: true, hookActive: true, installFailed: false, version: '2.8.2', extensionVersion: '2.8.3', staleBuild: true },
      enabled: true,
      lang: 'zh-TW'
    });
    c.ok('zh-TW has the version-mismatch string', zhStale.statusLine.textContent.indexOf('另一個版本的外掛') !== -1, zhStale.statusLine.textContent);
  }
}

module.exports = { run };
