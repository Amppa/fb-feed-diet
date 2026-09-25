/**
 * FB Diet - Comet Module Proxy (MAIN world)
 *
 * Runs in the page's own JavaScript world at document_start, before Facebook boots, and
 * wraps the Comet module registrar (window.__d) so selected modules can have their
 * exported React component replaced by an FBDiet wrapper.
 *
 * Modelling notes (inspired by the esuit suggest-blocker proxy):
 *   - __d is intercepted with both a getter and a setter, so the hook also works when
 *     Comet assigned window.__d before this script ran.
 *   - Only factories of *registered* modules are wrapped, keeping __d fast.
 *   - The original component runs untouched; only its output is decorated. The original
 *     error is always re-thrown so Facebook keeps its own error reporting.
 *   - Deliberately no eval / new Function / inline <script>: this script only patches
 *     live objects, so the Facebook page CSP cannot block it (unlike the reference
 *     implementation, which rewrites module source strings).
 *   - Every hook runs inside try/catch: a broken hook degrades one feature instead of
 *     breaking rendering.
 *
 * Public API (window.FBDietProxy):
 *   registerComponent(moduleName, { component, definerPath, order })
 *   registerFactoryHook(moduleName, cb)
 *   createElement(React, type, props, children)
 *   getReact()
 *   isModuleLoaded(name) / getModuleArgs(name) / listRegistered() / getStats()
 *   getModuleHealth() / getErrors()
 */
