'use strict';
const { Checker, createFakeReact, createWindow, loadInject, createFakeComet, countMessages } = require('./harness');

const FEED_MODULE = 'CometFeedUnitErrorBoundary.react';
const SPONSORED_PATH = '^sponsored_data.ad_id';

function setup(relayMap) {
  const React = createFakeReact();
  const win = createWindow();
  const comet = createFakeComet(win, React);

  loadInject(win, 'proxy.js');
  loadInject(win, 'classify.js');
  loadInject(win, 'bridge.js');
  loadInject(win, 'fold.js');

  win.FBDietClassify.setRelayReader((ids, path) => {
    if (typeof relayMap === 'function') {
      const id = Array.isArray(ids) ? ids[0] : ids;
      return relayMap(id, path);
    }
    return (relayMap && relayMap[path]) || null;
  });

  let sourceCalls = 0;
  function SourceCmp() {
    sourceCalls += 1;
    return { type: 'div', props: { children: 'original post' }, __source: true };
  }
  win.__d(SourceCmp, FEED_MODULE, [], null, null, null, { default: SourceCmp });
  comet.require(FEED_MODULE);
  const wrapper = comet.getExport(FEED_MODULE).default;

  return {
    React,
    win,
    comet,
    proxy: win.FBDietProxy,
    bridge: win.FBDietBridge,
    fold: win.FBDietFold,
    // wrapper() returns the React element for FBDietFold; invoking its type emulates
    // React rendering that element one level deeper.
    render(payload) {
      React.resetHooks();
      const element = wrapper(payload);
      if (element && typeof element.type === 'function') return element.type(element.props);
      return element;
    },
    sourceCallCount: () => sourceCalls
  };
}

function run(c) {
  const payloadOf = (id) => ({ feedUnit: { id, __typename: 'FeedUnitRoot' } });

  /* --- boot state --- */
  {
    const t = setup({});
    c.ok('fold API exposed', Boolean(t.fold) && typeof t.fold.FBDietFold === 'function');
    c.equals('fold registered its module', t.proxy.listRegistered()[FEED_MODULE][0], '[6].default');
    c.equals('detectOnly removed from defaults', 'detectOnly' in t.bridge.getSettings(), false);
    c.equals('ready message announced at load', countMessages(t.win, 'ready'), 1);
    c.equals('HIDE_MODE is display-none', t.fold.HIDE_MODE, 'display-none');
  }

  /* --- unknown payload: untouched + reported once --- */
  {
    const t = setup({});
    const result = t.render(payloadOf('u-unknown'));
    c.ok('unknown unit renders the untouched tree', result.__source === true && result.props.children === 'original post');
    c.equals('unknown reported', countMessages(t.win, 'unknown'), 1);
    t.render(payloadOf('u-unknown'));
    c.equals('unknown dedupe by unit id', countMessages(t.win, 'unknown'), 1);
    c.equals('no folding in unknown state', countMessages(t.win, 'blocked'), 0);
  }

  /* --- folding happens by default (no dry run) --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-1' });
    const folded = t.render(payloadOf('u1'));
    c.ok('matched unit folds with factory-default settings', folded.type === t.React.Fragment);
    c.equals('blocked reported without any settings change', countMessages(t.win, 'blocked'), 1);
  }

  /* --- folding + toggling + settings gating --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-1' });

    const folded = t.render(payloadOf('u1'));
    c.equals('folded render is a Fragment', folded.type, t.React.Fragment);
    const children = folded.props.children;
    c.equals('fragment holds bar + hidden container', children.length, 2);
    const bar = children[0];
    const hidden = children[1];
    c.equals('bar is FBDietBar', bar.type, t.fold.FBDietBar);
    c.equals('bar gets the category', bar.props.category, 'sponsored');
    c.ok('bar carries the toggle callback', typeof bar.props.onToggle === 'function');
    c.equals('hidden container class', hidden.props.className, 'fb-diet-fold-hidden');
    c.equals('aria-hidden set', hidden.props['aria-hidden'], 'true');
    const inner = Array.isArray(hidden.props.children) ? hidden.props.children[0] : hidden.props.children;
    c.ok('original subtree stays mounted inside the hidden container', inner.__source === true);
    c.equals('blocked message posted once', countMessages(t.win, 'blocked'), 1);

    bar.props.onToggle();
    c.equals('toggle marks the unit expanded', t.bridge.isExpanded('u1'), true);
    const expanded = t.render(payloadOf('u1'));
    c.ok('expanded render is untouched', expanded.__source === true);
    c.equals('no duplicate blocked report after expand', countMessages(t.win, 'blocked'), 1);

    t.bridge.toggle('u1');
    c.equals('collapsing folds it again', t.render(payloadOf('u1')).type, t.React.Fragment);

    t.bridge.setSettings({ enabled: false });
    c.equals('settings change dispatches a refresh event', t.win.__events.filter((e) => e.type === 'fb-diet:settings-changed').length >= 1, true);
    c.ok('master off renders untouched', t.render(payloadOf('u1')).__source === true);
    t.bridge.setSettings({ enabled: true });

    t.bridge.setSettings({ removeSponsored: false });
    c.ok('category off renders untouched', t.render(payloadOf('u1')).__source === true);
    t.bridge.setSettings({ removeSponsored: true });
    c.ok('category restored folds again', t.render(payloadOf('u1')).type === t.React.Fragment);
  }

  /* --- multiple categories block independently --- */
  {
    const t = setup((id, path) => {
      if (id === 'u-ad' && path === SPONSORED_PATH) return 'ad-2';
      if (id === 'u-sub' && path === '^^actors[0].subscribe_status') return 'CAN_SUBSCRIBE';
      return null;
    });
    t.render(payloadOf('u-ad'));
    t.render(payloadOf('u-sub'));
    c.equals('one blocked report per unit', countMessages(t.win, 'blocked'), 2);
    const blocked = t.win.__messages.filter((m) => m.type === 'blocked').map((m) => m.payload.category);
    c.ok('sponsored reported', blocked.indexOf('sponsored') !== -1);
    c.ok('suggested also reported', blocked.indexOf('suggested') !== -1);
  }

  /* --- hostile payload never crashes the feed --- */
  {
    const t = setup({});
    const hostile = {};
    Object.defineProperty(hostile, 'feedUnit', {
      get() {
        throw new Error('hostile');
      }
    });
    let result = null;
    try {
      result = t.render(hostile);
    } catch (e) {
      /* must never happen */
    }
    c.ok('hostile payload degrades to the untouched render', Boolean(result) && result.__source === true);
  }
}

module.exports = { run, FEED_MODULE };