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
 * relay-runtime/mutations/RelayRecordSourceProxy with a Proxy construct trap, and every store
 * instance Relay commits is remembered, with no eval and no source rewriting.
 *
 * Public API (window.FBDietRelay):
 *   read(recordIds, path, options)   -> value | null
 *   readFirst(recordIds, paths)      -> value | null
 *   isReady() / getSourceCount() / getLastError()
 *   getCaptureStats() -> how far the capture got (see the capture counters below)
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

  /**
   * Capture diagnostics, reported by probe v6 as `relay.capture`. A zero
   * `sourceCount` is meaningless on its own; the first counter that stays at zero says
   * which link of the chain (hook -> exports -> wrap -> construct -> accept) broke.
   *
   * The probe therefore emits this block only when the capture is unhealthy (decision #45),
   * so an absent `capture` beside a populated `sourceCount` is the healthy reading rather
   * than missing evidence.
   */
  const capture = {
    hooked: 0,          // the factory hook fired for RELAY_PROXY_MODULE
    noExports: 0,       // comet.js handed the hook a null exports object
    noConstructor: 0,   // exports carried no function to wrap (different export shape)
    alreadyWrapped: 0,  // our own mark was already on it (second evaluation)
    wrapped: 0,         // the Proxy constructor was built
    applied: false,     // exportsObject.default === Wrapped, read back after the write
    constructs: 0,      // instances created through our Proxy
    rejectedNoGet: 0,   // instances dropped by rememberSource's `get` guard
    protoHooked: 0,     // prototype.get was patched (see patchPrototype)
    alreadyPatched: 0,  // prototype.get already carried our mark
    protoHits: 0,       // calls to get() seen after the prototype patch
    shapeMismatch: 0,   // accessor throws from a field of the wrong shape (never an error)
    lastShapeMismatch: null
  };

  function recordError(error) {
    lastError = error && error.message ? error.message : String(error);
  }

  function isRecordProxy(value) {
    return Boolean(value) && typeof value === 'object' && typeof value.getValue === 'function';
  }

  function rememberSource(instance) {
    if (!instance || typeof instance.get !== 'function') {
      capture.rejectedNoGet += 1;
      return;
    }

    // The prototype patch calls this on every single record read, so the overwhelmingly common
    // case is the same store as last time (newest is index 0). Reordering it again would only
    // cost an indexOf plus a splice/unshift to arrive at the same array, so return immediately.
    if (sources[0] === instance) return;

    const index = sources.indexOf(instance);
    if (index !== -1) sources.splice(index, 1);
    sources.unshift(instance);
    if (sources.length > MAX_SOURCES) sources.length = MAX_SOURCES;
    ready = true;
  }

  /**
   * Captures the store through the prototype instead of the constructor.
   *
   * The construct trap is not enough on a real page: Facebook builds the Relay store while
   * the module is still being evaluated, so no instance is ever created through our Proxy
   * (`constructs: 0` while `applied: true` — the class really is ours, it is simply never
   * `new`ed again afterwards). Patching `prototype.get` sidesteps the ordering entirely:
   * the first read of any record passes the store as `this`, and a store that already exists
   * is captured just as well as one built later.
   */
  function patchPrototype(Original) {
    const proto = Original && Original.prototype;
    if (!proto || typeof proto.get !== 'function') return false;
    if (proto.get.__fbDietProtoPatched) {
      capture.alreadyPatched += 1;
      return false;
    }

    const originalGet = proto.get;
    function patchedGet(...args) {
      capture.protoHits += 1;
      try {
        rememberSource(this);
      } catch (e) {
        recordError(e);
      }
      return originalGet.apply(this, args);
    }
    try {
      Object.defineProperty(patchedGet, '__fbDietProtoPatched', { value: true });
      proto.get = patchedGet;
      capture.protoHooked += 1;
      return true;
    } catch (e) {
      recordError(e);
      return false;
    }
  }

  /**
   * Replaces the exported constructor with a wrapping Proxy so instances can be observed.
   */
  function wrapExports(exportsObject) {
    capture.hooked += 1;
    if (!exportsObject) {
      capture.noExports += 1;
      recordError('Relay store module carried no exports object');
      return;
    }

    const Original = exportsObject.default || (typeof exportsObject === 'function' ? exportsObject : null);
    if (typeof Original !== 'function') {
      capture.noConstructor += 1;
      return;
    }

    // The prototype patch is the reliable path, so it runs even when the class was already
    // wrapped on a previous evaluation (that early return would otherwise skip it).
    patchPrototype(Original);

    if (Original.__fbDietRelayWrapped) {
      capture.alreadyWrapped += 1;
      return;
    }

    const Wrapped = new Proxy(Original, {
      construct(target, args, newTarget) {
        capture.constructs += 1;
        const instance = Reflect.construct(target, args, newTarget);
        try {
          rememberSource(instance);
        } catch (e) {
          recordError(e);
        }
        return instance;
      }
    });
    capture.wrapped += 1;

    try {
      Object.defineProperty(Wrapped, '__fbDietRelayWrapped', { value: true });
    } catch (e) {
      // Non fatal: the guard above then simply re-wraps at most once per module load
    }

    try {
      exportsObject.default = Wrapped;
    } catch (e) {
      recordError(e);
    }
    // Read back instead of trusting the write: a getter-only ES module namespace silently
    // keeps the original constructor, and that case must not look like a successful capture.
    capture.applied = exportsObject.default === Wrapped;
  }

  function install() {
    if (installed) return;
    installed = true;

    const comet = window.FBDietComet;
    if (!comet || typeof comet.registerFactoryHook !== 'function') return;

    comet.registerFactoryHook(RELAY_PROXY_MODULE, (info) => wrapExports(info.exports));

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
    const raw = token.slice(open + 1, token.lastIndexOf('}')); // e.g. "$1" or "location: '...'"

    // Support {$1} syntax directly mapping to options["$1"] or options.params["$1"]
    if (options) {
      if (options[raw] !== undefined) return { field, args: options[raw] };
      if (options.params && options.params[raw] !== undefined) return { field, args: options.params[raw] };
    }

    let parsed = null;
    try {
      parsed = JSON.parse('{' + raw + '}');
    } catch (e) {
      parsed = null;
    }

    if (parsed && typeof parsed === 'object') {
      const params = (options && options.params) || options || {};
      const resolved = {};
      for (const key of Object.keys(parsed)) {
        const placeholder = key.charAt(0) === '$' ? params[key] : undefined;
        resolved[key.replace(/^\$/, '')] = placeholder === undefined ? parsed[key] : placeholder;
      }
      return { field, args: resolved };
    }

    return { field, args: options };
  }

  /**
   * Runs a single Relay accessor. Modern Relay throws a minified invariant when an accessor is
   * used on a field of the wrong shape (getLinkedRecord on a plain-object field, for example)
   * rather than returning null. That is our path guessing wrong, not a store failure, so it is
   * counted separately and deliberately never written to `lastError` — otherwise a perfectly
   * healthy page reports an error on every unit and hides the ones that matter.
   */
  function safeAccessor(label, fn) {
    try {
      return { value: fn() };
    } catch (e) {
      capture.shapeMismatch += 1;
      capture.lastShapeMismatch = label + ' -> ' + String(e && e.message ? e.message : e).slice(0, 120);
      return { value: undefined };
    }
  }

  function readOne(container, field, args, mode) {
    if (container === null || container === undefined) return undefined;

    // Relay records are read through RecordProxy accessors
    if (isRecordProxy(container)) {
      if (mode === 'records') {
        return safeAccessor('getLinkedRecords(' + field + ')', () => container.getLinkedRecords(field, args)).value;
      }
      if (mode === 'record') {
        // Each accessor is guarded on its own: a throw from getLinkedRecord must still fall
        // through to getValue below, or a field stored as a plain object reads as missing.
        const linked = safeAccessor('getLinkedRecord(' + field + ')', () => container.getLinkedRecord(field, args)).value;
        if (linked !== undefined && linked !== null) return linked;
        const val = safeAccessor('getValue(' + field + ')', () => container.getValue(field, args)).value;
        if (val !== undefined && val !== null && typeof val === 'object') return val;
        return undefined;
      }
      return safeAccessor('getValue(' + field + ')', () => container.getValue(field, args)).value;
    }

    // Plain objects (also what the Node harness feeds in) are read directly
    if (typeof container === 'object') return container[field];

    return undefined;
  }

  /**
   * Reads one path against one captured store. Returns undefined when the path cannot be
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
    /** Capture diagnostics for the probe report (`proxy.relay.capture`). */
    getCaptureStats() {
      return {
        hooked: capture.hooked,
        noExports: capture.noExports,
        noConstructor: capture.noConstructor,
        alreadyWrapped: capture.alreadyWrapped,
        wrapped: capture.wrapped,
        applied: capture.applied,
        constructs: capture.constructs,
        rejectedNoGet: capture.rejectedNoGet,
        protoHooked: capture.protoHooked,
        alreadyPatched: capture.alreadyPatched,
        protoHits: capture.protoHits,
        shapeMismatch: capture.shapeMismatch,
        lastShapeMismatch: capture.lastShapeMismatch
      };
    },
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