window.FBDietProxy = (() => {
  'use strict';

  const EXT_ID = 'fb-diet';
  const PROXY_MARK = '__fbDietProxy';

  const registrations = new Map(); // moduleName -> entry[]
  const factoryHooks = new Map(); // moduleName -> cb[]
  const moduleArgs = new Map(); // moduleName -> last seen factory args
  const patchedModulesSet = new Set(); // moduleNames whose export was successfully replaced
  const failedModules = new Set(); // moduleNames seen but whose definerPath did not resolve
  const errors = [];
  const stats = { intercepted: 0, patched: 0, hookRuns: 0, dCalls: 0, patchedModules: [] };
  let reactCache = null;

  /* ------------------------------------------------------------------ *
   * Diagnostics
   * ------------------------------------------------------------------ */

  function recordError(context, error) {
    try {
      errors.push({
        context,
        message: error && error.message ? error.message : String(error),
        at: Date.now()
      });
      if (errors.length > 40) errors.shift();
    } catch (e) {
      // Diagnostics must never throw
    }
  }

  function safe(fn, fallbackValue) {
    try {
      return fn();
    } catch (e) {
      recordError('safe', e);
      return fallbackValue;
    }
  }

  /* ------------------------------------------------------------------ *
   * Generic helpers
   * ------------------------------------------------------------------ */

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

  /**
   * Resolves React from the module loader. Only called while rendering, so the loader
   * is guaranteed to be ready by then.
   */
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

  /**
   * Creates a React element through whichever factory the runtime exposes.
   * Used by this module and by src/inject/fold.js.
   */
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
/* ------------------------------------------------------------------ *
   * Comet module argument inspection
   * ------------------------------------------------------------------ */

  // __d has been observed in two shapes across Comet builds:
  //   __d(factory, moduleName, dependencies, ...)          (canonical)
  //   __d(moduleName, extId, factory, dependencies, ...)   (extension flavoured)
  // Both are supported so a Facebook reshuffle cannot silently disable the proxy.
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

  /**
   * The exports object is handed to the factory as one of its arguments. Prefer whichever
   * argument exposes .exports (the module record), then fall back to index 6, which is the
   * index the reference implementation relies on.
   */
  function findExports(args) {
    for (let i = 0; i < args.length; i += 1) {
      const candidate = args[i];
      if (!candidate || typeof candidate !== 'object') continue;
      if (candidate.exports && (typeof candidate.exports === 'object' || typeof candidate.exports === 'function')) {
        return candidate.exports;
      }
    }
    if (args[6] && (typeof args[6] === 'object' || typeof args[6] === 'function')) return args[6];
    return null;
  }

  /**
   * Resolves { container, key } for a definer path such as "[6].default" (relative to the
   * factory arguments) or "default.render" (relative to the exports object). Class methods
   * are also looked up on the prototype chain, so class components can be wrapped too.
   */
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
/* ------------------------------------------------------------------ *
   * Component wrapping
   * ------------------------------------------------------------------ */

  function wrapComponent(moduleName, entry, SourceComponent) {
    function FBDietWrappedComponent() {
      const callingArgs = Array.prototype.slice.call(arguments);
      let lastCmp;

      try {
        lastCmp = SourceComponent.apply(this, callingArgs);
      } catch (error) {
        // Facebook's own failure: report it and let the original error surface.
        recordError('source ' + moduleName, error);
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
        return lastCmp;
      }
    }

    safe(() => {
      FBDietWrappedComponent[PROXY_MARK] = true;
      FBDietWrappedComponent.displayName = 'FBDiet(' + moduleName + ')';

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
    const target = findTarget(factoryArgs, entry.definerPath);
    if (!target) {
      failedModules.add(moduleName);
      recordError('register ' + moduleName, new Error('definerPath not found: ' + entry.definerPath));
      return false;
    }

    const current = target.container[target.key];
    if (current && current[PROXY_MARK]) return true; // already wrapped

    target.container[target.key] = wrapComponent(moduleName, entry, current);
    stats.patched += 1;
    stats.patchedModules.push(moduleName + ' ' + entry.definerPath);
    patchedModulesSet.add(moduleName);
    failedModules.delete(moduleName);
    return true;
  }
function wrapFactory(moduleName, factory) {
    function FBDietFactory() {
      const factoryArgs = Array.prototype.slice.call(arguments);
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

      moduleArgs.set(moduleName, factoryArgs);
      return result;
    }

    FBDietFactory[PROXY_MARK] = true;
    return FBDietFactory;
  }

  /* ------------------------------------------------------------------ *
   * __d interception
   * ------------------------------------------------------------------ */

  function transformDArgs(args) {
    try {
      // Loader activity sample: every __d call means Facebook defined one more module.
      stats.dCalls += 1;

      if (registrations.size === 0 && factoryHooks.size === 0) return args;

      const info = readDArgs(args);
      if (!info || !info.moduleName) return args;

      if (!registrations.has(info.moduleName) && !factoryHooks.has(info.moduleName)) return args;

      const factory = args[info.factoryIndex];
      if (typeof factory !== 'function' || factory[PROXY_MARK]) return args;

      args[info.factoryIndex] = wrapFactory(info.moduleName, factory);
      stats.intercepted += 1;
      return args;
    } catch (error) {
      recordError('__d transform', error);
      return args;
    }
  }

  function createDProxy(target) {
    return new Proxy(target, {
      apply(fn, thisArg, args) {
        transformDArgs(args);
        return Reflect.apply(fn, thisArg, args);
      }
    });
  }

  function toHookable(value) {
    if (typeof value !== 'function') return value;
    if (value[PROXY_MARK]) return value;
    // Before the real loader lands Comet installs a stub; wrapping it is pointless and the
    // setter below wraps the real one as soon as it is assigned.
    if (String(value).indexOf('__d_stub') !== -1) return value;
    return createDProxy(value);
  }

  function installDDHook() {
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
    } catch (e) {
      // Frozen property: fall back to a plain assignment
      recordError('installDDHook', e);
      safe(() => {
        window.__d = toHookable(window.__d);
      }, null);
    }
  }
/* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  const api = {
    EXT_ID,

    /**
     * Registers a component that decorates a module's exported React component.
     * The component receives { payload, SourceCmp, lastCmp, callingArgs, moduleName }.
     */
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

    /**
     * Runs a callback right after a module factory executed. Used by relay.js to capture
     * the Relay store instance without rewriting any module source.
     */
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

    /**
     * Loader health for module drift detection: how many __d module definitions
     * streamed past, and which registered names the loader never defined. When
     * dCalls keeps rising while seen stays 0, Facebook renamed its modules and
     * every hook silently stopped matching.
     */
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
        registered: registrations.size,
        seen,
        patched: patchedModulesSet.size,
        unseen,
        failed
      };
    },

    getStats() {
      return Object.assign({}, stats, { patchedModules: stats.patchedModules.slice(0, 20) });
    },

    getErrors() {
      return errors.slice();
    },

    installDDHook
  };

  installDDHook();

  return api;
})();
