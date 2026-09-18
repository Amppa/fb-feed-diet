'use strict';
const { Checker, createFakeReact, createWindow, loadInject, createFakeComet, countMessages } = require('./harness');

function run(c) {
  const React = createFakeReact();
  const win = createWindow();
  const comet = createFakeComet(win, React);
  loadInject(win, 'proxy.js');

  const proxy = win.FBDietProxy;
  c.ok('proxy API exposed on window', Boolean(proxy) && typeof proxy.registerComponent === 'function');
  equals(c, 'no modules touched before registration', proxy.getStats().intercepted, 0);

  /* --- registration + wrapping --- */
  let sourceCalls = 0;
  function SourceCmp() {
    sourceCalls += 1;
    return { type: 'div', props: { children: 'original render' } };
  }
  SourceCmp.someStatic = 'kept';
  function feedModuleFactory() {
    return SourceCmp;
  }

  equals(c, 'registerComponent accepts valid entries', proxy.registerComponent('CometFeedUnitErrorBoundary.react', { component: function Test() {}, definerPath: '[6].default' }), true);
  equals(c, 'registerComponent rejects invalid entries', proxy.registerComponent('x', { component: 'not-a-function' }), false);

  win.__d(feedModuleFactory, 'CometFeedUnitErrorBoundary.react', [], null, null, null, { default: SourceCmp });
  c.ok('__d call recorded by the loader', comet.records.has('CometFeedUnitErrorBoundary.react'));
  equals(c, 'registered module factory got intercepted', proxy.getStats().intercepted, 1);

  comet.require('CometFeedUnitErrorBoundary.react');
  const wrapper = comet.getExport('CometFeedUnitErrorBoundary.react').default;
  c.ok('exports.default was replaced by the wrapper', typeof wrapper === 'function' && wrapper !== SourceCmp);
  equals(c, 'wrapper carries the proxy mark', Boolean(wrapper.__fbDietProxy), true);
  equals(c, 'wrapper displayName', wrapper.displayName, 'FBDiet(CometFeedUnitErrorBoundary.react)');
  equals(c, 'wrapper copied statics from the source', wrapper.someStatic, 'kept');

  const element = wrapper({ feedUnit: { id: 'u1' } });
  equals(c, 'original component ran exactly once per render', sourceCalls, 1);
  c.ok('wrapper returned a decorated element carrying the source render', Boolean(element) && element.props.lastCmp && element.props.lastCmp.type === 'div');
  equals(c, 'payload forwarded as props.payload', element.props.payload.feedUnit.id, 'u1');
  equals(c, 'moduleName forwarded', element.props.moduleName, 'CometFeedUnitErrorBoundary.react');
  equals(c, 'SourceCmp forwarded', element.props.SourceCmp, SourceCmp);

  wrapper({});
  equals(c, 'source runs again on each wrapper call', sourceCalls, 2);

  /* --- unknown modules stay untouched --- */
  function OtherCmp() {
    return { type: 'span' };
  }
  win.__d(OtherCmp, 'some/OtherModule.react', [], null, null, null, { default: OtherCmp });
  comet.require('some/OtherModule.react');
  equals(c, 'unregistered module export untouched', comet.getExport('some/OtherModule.react').default, OtherCmp);
  equals(c, 'only registered factories intercepted', proxy.getStats().intercepted, 1);

  /* --- factory hooks (the relay.js integration point) --- */
  const seen = [];
  equals(c, 'registerFactoryHook accepts cb', proxy.registerFactoryHook('relay-runtime/store/FakeStore', (info) => seen.push(info.exports)), true);
  function StoreCtor() {}
  win.__d(StoreCtor, 'relay-runtime/store/FakeStore', [], null, null, null, { default: StoreCtor });
  comet.require('relay-runtime/store/FakeStore');
  equals(c, 'factory hook fired with the exports object', seen.length, 1);
  equals(c, 'factory hook did not rewrite exports', comet.getExport('relay-runtime/store/FakeStore').default, StoreCtor);

  /* --- late registration of a module defined while a factory hook was present --- */
  function LateCmp() {
    return { type: 'p' };
  }
  proxy.registerFactoryHook('late/LateModule.react', () => {});
  win.__d(function lateFactory() {}, 'late/LateModule.react', [], null, null, null, { default: LateCmp });
  comet.require('late/LateModule.react');
  proxy.registerComponent('late/LateModule.react', { component: function Test2() {}, definerPath: '[6].default' });
  c.ok('late registration wraps the existing export', comet.getExport('late/LateModule.react').default !== LateCmp);

  /* --- error isolation --- */
  function BoomCmp() {
    throw new Error('boom');
  }
  proxy.registerComponent('boom/Boom.react', { component: function Test4() {}, definerPath: '[6].default' });
  win.__d(function boomFactory() {
    return BoomCmp;
  }, 'boom/Boom.react', [], null, null, null, { default: BoomCmp });
  comet.require('boom/Boom.react');
  let rethrown = null;
  try {
    comet.getExport('boom/Boom.react').default({});
  } catch (e) {
    rethrown = e;
  }
  equals(c, 'source errors are re-thrown so FB keeps its reporting', rethrown && rethrown.message, 'boom');
  c.ok('source error recorded for diagnostics', proxy.getErrors().some((e) => e.context === 'source boom/Boom.react' && e.message === 'boom'));

  proxy.registerComponent('broken/Broken.react', { component: function T3() {}, definerPath: '[6].doesNotExist' });
  win.__d(function () {}, 'broken/Broken.react', [], null, null, null, { default: function () {} });
  comet.require('broken/Broken.react');
  c.ok('missing definerPath recorded without throwing', proxy.getErrors().some((e) => e.message.indexOf('definerPath not found') !== -1));

  /* --- re-wrapping is prevented --- */
  comet.getExport('CometFeedUnitErrorBoundary.react').default({});
  comet.getExport('CometFeedUnitErrorBoundary.react').default({});
  equals(c, 'already wrapped export is not wrapped again', sourceCalls, 4);

  equals(c, 'no stray MAIN messages during proxy tests', countMessages(win, 'blocked'), 0);
}

function equals(c, label, actual, expected) {
  c.equals(label, actual, expected);
}

module.exports = { run, equals };
