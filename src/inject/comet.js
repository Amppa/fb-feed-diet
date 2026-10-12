/**
 * Comet module hook (MAIN world): wraps window.__d to decorate exports.
 * No eval / new Function: patches live objects so page CSP cannot block it.
 * Hard disable leaves window.__d untouched; re-enable needs reload.
 * Public API: window.FBDietComet (registerComponent, registerFactoryHook, health).
 */
window.FBDietComet = (() => {
  'use strict';

  const EXT_ID = 'fb-diet';
  const COMET_MARK = '__fbDietComet';

  const registrations = new Map(); // moduleName -> entry[]
  const factoryHooks = new Map(); // moduleName -> cb[]
  const moduleArgs = new Map(); // moduleName -> last seen factory args
  const patchedModulesSet = new Set(); // moduleNames whose export was successfully replaced
  const failedModules = new Set(); // moduleNames seen but whose definerPath did not resolve
  const fusedModules = new Set(); // moduleNames we deliberately stepped out of (fused === retired in ADR Decision #59)
  const errors = [];
  const MAX_PATCHED_LOG = 40;
  const stats = { intercepted: 0, patched: 0, hookRuns: 0, dCalls: 0, patchedModules: [] };
  let reactCache = null;

  // Hard disable: master switch read from localStorage cache (bridge.js writes it).
  const defs = (typeof window !== 'undefined' && window.FB_DIET_DEFAULTS) || (typeof globalThis !== 'undefined' && globalThis.FB_DIET_DEFAULTS) || {};
  const SETTINGS_CACHE_KEY = defs.SETTINGS_CACHE_KEY || 'fb_diet_settings_cache';
  const hookState = { active: false };

  // Interception ladder. One localStorage key, read once at load, picks
  // the rung so a live page can be bisected without a rebuild:
  //   passthrough - __d untouched (native control)
  //   proxyonly   - __d proxied, no factory replaced
  //   noregister  - factories wrapped and run faithfully, export never replaced
  //   element     - export replaced, source component rendered as a child element
  //   (unset)     - production path: export replaced, component called directly
  const DIAG_MODE_KEY = 'fb_diet_diag_mode';
  const DIAG_MODES = { passthrough: true, proxyonly: true, noregister: true, element: true };
  const DIAG_MODE = safe(() => {
    const raw = window.localStorage && window.localStorage.getItem(DIAG_MODE_KEY);
    return DIAG_MODES[raw] ? raw : null;
  }, null);

  /** Only explicit enabled:false disables; missing/corrupt fails open. */
  function isHardDisabled() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_CACHE_KEY);
      if (!raw) return false;
      const cached = JSON.parse(raw);
      return Boolean(cached) && typeof cached === 'object' && cached.enabled === false;
    } catch (e) {
      return false;
    }
  }

  // Diagnostics

  function recordError(context, error) {
    try {
      errors.push({
        context,
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack ? String(error.stack).slice(0, 300) : null,
        at: Date.now()
      });
      if (errors.length > 40) errors.shift();
    } catch (e) {
    }
  }

  // Diagnostic channel: lifecycle and crash context, forwarded to the persisted log
  // through bridge.postDiagnostic. Pure observation - nothing here gates, counts or
  // swallows; errors keep propagating exactly as they would without it.
  const DIAG_RING_MAX = 50;
  const DIAG_ERROR_MAX_PER_KEY = 5;
  const diagRing = [];
  const diagErrorCounts = new Map();
  const renderCounts = new Map(); // moduleName -> wrapper invocations
  // Retained for on-demand dump APIs; memory footprint is strictly bounded to the FEED_UNIT_MODULES registry size (~15 items).
  const sourceComponents = new Map(); // moduleName -> original component, for on-demand source dumps
  const sourceFactories = new Map(); // moduleName -> original definer factory
  const factoryDiagDone = new Set(); // moduleName -> factory event already emitted

  function currentPathname() {
    return safe(() => (window.location && window.location.pathname) || null, null);
  }

  /** Evaluates whether pathname is in fold scope for diagnostics. See Decision #59. */
  function foldScopeFor(pathname) {
    return safe(() => {
      const defaults = window.FB_DIET_DEFAULTS;
      if (!defaults || typeof defaults.isFoldScopeAllowed !== 'function') return null;
      return defaults.isFoldScopeAllowed(pathname);
    }, null);
  }

  /**
   * Retry loops rethrow through React's own error description path, so `reason` is often
   * the secondary error. `error.cause` is where the original failure survives.
   */
  function describeCause(error) {
    return safe(() => {
      const cause = error && error.cause;
      if (!cause) return { message: null, stack: null };
      return {
        message: String(cause.message || cause).slice(0, 200),
        stack: cause.stack ? String(cause.stack).slice(0, 300) : null
      };
    }, { message: null, stack: null });
  }

  /**
   * Mirrors definer arity (`length`) and `name` so the host loader injects all dependencies.
   * Host loader sizes dependency injection strictly by target.length. See Decision #59.
   */
  function mirrorFunctionMetadata(target, source) {
    if (typeof source !== 'function') return true;
    const mirrored = safe(() => {
      if (target.length !== source.length) {
        Object.defineProperty(target, 'length', { configurable: true, value: source.length });
      }
      return target.length === source.length;
    }, false);
    if (mirrored && source.name && target.name !== source.name) {
      safe(() => {
        Object.defineProperty(target, 'name', { configurable: true, value: source.name });
      }, null);
    }
    return mirrored;
  }

  /**
   * Graceful retirement (fuse) of one module: hands it back to the page untouched.
   * Note: "fused" in code and "retired" in ADR Decision #59 refer to the same state.
   */
  function fuseModule(moduleName, reason, detail) {
    if (fusedModules.has(moduleName)) return;
    fusedModules.add(moduleName);
    emitDiag('stand-down', {
      moduleName,
      reason,
      detail: Object.assign({ pathname: currentPathname() }, detail || {})
    });
  }

  /** Definer binding evidence: does the loader hand over everything the definer declares? */
  function describeFactory(factory, factoryArgs) {
    return safe(() => {
      const declared = typeof factory.length === 'number' ? factory.length : null;
      const src = safe(() => String(factory), '');
      return {
        declared,
        received: factoryArgs.length,
        arityGap: declared !== null && declared > factoryArgs.length,
        srcHead: src.slice(0, 200)
      };
    }, null);
  }

  /** Calling convention evidence: arg count plus a key sample of each object arg. */
  function describeArgs(args) {
    return safe(() => {
      const shape = [];
      for (let i = 0; i < Math.min(args.length, 3); i += 1) {
        const arg = args[i];
        const entry = { i, type: Array.isArray(arg) ? 'array' : typeof arg };
        if (arg && typeof arg === 'object') entry.keys = Object.keys(arg).slice(0, 8);
        shape.push(entry);
      }
      return { len: args.length, args: shape };
    }, null);
  }

  /** Receiver evidence: `this` shape tells a plain call from a class-instance call. */
  function describeThis(thisArg) {
    return safe(() => {
      if (thisArg === null || thisArg === undefined) return { type: String(thisArg) };
      return {
        type: typeof thisArg,
        ctor: (thisArg.constructor && thisArg.constructor.name) || null,
        own: Object.getOwnPropertyNames(thisArg).slice(0, 6)
      };
    }, null);
  }

  /** Source-component evidence: memo/forwardRef/class shape and hook-bearing markers. */
  function describeComponent(cmp) {
    return safe(() => {
      if (typeof cmp !== 'function') {
        const desc = { type: typeof cmp };
        if (cmp && typeof cmp === 'object') {
          desc.keys = Object.keys(cmp).slice(0, 6);
          if (typeof cmp.$$typeof === 'symbol') desc.$$typeof = String(cmp.$$typeof);
          if (typeof cmp.type === 'function') desc.innerName = cmp.type.name || null;
        }
        return desc;
      }
      const proto = cmp.prototype || {};
      const src = safe(() => String(cmp), '');
      return {
        type: 'function',
        name: cmp.name || null,
        argCount: typeof cmp.length === 'number' ? cmp.length : null,
        memo: Boolean(cmp.__reactMemoized),
        forwardRef: typeof cmp.$$typeof === 'symbol' && cmp.$$typeof === Symbol.for('react.forward_ref'),
        isReactComponent: Boolean(proto.isReactComponent),
        contextType: cmp.contextType !== undefined && cmp.contextType !== null,
        displayName: cmp.displayName || null,
        // Source-level identity: which React generation scheme the component was built with.
        srcLen: src.length,
        srcHead: src.slice(0, 200),
        compilerMemo: src.indexOf('memo_cache_sentinel') !== -1,
        fragile: src.indexOf('fragile') !== -1 || src.indexOf('__frags') !== -1
      };
    }, null);
  }

  /**
   * One diagnostic event. `detail` carries { moduleName?, reason?, detail? }.
   * render-error repeats (React retry loops rethrow the same message dozens of times)
   * are capped per module+message; every other kind is naturally bounded.
   */
  function emitDiag(kind, detail) {
    safe(() => {
      const payload = Object.assign({ kind }, detail);
      if (payload.detail && payload.detail.pathname !== undefined) {
        payload.detail.foldScope = foldScopeFor(payload.detail.pathname);
        payload.detail.diagMode = DIAG_MODE;
      }
      if (kind === 'render-error') {
        const key = (payload.moduleName || '') + '|' + (payload.reason || '');
        const seen = (diagErrorCounts.get(key) || 0) + 1;
        diagErrorCounts.set(key, seen);
        if (seen > DIAG_ERROR_MAX_PER_KEY) return;
        if (seen === DIAG_ERROR_MAX_PER_KEY) payload.note = 'further repeats suppressed';
      }
      diagRing.push(payload);
      if (diagRing.length > DIAG_RING_MAX) diagRing.shift();
      const bridge = window.FBDietBridge;
      if (bridge && typeof bridge.postDiagnostic === 'function') {
        bridge.postDiagnostic(payload);
      }
      if (kind === 'render-error' && typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error('[FB Diet][Comet] render-error', payload.moduleName, payload.reason, payload.detail);
      }
    }, null);
  }

  function safe(fn, fallbackValue) {
    try {
      return fn();
    } catch (e) {
      recordError('safe', e);
      return fallbackValue;
    }
  }

  // Generic helpers

  function splitPath(path) {
    return String(path || '')
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .filter((part) => part.length > 0);
  }

  function navigate(root, parts) {
    let current = root;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  function isReactNamespace(value) {
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      (typeof value.createElement === 'function' || typeof value.jsx === 'function')
    );
  }

  /** Resolves React from the module loader (called during render). */
  function getReact() {
    if (isReactNamespace(reactCache)) return reactCache;

    const value = safe(() => (typeof window.require === 'function' ? window.require('react') : null), null);
    const candidate = isReactNamespace(value)
      ? value
      : value && isReactNamespace(value.default)
        ? value.default
        : null;

    if (candidate) reactCache = candidate;
    return candidate;
  }

  /** Creates element via createElement/jsx; used by fold.js. */
  function createElement(React, type, props, children) {
    if (!React || !type) return null;
    const kids = children || [];

    if (typeof React.createElement === 'function') {
      return React.createElement.apply(null, [type, props || null].concat(kids));
    }

    if (typeof React.jsx === 'function') {
      const merged = Object.assign({}, props || {});
      if (kids.length === 1) merged.children = kids[0];
      else if (kids.length > 1) merged.children = kids;
      return React.jsx(type, merged);
    }

    return null;
  }
  // Comet module argument inspection

  // __d has canonical and extension-flavoured shapes; both supported.
  function readDArgs(args) {
    if (!args || args.length === 0) return null;

    if (typeof args[0] === 'function') {
      return { moduleName: typeof args[1] === 'string' ? args[1] : null, factoryIndex: 0 };
    }

    if (typeof args[0] === 'string') {
      for (let i = 1; i < args.length; i += 1) {
        if (typeof args[i] === 'function') return { moduleName: args[0], factoryIndex: i };
      }
    }

    return null;
  }

  /** Exports object is the factory arg exposing .exports; fallback index 6. */
  function findExports(args) {
    for (let i = 0; i < args.length; i += 1) {
      const candidate = args[i];
      if (!candidate || typeof candidate !== 'object') continue;
      const exp = safe(() => candidate.exports, null);
      if (exp && (typeof exp === 'object' || typeof exp === 'function')) {
        return exp;
      }
    }
    const fallback = safe(() => args[6], null);
    if (fallback && (typeof fallback === 'object' || typeof fallback === 'function')) return fallback;
    return null;
  }

  /** Resolves { container, key } for definer path, incl. prototype chain. */
  function resolveContainer(root, parts) {
    if (!root || parts.length === 0) return null;

    const container = parts.length === 1 ? root : navigate(root, parts.slice(0, -1));
    const key = parts[parts.length - 1];
    if (!container || (typeof container !== 'object' && typeof container !== 'function')) return null;
    if (typeof container[key] === 'function') return { container, key };

    let proto = typeof container === 'function' ? container.prototype : Object.getPrototypeOf(container);
    let depth = 0;
    while (proto && proto !== Object.prototype && depth < 6) {
      if (typeof proto[key] === 'function') return { container: proto, key };
      proto = Object.getPrototypeOf(proto);
      depth += 1;
    }

    return null;
  }

  function findTarget(factoryArgs, definerPath) {
    const parts = splitPath(definerPath);
    if (parts.length === 0) return null;

    if (/^\d+$/.test(parts[0])) {
      const direct = resolveContainer(factoryArgs, parts);
      if (direct) return direct;
    }

    const exportsObject = findExports(factoryArgs);
    if (exportsObject) {
      return resolveContainer(exportsObject, /^\d+$/.test(parts[0]) ? parts.slice(1) : parts);
    }

    return null;
  }
  // Component wrapping

  function wrapComponent(moduleName, entry, SourceComponent) {
    sourceComponents.set(moduleName, SourceComponent);

    function FBDietWrappedComponent() {
      // Fused: forward natively; errors propagate untouched to host boundaries.
      if (fusedModules.has(moduleName)) return SourceComponent.apply(this, arguments);

      const callingArgs = Array.prototype.slice.call(arguments);
      let lastCmp;

      const invocation = (renderCounts.get(moduleName) || 0) + 1;
      renderCounts.set(moduleName, invocation);
      if (invocation === 1) {
        emitDiag('render', {
          moduleName,
          detail: {
            pathname: currentPathname(),
            args: describeArgs(callingArgs),
            thisArg: describeThis(this),
            component: describeComponent(SourceComponent)
          }
        });
      }

      // Ladder 'element' rung: renders as child element to test fiber isolation. See docs/debugging.md.
      if (DIAG_MODE === 'element') {
        const React = getReact();
        const asElement = React ? createElement(React, SourceComponent, callingArgs[0] || {}, []) : null;
        if (asElement) return asElement;
      }

      try {
        lastCmp = SourceComponent.apply(this, callingArgs);
      } catch (error) {
        recordError('source ' + moduleName, error);
        const cause = describeCause(error);
        emitDiag('render-error', {
          moduleName,
          reason: error && error.message ? error.message : String(error),
          detail: {
            pathname: currentPathname(),
            invocation,
            stage: 'source',
            args: describeArgs(callingArgs),
            thisArg: describeThis(this),
            component: describeComponent(SourceComponent),
            stack: error && error.stack ? String(error.stack).slice(0, 500) : null,
            cause: cause.message,
            causeStack: cause.stack
          }
        });
        // Fused on first source error. Error re-throws to preserve native error boundary.
        fuseModule(moduleName, 'source-error', { invocation });
        throw error;
      }

      try {
        const React = getReact();
        if (!React) return lastCmp;

        const element = createElement(
          React,
          entry.component,
          {
            payload: callingArgs[0],
            SourceCmp: SourceComponent,
            lastCmp,
            callingArgs,
            moduleName,
            entryIndex: entry.index
          },
          []
        );

        return element || lastCmp;
      } catch (error) {
        recordError('wrapper ' + moduleName, error);
        emitDiag('render-error', {
          moduleName,
          reason: 'wrapper: ' + (error && error.message ? error.message : String(error)),
          detail: {
            pathname: currentPathname(),
            invocation,
            stage: 'wrapper',
            stack: error && error.stack ? String(error.stack).slice(0, 500) : null
          }
        });
        return lastCmp;
      }
    }

    safe(() => {
      FBDietWrappedComponent[COMET_MARK] = true;
      FBDietWrappedComponent.displayName = 'FBDiet(' + moduleName + ')';
    }, null);

    // Stand-down if arity cannot be proven transparent to React.
    if (!mirrorFunctionMetadata(FBDietWrappedComponent, SourceComponent)) {
      fuseModule(moduleName, 'mirror-failed');
      return null;
    }

    safe(() => {
      // Keep statics (contextType, defaultProps, ...) so React keeps behaving the same
      for (const key of Object.getOwnPropertyNames(SourceComponent)) {
        if (key === 'length' || key === 'name' || key === 'prototype' || key === 'displayName') continue;
        try {
          FBDietWrappedComponent[key] = SourceComponent[key];
        } catch (e) {
          // Read-only static: nothing we can do, and React does not need it
        }
      }
    }, null);

    return FBDietWrappedComponent;
  }

  function applyRegistration(moduleName, entry, factoryArgs) {
    // A fused module keeps its native export.
    if (fusedModules.has(moduleName)) return false;

    // Ladder 'noregister' rung: keeps native export to isolate factory vs component wrappers.
    if (DIAG_MODE === 'noregister') {
      emitDiag('skip', {
        moduleName,
        reason: 'noregister',
        detail: { pathname: currentPathname(), definerPath: entry.definerPath }
      });
      return false;
    }

    const target = findTarget(factoryArgs, entry.definerPath);
    if (!target) {
      failedModules.add(moduleName);
      recordError('register ' + moduleName, new Error('definerPath not found: ' + entry.definerPath));
      return false;
    }

    const current = target.container[target.key];
    if (current && current[COMET_MARK]) return true; // already wrapped

    const wrapped = wrapComponent(moduleName, entry, current);
    if (!wrapped) return false;

    target.container[target.key] = wrapped;
    stats.patched += 1;
    if (stats.patchedModules.length < MAX_PATCHED_LOG) stats.patchedModules.push(moduleName + ' ' + entry.definerPath);
    patchedModulesSet.add(moduleName);
    failedModules.delete(moduleName);
    emitDiag('patched', {
      moduleName,
      detail: {
        definerPath: entry.definerPath,
        pathname: currentPathname(),
        // Which FB chunk pulled this module in - the requiring side is what owns the
        // per-component state a replaced export can no longer find.
        regStack: safe(() => {
          const trace = new Error().stack;
          return trace ? String(trace).slice(0, 300) : null;
        }, null)
      }
    });
    return true;
  }
