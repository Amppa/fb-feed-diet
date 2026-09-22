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
  loadInject(win, 'ui.js');
  loadInject(win, 'probe.js');
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
      if (element && typeof element.type === 'function') {
        element.type(element.props);
        React.resetHooks();
        return element.type(element.props);
      }
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
    c.equals('HIDE_MODE is squash', t.fold.HIDE_MODE, 'squash');
  }

  /* --- two-layer classification: category -> user-facing group --- */
  {
    const t = setup({});
    c.equals('sponsored belongs to ads group', t.fold.groupOf('sponsored'), 'ads');
    c.equals('marketplace ad belongs to ads group', t.fold.groupOf('marketAds'), 'ads');
    c.equals('reels belongs to media group', t.fold.groupOf('reels'), 'media');
    c.equals('stories belongs to media group', t.fold.groupOf('stories'), 'media');
    c.equals('suggested group belongs to other group', t.fold.groupOf('suggestedGroup'), 'other');
    c.equals('unknown category falls back to regular group', t.fold.groupOf('nope'), 'regular');
    c.equals('group meta covers every group', ['ads', 'regular', 'suggested', 'media', 'other'].every((g) => Boolean(t.fold.GROUP_META[g])), true);
  }

  /* --- regular payload: unfolded with regular header bar + reported once --- */
  {
    const t = setup({});
    t.bridge.setSettings({ minimizedFoldMode: true });
    const result = t.render(payloadOf('u-regular'));
    c.ok('regular unit renders unfolded with header bar', result.type === t.React.Fragment && Array.isArray(result.props.children));
    const [headerBar, body] = result.props.children;
    c.equals('header bar is FBDietTitleBar', headerBar.type, t.fold.FBDietTitleBar);
    c.equals('header bar isExpanded is true', headerBar.props.isExpanded, true);
    const headerBarRender = headerBar.type(headerBar.props);
    c.ok('header bar has expanded state class', headerBarRender.props.className.indexOf('fb-diet-state-expanded') !== -1);
    const inner = Array.isArray(body.props.children) ? body.props.children[0] : body.props.children;
    c.ok('regular original subtree stays mounted', inner.__source === true);
    c.equals('regular reported', countMessages(t.win, 'regular'), 1);
    const regularMsg = t.win.__messages.filter((m) => m && m.type === 'regular')[0];
    c.equals('regular report carries the no-match reason', regularMsg && regularMsg.payload.reason, 'no-match');
    t.render(payloadOf('u-regular'));
    c.equals('regular dedupe by unit id', countMessages(t.win, 'regular'), 1);
    c.equals('no folding in regular default state', countMessages(t.win, 'blocked'), 0);

    // Can be folded manually by clicking the header toggle
    headerBar.props.onToggle();
    c.ok('toggling regular folds it', t.bridge.isUnitFolded('u-regular', false) === true);
    const foldedRegular = t.render(payloadOf('u-regular'));
    c.equals('folded regular has FBDietTitleBar', foldedRegular.props.children[0].type, t.fold.FBDietTitleBar);
    c.equals('folded regular has isMini true', foldedRegular.props.children[0].props.isMini, true);
  }

  /* --- regular payload with default settings: 36px title bar when unfolded --- */
  {
    const t = setup({});
    // minimizedFoldMode is false by default, alwaysShowFoldTitle is true by default
    const result = t.render(payloadOf('u-regular-default'));
    c.ok('regular default renders FBDietTitleBar (36px)', result.type === t.React.Fragment && result.props.children[0].type === t.fold.FBDietTitleBar);
    c.equals('title bar isExpanded is true', result.props.children[0].props.isExpanded, true);
  }

  /* --- category disabled renders unfolded with header bar + reports allowed --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-allowed' });
    t.bridge.setSettings({ foldSponsored: false, minimizedFoldMode: true });
    const result = t.render(payloadOf('u-allowed'));
    c.ok('disabled category renders unfolded with header bar', result.type === t.React.Fragment && Array.isArray(result.props.children));
    const [headerBar] = result.props.children;
    const headerBarRender = headerBar.type(headerBar.props);
    c.ok('header bar is in expanded state', headerBarRender.props.className.indexOf('fb-diet-state-expanded') !== -1);
    c.equals('allowed reported', countMessages(t.win, 'allowed'), 1);
    c.equals('not blocked', countMessages(t.win, 'blocked'), 0);
  }

  /* --- folding happens by default (no dry run) --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-1' });
    const folded = t.render(payloadOf('u1'));
    c.ok('matched unit folds with factory-default settings', folded.type === t.React.Fragment);
    c.equals('blocked reported without any settings change', countMessages(t.win, 'blocked'), 1);
  }

  /* --- folding + toggling + settings gating (mini mode) --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-1' });
    t.bridge.setSettings({ minimizedFoldMode: true });

    const folded = t.render(payloadOf('u1'));
    c.equals('folded render is a Fragment', folded.type, t.React.Fragment);
    const children = folded.props.children;
    c.equals('fragment holds bar + hidden container', children.length, 2);
    const bar = children[0];
    const hidden = children[1];
    c.equals('bar is FBDietTitleBar', bar.type, t.fold.FBDietTitleBar);
    c.equals('bar isMini is true', bar.props.isMini, true);
    c.equals('bar gets the category', bar.props.category, 'sponsored');
    c.ok('bar carries the toggle callback', typeof bar.props.onToggle === 'function');
    c.equals('hidden container class', hidden.props.className, 'fb-diet-fold-hidden fb-diet-foldsquash');
    c.equals('aria-hidden set', hidden.props['aria-hidden'], 'true');
    const inner = Array.isArray(hidden.props.children) ? hidden.props.children[0] : hidden.props.children;
    c.ok('original subtree stays mounted inside the hidden container', inner.__source === true);
    c.equals('blocked message posted once', countMessages(t.win, 'blocked'), 1);

    bar.props.onToggle();
    c.equals('toggle marks the unit expanded', t.bridge.isExpanded('u1'), true);
    const expanded = t.render(payloadOf('u1'));
    c.ok('expanded render shows the re-fold bar + body', expanded.type === t.React.Fragment && Array.isArray(expanded.props.children) && expanded.props.children.length === 2);
    const expandedBody = expanded.props.children[1];
    const expandedInner = Array.isArray(expandedBody.props.children) ? expandedBody.props.children[0] : expandedBody.props.children;
    c.ok('original subtree stays mounted when expanded', expandedInner.__source === true);
    c.equals('no duplicate blocked report after expand', countMessages(t.win, 'blocked'), 1);

    t.bridge.toggle('u1');
    c.equals('collapsing folds it again', t.render(payloadOf('u1')).type, t.React.Fragment);

    t.bridge.setSettings({ enabled: false, minimizedFoldMode: true });
    c.equals('settings change dispatches a refresh event', t.win.__events.filter((e) => e.type === 'fb-diet:settings-changed').length >= 1, true);
    c.ok('master off renders untouched', t.render(payloadOf('u1')).__source === true);
    t.bridge.setSettings({ enabled: true, minimizedFoldMode: true });

    t.bridge.setSettings({ foldSponsored: false, minimizedFoldMode: true });
    const unfoldedOff = t.render(payloadOf('u1'));
    const [offHeaderBar] = unfoldedOff.props.children;
    const offHeaderRender = offHeaderBar.type(offHeaderBar.props);
    c.ok('category off renders unfolded with header bar', unfoldedOff.type === t.React.Fragment && offHeaderRender.props.className.indexOf('fb-diet-state-expanded') !== -1);

    t.bridge.setSettings({ foldSponsored: false, minimizedFoldMode: true, alwaysShowFoldBar: false });
    const unfoldedClean = t.render(payloadOf('u1'));
    c.ok('alwaysShowFoldBar off renders native without bar', unfoldedClean.__source === true);

    t.bridge.setSettings({ foldSponsored: false, minimizedFoldMode: false, alwaysShowFoldBar: true });
    const unfoldedTitleBar = t.render(payloadOf('u1'));
    c.ok('alwaysShowFoldBar on + mini off renders unfolded with title bar', unfoldedTitleBar.type === t.React.Fragment && unfoldedTitleBar.props.children[0].type === t.fold.FBDietTitleBar);

    t.bridge.setSettings({ foldSponsored: true, minimizedFoldMode: true, alwaysShowFoldBar: true });
    c.ok('category restored folds again', t.render(payloadOf('u1')).type === t.React.Fragment && t.render(payloadOf('u1')).props.children[0].type === t.fold.FBDietTitleBar);
    c.equals('category restored has isMini true', t.render(payloadOf('u1')).props.children[0].props.isMini, true);
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

  /* --- feed probe button (debug diagnostics) --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-1' });
    // Probe off by default: the folded output is a plain Fragment
    c.ok('no probe by default', t.render(payloadOf('u1')).type === t.React.Fragment);
    // Probe on: the output becomes a holder div with the copy button + the fold
    t.bridge.setSettings({ debugProbe: true });
    const probed = t.render(payloadOf('u1'));
    c.ok('probe on wraps the fold', probed.type === 'div' && probed.props.className === 'fb-diet-probe-holder');
    const probeKids = probed.props.children;
    c.ok('probe holder carries button + fold', Array.isArray(probeKids) && probeKids.length === 2 && probeKids[0].props.className === 'fb-diet-probe-btn');
    c.ok('probe button carries a click handler', typeof probeKids[0].props.onClick === 'function');
    // Clicking must not throw even inside the test harness
    let clickThrew = false;
    try {
      probeKids[0].props.onClick({ stopPropagation() {}, preventDefault() {} });
    } catch (e) {
      clickThrew = true;
    }
    c.ok('probe click survives the harness', clickThrew === false);
    // Probe off again: back to the plain fold
    t.bridge.setSettings({ debugProbe: false });
    c.ok('probe off restores the plain fold', t.render(payloadOf('u1')).type === t.React.Fragment);

    /* --- probe report shape (Probe v2) --- */
    const classifyRes = {
      category: 'sponsored',
      unitId: 'u1',
      unitTypename: 'FeedUnitRoot',
      reason: 'sponsored_data.ad_id',
      evidence: { ownTypename: 'FeedUnitRoot', adId: 'ad-1', id: 'u1', idCount: 1 }
    };
    const reportWithoutEntry = t.fold.buildUnitProbeReport({ payload: { feedUnit: { id: 'u1', __typename: 'FeedUnitRoot', post_id: 'p123' } } }, classifyRes, []).report;
    c.equals('entryCategory omitted when null', reportWithoutEntry.entryCategory, undefined);
    c.equals('settings omitted from report', reportWithoutEntry.settings, undefined);
    c.equals('top-level unitTypename removed', reportWithoutEntry.unitTypename, undefined);
    c.equals('payload.feedUnit post_id preserved', reportWithoutEntry.payload.feedUnit.post_id, 'p123');
    c.equals('payload.feedUnit __id removed', reportWithoutEntry.payload.feedUnit.__id, undefined);
    c.equals('payload.feedUnit __typename removed', reportWithoutEntry.payload.feedUnit.__typename, undefined);
    c.ok('payloadKeys captured', Array.isArray(reportWithoutEntry.payload.payloadKeys));
    c.ok('feedUnitKeys captured', Array.isArray(reportWithoutEntry.payload.feedUnitKeys));
    c.equals('version is 2.0.0', reportWithoutEntry.version, '2.0.0');
    c.ok('at.rendered present', Boolean(reportWithoutEntry.at && reportWithoutEntry.at.rendered));
    c.ok('at.probed present', Boolean(reportWithoutEntry.at && reportWithoutEntry.at.probed));
    c.ok('memory object present', Boolean(reportWithoutEntry.memory));
    c.ok('dom object present', Boolean(reportWithoutEntry.dom));
    c.ok('url object present', Boolean(reportWithoutEntry.url));
    c.equals('outer enrichment removed', reportWithoutEntry.enrichment, undefined);

    const reportWithSignals = t.fold.buildUnitProbeReport({
      payload: {
        feedUnit: {
          comet_sections: {
            header: {
              story: {
                title: { text: '為你推薦' }
              }
            }
          }
        }
      }
    }, classifyRes, []).report;
    c.ok('diagnostic signals extracted', Array.isArray(reportWithSignals.signals) && reportWithSignals.signals.length > 0);
    c.equals('signal path matches', reportWithSignals.signals[0].path, 'feedUnit.comet_sections.header.story.title.text');
    c.equals('signal value matches', reportWithSignals.signals[0].value, '為你推薦');

    const reportWithEntry = t.fold.buildUnitProbeReport({ entryCategory: 'marketAds', payload: { feedUnit: {} } }, classifyRes, []).report;
    c.equals('entryCategory present when provided', reportWithEntry.entryCategory, 'marketAds');
  }

  /* --- 3-tier fold mode: title mode (24px persistent header bar) --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-title' });
    t.bridge.setSettings({ foldSponsored: 'title' });

    // Collapsed title state: renders FBDietTitleBar with [+]
    const folded = t.render(payloadOf('u-title'));
    c.ok('title mode render is a Fragment', folded.type === t.React.Fragment);
    const [titleBar, body] = folded.props.children;
    c.equals('title bar is FBDietTitleBar', titleBar.type, t.fold.FBDietTitleBar);
    c.ok('title bar is collapsed', titleBar.props.isExpanded === false);
    c.ok('body is hidden container', body.props.className.indexOf('fb-diet-fold-hidden') !== -1);
    const titleBarRender = titleBar.type(titleBar.props);
    c.ok('title bar rendered div has fb-diet-titlebar', titleBarRender.props.className.indexOf('fb-diet-titlebar') !== -1);

    // Toggle expand: title bar stays mounted, isExpanded becomes true ([-]), body revealed
    titleBar.props.onToggle();
    const expanded = t.render(payloadOf('u-title'));
    const [expandedTitleBar, expandedBody] = expanded.props.children;
    c.equals('expanded title bar stays FBDietTitleBar', expandedTitleBar.type, t.fold.FBDietTitleBar);
    c.ok('expanded title bar isExpanded is true', expandedTitleBar.props.isExpanded === true);
    const expandedTitleRender = expandedTitleBar.type(expandedTitleBar.props);
    c.ok('expanded title bar has expanded state class', expandedTitleRender.props.className.indexOf('fb-diet-state-expanded') !== -1);
    c.ok('expanded body is visible container', expandedBody.props.className.indexOf('fb-diet-expand-body') !== -1);

    // Toggle collapse: folds back to 24px!
    expandedTitleBar.props.onToggle();
    const reFolded = t.render(payloadOf('u-title'));
    c.ok('re-folded title bar is collapsed again', reFolded.props.children[0].props.isExpanded === false);
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