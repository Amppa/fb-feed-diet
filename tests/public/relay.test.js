'use strict';
const { Checker, createFakeReact, createWindow, loadInject, createFakeComet } = require('./harness');

const RELAY_MODULE = 'relay-runtime/mutations/RelayRecordSourceProxy';

function makeFakeRelayClass() {
  function FakeRelayRecordSourceProxy(records) {
    this.records = records || {};
  }
  FakeRelayRecordSourceProxy.prototype.get = function (id) {
    return this.records[id] || null;
  };
  return FakeRelayRecordSourceProxy;
}

function run(c) {
  const React = createFakeReact();
  const win = createWindow();
  const comet = createFakeComet(win, React);
  loadInject(win, 'comet.js');
  loadInject(win, 'relay.js');

  const relay = win.FBDietRelay;
  c.ok('relay API exposed on window', Boolean(relay) && typeof relay.read === 'function');
  equals(c, 'not ready before any store was created', relay.isReady(), false);

  /* --- capture via the construct trap --- */
  const RelayClass = makeFakeRelayClass();
  const exportsObj = { default: RelayClass };
  win.__d(function () {
    return RelayClass;
  }, RELAY_MODULE, [], null, null, null, exportsObj);
  comet.require(RELAY_MODULE);

  const Wrapped = exportsObj.default;
  c.ok('exported constructor was wrapped', Wrapped !== RelayClass);

  const records = {
    u1: {
      sponsored_data: { ad_id: 'ad-123' },
      actors: [{ subscribe_status: 'CAN_SUBSCRIBE' }],
      to: { viewer_forum_join_state: 'CAN_JOIN' },
      showcase_story_type: null,
      story_header: { title: { text: 'Groups you may like' } }
    }
  };
  new Wrapped(records); // eslint-disable-line no-new

  equals(c, 'store captured through the construct trap', relay.isReady(), true);
  equals(c, 'one source remembered', relay.getSourceCount(), 1);
  equals(c, 'first capture broadcasts relay-ready once',
    win.__events.filter((e) => e && e.type === 'fb-diet:relay-ready').length, 1);

  /* --- path grammar --- */
  equals(c, 'plain field chain on plain objects', relay.read('u1', 'sponsored_data.ad_id'), 'ad-123');
  equals(c, 'sponsored path (^linked.field)', relay.read('u1', '^sponsored_data.ad_id'), 'ad-123');
  equals(c, 'list path (^^field[index].field)', relay.read('u1', '^^actors[0].subscribe_status'), 'CAN_SUBSCRIBE');
  equals(c, 'single-link path (^field.field)', relay.read('u1', '^to.viewer_forum_join_state'), 'CAN_JOIN');
  equals(c, 'args path ({$1} params accepted)', relay.read('u1', '^story_header{$1}.^title.text', { params: { $1: { location: 'homepage_stream' } } }), 'Groups you may like');
  c.ok('star path returns the record itself', relay.read('u1', '*') === records.u1);

  /* --- candidate ids + readFirst --- */
  equals(c, 'first matching id wins', relay.read(['missing-id', 'u1'], '^sponsored_data.ad_id'), 'ad-123');
  equals(c, 'readFirst iterates paths in order', relay.readFirst('u1', ['^nothing.here', '^sponsored_data.ad_id']), 'ad-123');
  equals(c, 'missing record reads as null', relay.read('nope', '^sponsored_data.ad_id'), null);
  equals(c, 'missing field reads as null', relay.read('u1', '^missing_field'), null);
  equals(c, 'describe dumps the record', relay.describe('u1') === records.u1, true);

  /* --- only the wrapped module is affected --- */
  function Unrelated() {}
  win.__d(Unrelated, 'relay-runtime/other/Thing', [], null, null, null, { default: Unrelated });
  comet.require('relay-runtime/other/Thing');
  equals(c, 'unrelated module untouched', comet.getExport('relay-runtime/other/Thing').default, Unrelated);

  /* --- newest sources are kept, oldest evicted (MAX_SOURCES = 6) --- */
  for (let i = 0; i < 8; i += 1) {
    new Wrapped({ batch: String(i) }); // eslint-disable-line no-new
  }
  equals(c, 'source ring buffer bounded', relay.getSourceCount(), 6);
  c.ok('newest source still readable', Boolean(relay.describe('batch')));
  equals(c, 'later captures never re-broadcast relay-ready',
    win.__events.filter((e) => e && e.type === 'fb-diet:relay-ready').length, 1);

  /* --- capture diagnostics: what the probe report shows as proxy.relay.capture --- */
  const stats = relay.getCaptureStats();
  equals(c, 'capture: the factory hook fired once', stats.hooked, 1);
  equals(c, 'capture: an exports object always reached the hook', stats.noExports, 0);
  equals(c, 'capture: a constructor was found on it', stats.noConstructor, 0);
  equals(c, 'capture: the Proxy was built once', stats.wrapped, 1);
  equals(c, 'capture: the write is readable back on the namespace', stats.applied, true);
  equals(c, 'capture: every construction went through the Proxy', stats.constructs, 9);
  equals(c, 'capture: nothing was dropped by the get guard', stats.rejectedNoGet, 0);

  /* --- the same counters must name the failure modes (each in a clean window) --- */
  {
    const frozenReact = createFakeReact();
    const frozenWin = createWindow();
    const frozenComet = createFakeComet(frozenWin, frozenReact);
    loadInject(frozenWin, 'comet.js');
    loadInject(frozenWin, 'relay.js');
    const frozenRelay = frozenWin.FBDietRelay;
    equals(c, 'capture starts at zero', frozenRelay.getCaptureStats().hooked, 0);

    const FrozenClass = makeFakeRelayClass();
    const namespace = {};
    Object.defineProperty(namespace, 'default', { value: FrozenClass, writable: false, configurable: false });
    frozenWin.__d(() => namespace, RELAY_MODULE, [], null, null, null, namespace);
    frozenComet.require(RELAY_MODULE);
    const frozenStats = frozenRelay.getCaptureStats();
    equals(c, 'a read-only namespace still fires the hook', frozenStats.hooked, 1);
    equals(c, 'a read-only namespace builds the Proxy', frozenStats.wrapped, 1);
    equals(c, 'a read-only namespace reports applied false', frozenStats.applied, false);
    equals(c, 'a read-only namespace records the write error', typeof frozenRelay.getLastError(), 'string');
    equals(c, 'a read-only namespace captures no source', frozenRelay.getSourceCount(), 0);
  }

  {
    const bareReact = createFakeReact();
    const bareWin = createWindow();
    const bareComet = createFakeComet(bareWin, bareReact);
    loadInject(bareWin, 'comet.js');
    loadInject(bareWin, 'relay.js');
    const bareRelay = bareWin.FBDietRelay;

    function Bare() {} // an instance shape without get(): the accept guard drops it
    const bareExports = { default: Bare };
    bareWin.__d(() => Bare, RELAY_MODULE, [], null, null, null, bareExports);
    bareComet.require(RELAY_MODULE);
    equals(c, 'a wrapped bare class reports applied true', bareRelay.getCaptureStats().applied, true);
    new bareExports.default(); // eslint-disable-line no-new
    const bareStats = bareRelay.getCaptureStats();
    equals(c, 'a construction is counted even when the guard drops it', bareStats.constructs, 1);
    equals(c, 'the get guard reports its own rejection count', bareStats.rejectedNoGet, 1);
    equals(c, 'a rejected instance leaves the store unready', bareRelay.isReady(), false);
    equals(c, 'a rejected instance is not recorded as an error', bareRelay.getLastError(), null);
  }

  {
    const nullReact = createFakeReact();
    const nullWin = createWindow();
    const nullComet = createFakeComet(nullWin, nullReact);
    loadInject(nullWin, 'comet.js');
    loadInject(nullWin, 'relay.js');
    const nullRelay = nullWin.FBDietRelay;

    // An exports object that carries no callable default (a different export shape).
    nullWin.__d(() => ({}), RELAY_MODULE, [], null, null, null, null);
    nullComet.require(RELAY_MODULE);
    const nullStats = nullRelay.getCaptureStats();
    equals(c, 'a constructor-less exports object still fires the hook', nullStats.hooked, 1);
    equals(c, 'a constructor-less exports object is counted', nullStats.noConstructor, 1);
    equals(c, 'a constructor-less exports object builds no Proxy', nullStats.wrapped, 0);
    equals(c, 'a constructor-less exports object reports applied false', nullStats.applied, false);
    equals(c, 'a constructor-less exports object captures no source', nullRelay.getSourceCount(), 0);
  }

  /* --- prototype capture: the real-page path, where the store predates our wrap --- */
  {
    const preWin = createWindow();
    const preComet = createFakeComet(preWin, createFakeReact());
    loadInject(preWin, 'comet.js');

    // The store exists and is read BEFORE relay.js ever sees the module: this is the ordering
    // a real page load produces, and the reason constructs stayed 0 in the field.
    const PreClass = makeFakeRelayClass();
    const preExports = { default: PreClass };
    preWin.__d(() => PreClass, RELAY_MODULE, [], null, null, null, preExports);
    const PreStore = new (preComet.require(RELAY_MODULE))({
      u1: { sponsored_data: { ad_id: 'ad-123' } }
    });

    loadInject(preWin, 'relay.js');
    equals(c, 'prototype capture starts unpatched', preWin.FBDietRelay.getCaptureStats().protoHooked, 0);
    equals(c, 'no store is readable before the module is seen', preWin.FBDietRelay.getSourceCount(), 0);

    // The loader evaluates the module again, which is when relay.js's factory hook fires.
    preWin.__d(() => PreClass, RELAY_MODULE, [], null, null, null, preExports);
    preComet.require(RELAY_MODULE);

    // Nothing was ever constructed through our Proxy. The store built before the wrap is
    // still captured the first time anything reads a record from it.
    equals(c, 'the construct trap stayed unused', preWin.FBDietRelay.getCaptureStats().constructs, 0);
    equals(c, 'the pre-wrap store is not readable yet', preWin.FBDietRelay.getSourceCount(), 0);

    PreStore.get('u1');
    equals(c, 'a store that predates the wrap is captured on first get()', preWin.FBDietRelay.getSourceCount(), 1);
    equals(c, 'the pre-wrap store is readable', preWin.FBDietRelay.read('u1', 'sponsored_data.ad_id'), 'ad-123');
    equals(c, 'prototype capture also broadcasts relay-ready once',
      preWin.__events.filter((e) => e && e.type === 'fb-diet:relay-ready').length, 1);
  }

  /* --- the prototype path re-reads one store constantly: the early-out must not reorder --- */
  {
    const hotWin = createWindow();
    const hotComet = createFakeComet(hotWin, createFakeReact());
    loadInject(hotWin, 'comet.js');
    loadInject(hotWin, 'relay.js');
    const hotRelay = hotWin.FBDietRelay;

    const HotClass = makeFakeRelayClass();
    const hotExports = { default: HotClass };
    hotWin.__d(() => HotClass, RELAY_MODULE, [], null, null, null, hotExports);
    hotComet.require(RELAY_MODULE);

    // Each store holds its record under its own id, so a read resolves to that record.
    const hotA = new HotClass({ 'rec-a': { id: 'rec-a' } });
    const hotB = new HotClass({ 'rec-b': { id: 'rec-b' } });

    // Read B, then hammer it. The repeated hits must leave B at the front of the ring.
    hotB.get('rec-b');
    for (let i = 0; i < 50; i += 1) hotB.get('rec-b');
    hotA.get('rec-a');
    for (let i = 0; i < 50; i += 1) hotB.get('rec-b');

    equals(c, 'repeated reads of the newest source keep both stores', hotRelay.getSourceCount(), 2);
    equals(c, 'the hammered store is still readable', hotRelay.read('rec-b', '*').id, 'rec-b');
    equals(c, 'the other store is still readable', hotRelay.read('rec-a', '*').id, 'rec-a');

    // And the early-out must not break LRU: after hammering B, a fresh read of A then B
    // leaves B newest, which is what the eviction order depends on.
    const hotC = new HotClass({ 'rec-c': { id: 'rec-c' } });
    hotC.get('rec-c');
    hotB.get('rec-b');
    equals(c, 'a newly read store is still captured', hotRelay.getSourceCount(), 3);
    equals(c, 'the newest store is the one just read', hotRelay.describe('rec-b').id, 'rec-b');
  }

  /* --- an accessor throwing on a wrong-shaped field is a miss, not a store error --- */
  {
    const shapeWin = createWindow();
    const shapeComet = createFakeComet(shapeWin, createFakeReact());
    loadInject(shapeWin, 'comet.js');
    loadInject(shapeWin, 'relay.js');
    const shapeRelay = shapeWin.FBDietRelay;

    // A record whose getLinkedRecord throws the way modern Relay does on a scalar field, while
    // getValue still answers. The value must still be read, and lastError must stay clean.
    const plainObjectField = { name: '示範同學會社團', id: 'g1' };
    const shapeStore = {
      get() {
        return {
          getValue(field) {
            if (field === 'to') return plainObjectField;
            if (field === 'wwwURL') return 'https://www.facebook.com/g1/posts/1';
            return undefined;
          },
          getLinkedRecord() {
            throw new Error('Minified invariant #53158; %s Params: %s, %s, %s, %s');
          },
          getLinkedRecords() {
            throw new Error('Minified invariant #99999');
          }
        };
      }
    };

    // Exposed as window.___rs, which the reader adopts as a source without any hook.
    shapeWin.___rs = shapeStore;

    equals(c, 'a shape mismatch starts uncounted', shapeRelay.getCaptureStats().shapeMismatch, 0);
    equals(c, 'no lastShapeMismatch before any read', shapeRelay.getCaptureStats().lastShapeMismatch, null);

    equals(c, 'getValue answers after getLinkedRecord throws', shapeRelay.read('u1', '^to.name'), '示範同學會社團');
    c.ok('the last mismatch names the accessor and field', String(shapeRelay.getCaptureStats().lastShapeMismatch).indexOf('getLinkedRecord(to)') !== -1);

    // A later read must not be affected by the earlier throw.
    equals(c, 'a sibling field still resolves', shapeRelay.read('u1', 'wwwURL'), 'https://www.facebook.com/g1/posts/1');
    equals(c, 'a linked read of a scalar field stays empty', shapeRelay.read('u1', '^wwwURL'), null);

    const shapeStats = shapeRelay.getCaptureStats();
    equals(c, 'the throw is counted as a shape mismatch', shapeStats.shapeMismatch > 0, true);
    equals(c, 'a shape mismatch is never recorded as an error', shapeRelay.getLastError(), null);
  }

  /* --- a re-evaluated module must not stack prototype patches --- */
  {
    const twiceWin = createWindow();
    const twiceComet = createFakeComet(twiceWin, createFakeReact());
    loadInject(twiceWin, 'comet.js');
    loadInject(twiceWin, 'relay.js');
    const twiceRelay = twiceWin.FBDietRelay;

    const TwiceClass = makeFakeRelayClass();
    const twiceExports = { default: TwiceClass };
    twiceWin.__d(() => TwiceClass, RELAY_MODULE, [], null, null, null, twiceExports);
    twiceComet.require(RELAY_MODULE);
    equals(c, 'prototype patched once', twiceRelay.getCaptureStats().protoHooked, 1);

    // The same class object seen again: the patch must not be applied a second time.
    twiceWin.__d(() => TwiceClass, RELAY_MODULE, [], null, null, null, twiceExports);
    twiceComet.require(RELAY_MODULE);
    const twiceStats = twiceRelay.getCaptureStats();
    equals(c, 'a repeated evaluation does not re-patch the prototype', twiceStats.protoHooked, 1);
    equals(c, 'the repeat is counted as already patched', twiceStats.alreadyPatched, 1);
  }
}

function equals(c, label, actual, expected) {
  c.equals(label, actual, expected);
}

module.exports = { run, RELAY_MODULE, makeFakeRelayClass };