function wrapFactory(moduleName, factory) {
    sourceFactories.set(moduleName, factory);
    if (fusedModules.has(moduleName)) return factory;

    function FBDietFactory() {
      const factoryArgs = Array.prototype.slice.call(arguments);
      if (!factoryDiagDone.has(moduleName)) {
        factoryDiagDone.add(moduleName);
        const shape = describeFactory(factory, factoryArgs);
        emitDiag('factory', {
          moduleName,
          detail: Object.assign({ pathname: currentPathname() }, shape)
        });
        // Stand-down if loader injected fewer arguments than the definer declared.
        if (shape && shape.arityGap) {
          fuseModule(moduleName, 'definer-arity', { declared: shape.declared, received: shape.received });
        }
      }
      const result = factory.apply(this, factoryArgs);

      const hooks = factoryHooks.get(moduleName);
      if (hooks) {
        for (const hook of hooks) {
          try {
            hook({ moduleName, exports: findExports(factoryArgs), args: factoryArgs });
            stats.hookRuns += 1;
          } catch (error) {
            recordError('factoryHook ' + moduleName, error);
          }
        }
      }

      const entries = registrations.get(moduleName);
      if (entries) {
        for (const entry of entries) {
          try {
            applyRegistration(moduleName, entry, factoryArgs);
          } catch (error) {
            recordError('register ' + moduleName, error);
          }
        }
      }

      // Retaining factory args pins module closures: keep only watched modules.
      // Defensive invariant: registrations/factoryHooks are grow-only, no uninstall.
      if (registrations.has(moduleName) || factoryHooks.has(moduleName)) {
        moduleArgs.set(moduleName, factoryArgs);
      }
      return result;
    }

    FBDietFactory[COMET_MARK] = true;
    // Stand-down if factory arity cannot be mirrored faithfully.
    if (!mirrorFunctionMetadata(FBDietFactory, factory)) {
      fuseModule(moduleName, 'mirror-failed');
      return factory;
    }
    return FBDietFactory;
  }

  // __d interception

  function transformDArgs(args) {
    try {
      stats.dCalls += 1;

      // Ladder 'proxyonly' rung: passes every call untouched to isolate Proxy behavior.
      if (DIAG_MODE === 'proxyonly') return args;

      if (registrations.size === 0 && factoryHooks.size === 0) return args;

      const info = readDArgs(args);
      if (!info || !info.moduleName) return args;

      if (!registrations.has(info.moduleName) && !factoryHooks.has(info.moduleName)) return args;

      const factory = args[info.factoryIndex];
      if (typeof factory !== 'function' || factory[COMET_MARK]) return args;

      const wrappedFactory = wrapFactory(info.moduleName, factory);
      if (wrappedFactory === factory) return args; // fused: the page keeps its own definer
      args[info.factoryIndex] = wrappedFactory;
      stats.intercepted += 1;
      return args;
    } catch (error) {
      recordError('__d transform', error);
      return args;
    }
  }

  function createDProxy(target) {
    const proxy = new Proxy(target, {
      get(fn, prop, receiver) {
        if (prop === COMET_MARK) return true;
        return Reflect.get(fn, prop, receiver);
      },
      apply(fn, thisArg, args) {
        transformDArgs(args);
        return Reflect.apply(fn, thisArg, args);
      }
    });
    safe(() => {
      Object.defineProperty(target, COMET_MARK, { value: true, configurable: true });
    }, null);
    return proxy;
  }

  function toHookable(value) {
    if (typeof value !== 'function') return value;
    if (value[COMET_MARK]) return value;
    // Comet stub left alone until real loader lands.
    if (String(value).indexOf('__d_stub') !== -1) return value;
    return createDProxy(value);
  }

  function installDDHook() {
    if (hookState.active) return true;

    let current = toHookable(window.__d);

    try {
      Object.defineProperty(window, '__d', {
        configurable: true,
        get() {
          return current;
        },
        set(value) {
          current = toHookable(value);
        }
      });
      hookState.active = true;
    } catch (e) {
      recordError('installDDHook', e);
      hookState.active = safe(() => {
        window.__d = toHookable(window.__d);
        return true;
      }, false);
    }
    return hookState.active;
  }
  // Public API

  const api = {
    EXT_ID,

    /** Registers decorator component for a module's exported React component. */
    registerComponent(moduleName, options) {
      if (typeof moduleName !== 'string' || !moduleName) return false;
      const source = options || {};
      if (typeof source.component !== 'function') return false;

      const entry = {
        component: source.component,
        definerPath: source.definerPath || '[6].default',
        order: typeof source.order === 'number' ? source.order : 10,
        extensionId: source.extensionId || EXT_ID,
        index: 0
      };

      const list = registrations.get(moduleName) || [];
      entry.index = list.length;
      list.push(entry);
      list.sort((a, b) => a.order - b.order);
      registrations.set(moduleName, list);

      // The module may already be defined (cheap to support, matters for late re-arming)
      const existingArgs = moduleArgs.get(moduleName);
      if (existingArgs) {
        try {
          applyRegistration(moduleName, entry, existingArgs);
        } catch (error) {
          recordError('late register ' + moduleName, error);
        }
      }

      return true;
    },

    /** Runs callback after module factory executes (Relay store capture). */
    registerFactoryHook(moduleName, callback) {
      if (typeof moduleName !== 'string' || !moduleName || typeof callback !== 'function') return false;
      const list = factoryHooks.get(moduleName) || [];
      list.push(callback);
      factoryHooks.set(moduleName, list);
      return true;
    },

    getReact,
    createElement,

    isModuleLoaded(moduleName) {
      return moduleArgs.has(moduleName);
    },

    getModuleArgs(moduleName) {
      return moduleArgs.get(moduleName) || null;
    },

    listRegistered() {
      const out = {};
      for (const [moduleName, entries] of registrations) {
        out[moduleName] = entries.map((entry) => entry.definerPath);
      }
      return out;
    },

    /** Loader health: dCalls vs seen/unseen; rising dCalls with seen 0 means rename. */
    getModuleHealth() {
      const unseen = [];
      const failed = [];
      let seen = 0;
      for (const moduleName of registrations.keys()) {
        if (moduleArgs.has(moduleName)) {
          seen += 1;
          if (failedModules.has(moduleName)) failed.push(moduleName);
        } else {
          unseen.push(moduleName);
        }
      }
      return {
        dCalls: stats.dCalls,
        loaderActive: stats.dCalls > 0,
        hookActive: hookState.active,
        registered: registrations.size,
        seen,
        patched: patchedModulesSet.size,
        unseen,
        failed,
        fused: Array.from(fusedModules)
      };
    },

    getStats() {
      return Object.assign({}, stats, {
        patchedModules: stats.patchedModules.slice(0, 20),
        hookActive: hookState.active
      });
    },

    getErrors() {
      return errors.slice();
    },

    getRecentDiag() {
      return diagRing.slice();
    },

    /**
     * Debug helper: the untouched source of a wrapped module's original component, for
     * `copy(FBDietComet.dumpComponentSource('X.react').source)` on a live page. On demand
     * and uncapped-by-design so nothing worth reading is lost; never stored or forwarded.
     */
    dumpComponentSource(moduleName) {
      const cmp = sourceComponents.get(moduleName);
      if (typeof cmp !== 'function') return null;
      return safe(() => {
        const src = String(cmp);
        return {
          moduleName,
          name: cmp.name || null,
          argCount: typeof cmp.length === 'number' ? cmp.length : null,
          ownKeys: Object.getOwnPropertyNames(cmp),
          source: src.slice(0, 60000),
          truncated: src.length > 60000
        };
      }, null);
    },

    /**
     * Debug helper: the definer that produced this module, with its declared arity. Compare
     * `declared` against the `factory` diag's `received` to see whether the loader bound every
     * parameter the module expects.
     */
    dumpFactorySource(moduleName) {
      const factory = sourceFactories.get(moduleName);
      if (typeof factory !== 'function') return null;
      return safe(() => {
        const src = String(factory);
        return {
          moduleName,
          name: factory.name || null,
          declared: typeof factory.length === 'number' ? factory.length : null,
          source: src.slice(0, 60000),
          truncated: src.length > 60000
        };
      }, null);
    }
  };

  /**
   * Navigation timeline: SPA pathname transitions, so later render/render-error events
   * can be correlated with the route they happened on. Transparent wrapper: the original
   * method still runs with the same receiver and arguments and its result is returned.
   */
  function installNavigationTracking() {
    safe(() => {
      const hist = window.history;
      if (!hist || typeof hist.pushState !== 'function' || typeof hist.replaceState !== 'function') return;
      ['pushState', 'replaceState'].forEach((method) => {
        const original = hist[method];
        if (!original || original.__fbDietNav) return;
        const wrapped = function () {
          const before = currentPathname();
          const result = original.apply(this, arguments);
          const after = currentPathname();
          if (before !== after) {
            emitDiag('nav', { reason: 'history.' + method, detail: { from: before, to: after } });
          }
          return result;
        };
        mirrorFunctionMetadata(wrapped, original);
        try {
          Object.defineProperty(wrapped, '__fbDietNav', { value: true });
        } catch (e) {}
        try {
          hist[method] = wrapped;
        } catch (e) {
          recordError('nav ' + method, e);
        }
      });
      window.addEventListener('popstate', () => {
        emitDiag('nav', { reason: 'popstate', detail: { to: currentPathname() } });
      });
    }, null);
  }

  // Hard disable: switch off leaves __d untouched; registrations stay inert.
  // passthrough does the same on purpose, as the native control rung of the debug ladder.
  if (!isHardDisabled() && DIAG_MODE !== 'passthrough') {
    installDDHook();
    installNavigationTracking();
  }
  // Ring-only boot line for live inspection; the persisted log gets its boot line from
  // bridge.js, which loads after this module (manifest order) and can actually post it.
  emitDiag('boot', {
    detail: {
      pathname: currentPathname(),
      hardDisabled: isHardDisabled(),
      hookActive: hookState.active
    }
  });
  // The key is read-only for us and only exists once somebody sets it deliberately, but a rung
  // left behind changes behaviour permanently with nothing in the UI to show for it. Say so on
  // the console - and only then, because a healthy page has nothing to report.
  if (DIAG_MODE) {
    safe(() => {
      console.info(
        '[FB Diet] Debug rung active: "' + DIAG_MODE + '". It overrides normal behaviour for this ' +
        'page. Undo with: localStorage.removeItem("' + DIAG_MODE_KEY + '")'
      );
    }, null);
  }

  return api;
})();
