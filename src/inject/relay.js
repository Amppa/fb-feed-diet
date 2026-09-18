/**
 * FB Diet - Relay store reader (MAIN world)
 *
 * Feed unit metadata (sponsored_data.ad_id, subscribe_status, viewer_forum_join_state,
 * showcase_story_type, story_header) only exists inside the Relay store, not in the DOM.
 * This module captures that store so the classifier can read it.
 *
 * The reference implementation used to grab the store by rewriting the source string of
 * relay-runtime/store/RelayPublishQueue (which needs an inline <script> and is therefore
 * subject to the page CSP). FB Diet instead wraps the exported class of
 * relay-runtime/mutations/RelayRecordSourceProxy with a Proxy construct trap: every commit
 * proxy that Relay creates is remembered, with no eval and no source rewriting.
 *
 * Public API (window.FBDietRelay):
 *   read(recordIds, path, options)   -> value | null
 *   readFirst(recordIds, paths)      -> value | null
 *   isReady() / getSourceCount() / getLastError()
 */
window.FBDietRelay = (() => {
  'use strict';

  const RELAY_PROXY_MODULE = 'relay-runtime/mutations/RelayRecordSourceProxy';
  const MAX_SOURCES = 6;

  // Most recently created store proxies, newest first. Keeping a few of them means a feed
  // unit committed earlier in the session is still readable while scrolling.
  const sources = [];
  let ready = false;
  let installed = false;
  let lastError = null;

  function recordError(error) {
    lastError = error && error.message ? error.message : String(error);
  }

  function isRecordProxy(value) {
    return Boolean(value) && typeof value === 'object' && typeof value.getValue === 'function';
  }

  function rememberSource(instance) {
    if (!instance || typeof instance.get !== 'function') return;

    const index = sources.indexOf(instance);
    if (index !== -1) sources.splice(index, 1);
    sources.unshift(instance);
    if (sources.length > MAX_SOURCES) sources.length = MAX_SOURCES;
    ready = true;
  }

  /**
   * Replaces the exported constructor with a wrapping Proxy so instances can be observed.
   */
  function wrapExports(exportsObject) {
    if (!exportsObject) return;

    const Original = exportsObject.default || (typeof exportsObject === 'function' ? exportsObject : null);
    if (typeof Original !== 'function' || Original.__fbDietRelayWrapped) return;

    const Wrapped = new Proxy(Original, {
      construct(target, args, newTarget) {
        const instance = Reflect.construct(target, args, newTarget);
        try {
          rememberSource(instance);
        } catch (e) {
          recordError(e);
        }
        return instance;
      }
    });

    try {
      Object.defineProperty(Wrapped, '__fbDietRelayWrapped', { value: true });
    } catch (e) {
      // Non fatal: the guard above then simply re-wraps at most once per module load
    }

    if (typeof exportsObject.default === 'function') exportsObject.default = Wrapped;
    else if (typeof exportsObject === 'function') exportsObject.default = Wrapped;
    else exportsObject.default = Wrapped;
  }

  function install() {
    if (installed) return;
    installed = true;

    const proxy = window.FBDietProxy;
    if (!proxy || typeof proxy.registerFactoryHook !== 'function') return;

    proxy.registerFactoryHook(RELAY_PROXY_MODULE, (info) => wrapExports(info.exports));

    // A store created before the hook landed (or exposed by another extension's helper)
    // is still usable if it is reachable from the page globals.
    try {
      if (window.___rs) rememberSource(window.___rs);
    } catch (e) {
      recordError(e);
    }
  }
/* ------------------------------------------------------------------ *
   * Path reading
   *
   * Path grammar (compatible with the reference implementation):
   *   field      -> getValue(field, args)
   *   ^field     -> getLinkedRecord(field, args)
   *   ^^field    -> getLinkedRecords(field, args)
   *   [3] / .3   -> array index (used after ^^)
   *   *          -> stop here and return the current record
   *   {json}     -> call arguments, e.g. story_header{$1} with options.params.$1
   *   (a.b)      -> field names containing a dot are protected by parentheses
   * ------------------------------------------------------------------ */

  /**
   * Splits a path into tokens without breaking field names that contain dots.
   */
  function tokenize(path) {
    const protectedPath = String(path).replace(/\(([^)]*)\)/g, (match) => match.replace(/\./g, '\u0000'));
    return protectedPath
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .map((token) => token.replace(/\u0000/g, '.'))
      .filter((token) => token.length > 0);
  }

  function splitArgs(token, options) {
    const open = token.indexOf('{');
    if (open === -1) return { field: token, args: undefined };

    const field = token.slice(0, open);
    const raw = token.slice(open, token.lastIndexOf('}') + 1);

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object') return { field, args: undefined };

    // Placeholders such as {$1: {...}} are filled from options.params
    const params = (options && options.params) || {};
    const resolved = {};
    for (const key of Object.keys(parsed)) {
      const placeholder = key.charAt(0) === '$' ? params[key] : undefined;
      resolved[key.replace(/^\$/, '')] = placeholder === undefined ? parsed[key] : placeholder;
    }

    return { field, args: resolved };
  }

  function readOne(container, field, args, mode) {
    if (container === null || container === undefined) return undefined;

    // Relay records are read through RecordProxy accessors
    if (isRecordProxy(container)) {
      try {
        if (mode === 'records') return container.getLinkedRecords(field, args);
        if (mode === 'record') return container.getLinkedRecord(field, args);
        return container.getValue(field, args);
      } catch (e) {
        recordError(e);
        return undefined;
      }
    }

    // Plain objects (also what the Node harness feeds in) are read directly
    if (typeof container === 'object') return container[field];

    return undefined;
  }

  /**
   * Reads one path against one store proxy. Returns undefined when the path cannot be
   * resolved, so callers can distinguish "missing" from a legitimate falsy value.
   */
  function readPath(source, recordId, path, options) {
    if (!source || typeof source.get !== 'function') return undefined;

    let current;
    try {
      current = typeof recordId === 'string' ? source.get(recordId) : recordId;
    } catch (e) {
      recordError(e);
      return undefined;
    }
    if (!current) return undefined;

    for (const token of tokenize(path)) {
      if (current === null || current === undefined) return undefined;
      if (token === '*') return current;

      if (/^\d+$/.test(token)) {
        if (Array.isArray(current)) {
          current = current[Number(token)];
          continue;
        }
        return undefined;
      }

      let mode = 'value';
      let name = token;
      if (token.indexOf('^^') === 0) {
        mode = 'records';
        name = token.slice(2);
      } else if (token.indexOf('^') === 0) {
        mode = 'record';
        name = token.slice(1);
      }

      const parsed = splitArgs(name, options);
      current = readOne(current, parsed.field, parsed.args, mode);
    }

    return current;
  }
/* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  let loggedRsSuccess = false;

  function checkGlobalStore() {
    if (window.___rs && typeof window.___rs.get === 'function') {
      if (!loggedRsSuccess) {
        loggedRsSuccess = true;
        console.info('[FB Diet][Relay] Store successfully captured from window.___rs!');
      }
      rememberSource(window.___rs);
      ready = true;
      return true;
    }
    return false;
  }

  /**
   * Reads a path for the first record id that resolves to a value.
   * recordIds may be a string or an array of candidates (a feed unit exposes both
   * feedUnit.id and feedUnit.__id, and only one of them is a Relay data id).
   */
  function read(recordIds, path, options) {
    checkGlobalStore();
    const ids = Array.isArray(recordIds) ? recordIds : [recordIds];

    // 1. Try window.___rs directly
    if (window.___rs && typeof window.___rs.get === 'function') {
      for (const id of ids) {
        if (typeof id !== 'string' || !id) continue;
        const value = readPath(window.___rs, id, path, options);
        if (value !== undefined && value !== null) return value;
      }
    }

    // 2. Try captured sources
    for (const id of ids) {
      if (typeof id !== 'string' || !id) continue;
      for (const source of sources) {
        const value = readPath(source, id, path, options);
        if (value !== undefined && value !== null) return value;
      }
    }

    return null;
  }

  function readFirst(recordIds, paths, options) {
    const list = Array.isArray(paths) ? paths : [paths];
    for (const path of list) {
      const value = read(recordIds, path, options);
      if (value !== undefined && value !== null) return value;
    }
    return null;
  }

  install();

  // Export compatible storeFinder for easy console probing
  window.___sf = (id, path, options) => read([id], path, options);

  return {
    RELAY_PROXY_MODULE,
    read,
    readFirst,
    isReady: () => Boolean(window.___rs || sources.length > 0 || ready),
    getSourceCount: () => (window.___rs ? Math.max(1, sources.length) : sources.length),
    getLastError: () => lastError,
    /** Debug helper: dumps the fields visible on a record */
    describe(recordId) {
      checkGlobalStore();
      const allSources = window.___rs ? [window.___rs, ...sources] : sources;
      for (const source of allSources) {
        try {
          const record = source.get(recordId);
          if (record) return record;
        } catch (e) {
          recordError(e);
        }
      }
      return null;
    }
  };
})();
