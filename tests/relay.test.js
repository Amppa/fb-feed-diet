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
  loadInject(win, 'proxy.js');
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
}

function equals(c, label, actual, expected) {
  c.equals(label, actual, expected);
}

module.exports = { run, RELAY_MODULE, makeFakeRelayClass };
