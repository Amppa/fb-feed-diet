'use strict';
const { Checker, createFakeReact, createWindow, loadInject, createFakeComet, countMessages } = require('./harness');

function run(c) {
  const React = createFakeReact();
  const win = createWindow();
  const loader = createFakeComet(win, React);
  loadInject(win, 'comet.js');

  const comet = win.FBDietComet;
  c.ok('comet API exposed on window', Boolean(comet) && typeof comet.registerComponent === 'function');
  equals(c, 'no modules touched before registration', comet.getStats().intercepted, 0);

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

  equals(c, 'registerComponent accepts valid entries', comet.registerComponent('CometFeedUnitErrorBoundary.react', { component: function Test() {}, definerPath: '[6].default' }), true);
  equals(c, 'registerComponent rejects invalid entries', comet.registerComponent('x', { component: 'not-a-function' }), false);

  win.__d(feedModuleFactory, 'CometFeedUnitErrorBoundary.react', [], null, null, null, { default: SourceCmp });
  c.ok('__d call recorded by the loader', loader.records.has('CometFeedUnitErrorBoundary.react'));
  equals(c, 'registered module factory got intercepted', comet.getStats().intercepted, 1);
  equals(c, 'dCalls counts every loader definition', comet.getStats().dCalls, 1);

  loader.require('CometFeedUnitErrorBoundary.react');
  const wrapper = loader.getExport('CometFeedUnitErrorBoundary.react').default;
  c.ok('exports.default was replaced by the wrapper', typeof wrapper === 'function' && wrapper !== SourceCmp);
  equals(c, 'wrapper carries the comet mark', Boolean(wrapper.__fbDietComet), true);
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
  loader.require('some/OtherModule.react');
  equals(c, 'unregistered module export untouched', loader.getExport('some/OtherModule.react').default, OtherCmp);
  equals(c, 'only registered factories intercepted', comet.getStats().intercepted, 1);
  equals(c, 'dCalls counts unregistered modules too', comet.getStats().dCalls, 2);

  /* --- factory hooks (the relay.js integration point) --- */
  const seen = [];
  equals(c, 'registerFactoryHook accepts cb', comet.registerFactoryHook('relay-runtime/store/FakeStore', (info) => seen.push(info.exports)), true);
  function StoreCtor() {}
  win.__d(StoreCtor, 'relay-runtime/store/FakeStore', [], null, null, null, { default: StoreCtor });
  loader.require('relay-runtime/store/FakeStore');
  equals(c, 'factory hook fired with the exports object', seen.length, 1);
  equals(c, 'factory hook did not rewrite exports', loader.getExport('relay-runtime/store/FakeStore').default, StoreCtor);

  /* --- late registration of a module defined while a factory hook was present --- */
  function LateCmp() {
    return { type: 'p' };
  }
  comet.registerFactoryHook('late/LateModule.react', () => {});
  win.__d(function lateFactory() {}, 'late/LateModule.react', [], null, null, null, { default: LateCmp });
  loader.require('late/LateModule.react');
  comet.registerComponent('late/LateModule.react', { component: function Test2() {}, definerPath: '[6].default' });
  c.ok('late registration wraps the existing export', loader.getExport('late/LateModule.react').default !== LateCmp);

  /* --- error isolation --- */
  function BoomCmp() {
    throw new Error('boom');
  }
  comet.registerComponent('boom/Boom.react', { component: function Test4() {}, definerPath: '[6].default' });
  win.__d(function boomFactory() {
    return BoomCmp;
  }, 'boom/Boom.react', [], null, null, null, { default: BoomCmp });
  loader.require('boom/Boom.react');
  let rethrown = null;
  try {
    loader.getExport('boom/Boom.react').default({});
  } catch (e) {
    rethrown = e;
  }
  equals(c, 'source errors are re-thrown so FB keeps its reporting', rethrown && rethrown.message, 'boom');
  c.ok('source error recorded for diagnostics', comet.getErrors().some((e) => e.context === 'source boom/Boom.react' && e.message === 'boom'));

  comet.registerComponent('broken/Broken.react', { component: function T3() {}, definerPath: '[6].doesNotExist' });
  win.__d(function () {}, 'broken/Broken.react', [], null, null, null, { default: function () {} });
  loader.require('broken/Broken.react');
  c.ok('missing definerPath recorded without throwing', comet.getErrors().some((e) => e.message.indexOf('definerPath not found') !== -1));

  /* --- re-wrapping is prevented --- */
  loader.getExport('CometFeedUnitErrorBoundary.react').default({});
  loader.getExport('CometFeedUnitErrorBoundary.react').default({});
  equals(c, 'already wrapped export is not wrapped again', sourceCalls, 4);

  /* --- module health (drift counters) --- */
  comet.registerComponent('drift/NeverDefined.react', { component: function T5() {}, definerPath: '[6].default' });
  const health = comet.getModuleHealth();
  equals(c, 'health counts registered modules', health.registered, 5);
  equals(c, 'health counts seen module factories', health.seen, 4);
  equals(c, 'health lists never-defined modules', health.unseen.join(','), 'drift/NeverDefined.react');
  equals(c, 'health lists failed definer paths', health.failed.join(','), 'broken/Broken.react');
  equals(c, 'health counts patched modules', health.patched, 3);
  c.ok('health reports loader activity', health.loaderActive === true);
  equals(c, 'health reports the hook as installed', health.hookActive, true);
  equals(c, 'stats report the hook as installed', comet.getStats().hookActive, true);

  equals(c, 'no stray MAIN messages during comet tests', countMessages(win, 'blocked'), 0);

  /* --- hard disable: the master switch is honoured before the hook goes on --- */
  function bootWithCache(cache) {
    const react = createFakeReact();
    const w = createWindow();
    if (cache !== undefined) {
      w.localStorage = cache;
    }
    const loader = createFakeComet(w, react);
    const before = w.__d;
    loadInject(w, 'comet.js');
    return { win: w, loader, comet: w.FBDietComet, originalD: before };
  }

  const blockedCache = {
    getItem(key) {
      return key === 'fb_diet_settings_cache' ? JSON.stringify({ enabled: false }) : null;
    }
  };
  {
    const t = bootWithCache(blockedCache);
    equals(c, 'a disabled cache skips the hook', t.comet.getStats().hookActive, false);
    equals(c, 'window.__d is left exactly as Facebook shipped it', t.win.__d, t.originalD);
    c.ok('no accessor was defined on window.__d', Boolean(Object.getOwnPropertyDescriptor(t.win, '__d').value));

    // Registrations still happen (fold.js/relay.js run untouched) but the absent hook never
    // consults them, so a disabled extension intercepts nothing at all.
    t.comet.registerComponent('CometFeedUnitErrorBoundary.react', { component: function Off() {}, definerPath: '[6].default' });
    function OffCmp() {
      return { type: 'div' };
    }
    t.win.__d(function offFactory() {
      return OffCmp;
    }, 'CometFeedUnitErrorBoundary.react', [], null, null, null, { default: OffCmp });
    t.loader.require('CometFeedUnitErrorBoundary.react');
    equals(c, 'disabled: no loader call counted', t.comet.getStats().dCalls, 0);
    equals(c, 'disabled: nothing intercepted', t.comet.getStats().intercepted, 0);
    equals(c, 'disabled: export untouched', t.loader.getExport('CometFeedUnitErrorBoundary.react').default, OffCmp);
    equals(c, 'disabled: health still reports the hook state', t.comet.getModuleHealth().hookActive, false);
  }

  {
    const t = bootWithCache(undefined);
    equals(c, 'no cache at all fails open and installs', t.comet.getStats().hookActive, true);
  }
  {
    const t = bootWithCache({ getItem: () => JSON.stringify({ enabled: true, foldAds: true }) });
    equals(c, 'enabled cache installs', t.comet.getStats().hookActive, true);
  }
  {
    const t = bootWithCache({ getItem: () => '{not json' });
    equals(c, 'malformed cache fails open', t.comet.getStats().hookActive, true);
  }
  {
    const t = bootWithCache({
      getItem() {
        throw new Error('localStorage is blocked');
      }
    });
    equals(c, 'blocked storage fails open', t.comet.getStats().hookActive, true);
  }
  {
    const t = bootWithCache({ getItem: () => JSON.stringify({ enabled: null }) });
    equals(c, 'a non-false enabled value fails open', t.comet.getStats().hookActive, true);
  }
}

function equals(c, label, actual, expected) {
  c.equals(label, actual, expected);
}

module.exports = { run, equals };
