'use strict';
/**
 * FB Diet - shared Node test harness
 *
 * The MAIN world scripts run against Facebook's own module loader, which cannot be
 * exercised from Node. This harness therefore emulates the only parts the scripts touch:
 * window, postMessage/addEventListener, require('react') and a Comet-style __d loader.
 *
 * Deliberately dependency free: run with `node tests/run.js`.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// Manifest loading order of the MAIN world scripts
const INJECT_ORDER = ['proxy.js', 'relay.js', 'metadata.js', 'classify.js', 'bridge.js', 'dom-metadata.js', 'dom-suggested.js', 'ui.js', 'probe.js', 'fold.js'];

class Checker {
  constructor(title) {
    this.title = title;
    this.passed = 0;
    this.failed = [];
    console.log('\n=== ' + title + ' ===');
  }

  ok(label, condition, detail) {
    if (condition) {
      this.passed += 1;
      console.log('  PASS - ' + label);
    } else {
      this.failed.push(label);
      console.log('  FAIL - ' + label + (detail ? ' (' + detail + ')' : ''));
    }
    return Boolean(condition);
  }

  equals(label, actual, expected) {
    return this.ok(
      label,
      actual === expected,
      'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)
    );
  }

  report() {
    console.log('\n' + this.title + ': ' + this.passed + ' passed, ' + this.failed.length + ' failed');
    if (this.failed.length) {
      console.log('FAILED: ' + this.failed.join(', '));
      process.exitCode = 1;
    }
    return this.failed.length === 0;
  }
}

/**
 * Minimal React replacement: elements are plain objects and useState keeps a per-render
 * cursor so hook order can be asserted.
 */
function createFakeReact() {
  const state = { values: [], cursor: 0, refs: [], refCursor: 0 };

  const React = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props) {
      const children = Array.prototype.slice.call(arguments, 2);
      const merged = Object.assign({}, props || {});
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return { type, props: merged };
    },
    useState(initial) {
      const index = state.cursor;
      state.cursor += 1;
      if (!(index in state.values)) {
        state.values[index] = typeof initial === 'function' ? initial() : initial;
      }
      return [
        state.values[index],
        (next) => {
          state.values[index] = next;
        }
      ];
    },
    useRef(initial) {
      const index = state.refCursor;
      state.refCursor += 1;
      if (!(index in state.refs)) {
        state.refs[index] = { current: initial !== undefined ? initial : null };
      }
      return state.refs[index];
    },
    useEffect(cb) {
      try { cb(); } catch (e) {}
    },
    useLayoutEffect(cb) {
      try { cb(); } catch (e) {}
    }
  };

  React.resetHooks = () => {
    state.cursor = 0;
    state.refCursor = 0;
  };

  return React;
}

/* ------------------------------------------------------------------ *
 * Window + injection helpers
 * ------------------------------------------------------------------ */

/** Bare window double with postMessage + DOM event capture (MAIN world style). */
function createWindow() {
  const win = {
    location: { origin: 'https://www.facebook.com', href: 'https://www.facebook.com/' },
    __messages: [],
    __listeners: {},
    __events: [],
    postMessage(data) {
      win.__messages.push(data);
    },
    addEventListener(type, cb) {
      (win.__listeners[type] = win.__listeners[type] || []).push(cb);
    },
    removeEventListener() {},
    dispatchEvent(event) {
      win.__events.push(event);
      for (const cb of win.__listeners[event.type] || []) cb(event);
      return true;
    },
    CustomEvent: function CustomEvent(type, params) {
      this.type = type;
      this.detail = params && params.detail;
    }
  };
  win.window = win;
  win.self = win;
  return win;
}

/** Loads one src/inject script into a fresh vm context that only shares `window`. */
function loadInject(win, file) {
  const code = fs.readFileSync(path.join(ROOT, 'src', 'inject', file), 'utf8');
  const sandbox = { window: win, console, CustomEvent: win.CustomEvent };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'src/inject/' + file });
}

/**
 * Loads src/shared/defaults.js into a fresh vm context and returns the exposed
 * FB_DIET_DEFAULTS object. Lets tests inject the real defaults (e.g. the fold-scope
 * allowlist) into a window double that was created without them.
 */
function loadDefaults() {
  const code = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'defaults.js'), 'utf8');
  const sandbox = { globalThis: {} };
  sandbox.globalThis.globalThis = sandbox.globalThis;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'src/shared/defaults.js' });
  return sandbox.globalThis.FB_DIET_DEFAULTS;
}

/**
 * Minimal Comet loader. Supports both __d argument shapes; require() executes the
 * stored factory with the canonical 7 arguments (index 6 = exports object, matching
 * definerPath "[6].default").
 */
function createFakeComet(win, fakeReact) {
  const records = new Map();
  const defined = [];

  const originalD = function (...args) {
    let factory = null;
    let moduleName = null;
    for (const arg of args) {
      if (typeof arg === 'function' && !factory) factory = arg;
      else if (typeof arg === 'string' && !moduleName) moduleName = arg;
    }
    const exportsObj = args.length > 6 ? args[6] : null;
    if (factory && moduleName) {
      defined.push(moduleName);
      records.set(moduleName, { factory, args, exportsObj });
    }
  };

  // Assigned before the proxy loads; proxy.js swaps it through its property hook.
  win.__d = originalD;

  const loader = {
    records,
    defined,
    require(moduleName) {
      if (moduleName === 'react') return fakeReact;
      const record = records.get(moduleName);
      if (!record) throw new Error('module not defined: ' + moduleName);
      const args = new Array(7).fill(null);
      args[0] = loader.require;
      args[1] = { exports: record.exportsObj || {} };
      args[6] = record.exportsObj;
      return record.factory.apply(null, args);
    },
    getExport(moduleName) {
      const record = records.get(moduleName);
      return record ? record.exportsObj : null;
    }
  };
  win.require = loader.require;
  return loader;
}

/** Counts messages of one type posted by the MAIN world (excluding settings-applied). */
function countMessages(win, type) {
  return win.__messages.filter((m) => m && m.type === type).length;
}

module.exports = {
  Checker,
  createFakeReact,
  createWindow,
  loadInject,
  loadDefaults,
  createFakeComet,
  countMessages,
  ROOT
};