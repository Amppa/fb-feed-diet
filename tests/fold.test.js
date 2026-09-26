'use strict';
const { Checker, createFakeReact, makeNode, createWindow, loadInject, loadDefaults, createFakeComet, countMessages } = require('./harness');

const FEED_MODULE = 'CometFeedUnitErrorBoundary.react';
const SPONSORED_PATH = '^sponsored_data.ad_id';

function setup(relayMap, opts) {
  const React = createFakeReact();
  const win = createWindow();
  const comet = createFakeComet(win, React);

  win.FB_DIET_DEFAULTS = loadDefaults();
  loadInject(win, 'proxy.js');
  loadInject(win, 'metadata.js');
  loadInject(win, 'classify.js');
  loadInject(win, 'bridge.js');
  loadInject(win, 'dom-suggested.js');
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
  let wrapper = null;
  if (!(opts && opts.noFeedModule)) {
    win.__d(SourceCmp, FEED_MODULE, [], null, null, null, { default: SourceCmp });
    comet.require(FEED_MODULE);
    wrapper = comet.getExport(FEED_MODULE).default;
  }

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
    c.equals('fold exposes every feed module', t.fold.FEED_UNIT_MODULES.length, 15);
    c.ok('every feed module has a definer path', t.fold.FEED_UNIT_MODULES.every((item) => typeof item.definerPath === 'string' && item.definerPath));
    c.equals('right rail keeps its render definer path', t.fold.FEED_UNIT_MODULES.find((item) => item.name === 'CometHomeRightRailUnit.react').definerPath, '[6].default.render');
    c.ok('every feed module is registered', t.fold.FEED_UNIT_MODULES.every((item) => Boolean(t.proxy.listRegistered()[item.name])));
    c.equals('detectOnly removed from defaults', 'detectOnly' in t.bridge.getSettings(), false);
    c.equals('ready message announced at load', countMessages(t.win, 'ready'), 1);
    c.equals('HIDE_MODE is squash', t.fold.HIDE_MODE, 'squash');
  }

  /* --- two-layer classification: category -> user-facing group --- */
  {
    const t = setup({});
    const ui = t.win.FBDietUI;
    c.equals('sponsored belongs to ads group', ui.groupOf('sponsored'), 'ads');
    c.equals('marketplace ad belongs to ads group', ui.groupOf('marketAds'), 'ads');
    c.equals('reels belongs to media group', ui.groupOf('reels'), 'media');
    c.equals('stories belongs to media group', ui.groupOf('stories'), 'media');
    c.equals('suggested group belongs to other group', ui.groupOf('suggestedGroup'), 'other');
    c.equals('unknown category falls back to regular group', ui.groupOf('nope'), 'regular');
    c.equals('group meta covers every group', ['ads', 'regular', 'suggested', 'media', 'other'].every((g) => Boolean(ui.GROUP_META[g])), true);
  }

  /* --- regular payload: unfolded with regular header bar + reported once --- */
  {
    const t = setup({});
    t.bridge.setSettings({ minimizedFoldMode: true });
    const result = t.render(payloadOf('u-regular'));
    c.ok('regular unit renders unfolded with header bar', result.type === t.React.Fragment && Array.isArray(result.props.children));
    const [headerBar, body] = result.props.children;
    c.equals('header bar is FBDietTitleBar', headerBar.type, t.win.FBDietUI.FBDietTitleBar);
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
    c.equals('folded regular has FBDietTitleBar', foldedRegular.props.children[0].type, t.win.FBDietUI.FBDietTitleBar);
    c.equals('folded regular has isMini true', foldedRegular.props.children[0].props.isMini, true);
  }

  /* --- regular payload with default settings: 36px title bar when unfolded --- */
  {
    const t = setup({});
    // minimizedFoldMode is false by default, alwaysShowFoldBar is true by default
    const result = t.render(payloadOf('u-regular-default'));
    c.ok('regular default renders FBDietTitleBar (36px)', result.type === t.React.Fragment && result.props.children[0].type === t.win.FBDietUI.FBDietTitleBar);
    c.equals('title bar isExpanded is true', result.props.children[0].props.isExpanded, true);
  }

  /* --- category disabled renders unfolded with header bar + reports allowed --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-allowed' });
    t.bridge.setSettings({ foldAds: false, minimizedFoldMode: true });
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
    c.equals('bar is FBDietTitleBar', bar.type, t.win.FBDietUI.FBDietTitleBar);
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

    t.bridge.setSettings({ foldAds: false, minimizedFoldMode: true });
    const unfoldedOff = t.render(payloadOf('u1'));
    const [offHeaderBar] = unfoldedOff.props.children;
    const offHeaderRender = offHeaderBar.type(offHeaderBar.props);
    c.ok('category off renders unfolded with header bar', unfoldedOff.type === t.React.Fragment && offHeaderRender.props.className.indexOf('fb-diet-state-expanded') !== -1);

    t.bridge.setSettings({ foldAds: false, minimizedFoldMode: true, alwaysShowFoldBar: false });
    const unfoldedClean = t.render(payloadOf('u1'));
    const cleanSource = unfoldedClean && (unfoldedClean.__source === true || (unfoldedClean.props && unfoldedClean.props.children && (unfoldedClean.props.children.__source === true || (Array.isArray(unfoldedClean.props.children) && unfoldedClean.props.children[0] && unfoldedClean.props.children[0].__source === true))));
    c.ok('alwaysShowFoldBar off renders native without bar', Boolean(cleanSource));

    t.bridge.setSettings({ foldAds: false, minimizedFoldMode: false, alwaysShowFoldBar: true });
    const unfoldedTitleBar = t.render(payloadOf('u1'));
    c.ok('alwaysShowFoldBar on + mini off renders unfolded with title bar', unfoldedTitleBar.type === t.React.Fragment && unfoldedTitleBar.props.children[0].type === t.win.FBDietUI.FBDietTitleBar);

    t.bridge.setSettings({ foldAds: true, minimizedFoldMode: true, alwaysShowFoldBar: true });
    c.ok('category restored folds again', t.render(payloadOf('u1')).type === t.React.Fragment && t.render(payloadOf('u1')).props.children[0].type === t.win.FBDietUI.FBDietTitleBar);
    c.equals('category restored has isMini true', t.render(payloadOf('u1')).props.children[0].props.isMini, true);
  }

  /* --- multiple categories block independently --- */
  {
    const t = setup((id, path) => {
      if (id === 'u-ad' && path === SPONSORED_PATH) return 'ad-2';
      if (id === 'u-sub' && path === '^^actors[0].subscribe_status') return 'CAN_SUBSCRIBE';
      return null;
    });
    t.bridge.setSettings({ foldSuggested: true });
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
    const probeGroup = Array.isArray(probeKids) && probeKids[0];
    const probeButtons = probeGroup && probeGroup.props && probeGroup.props.children;
    c.ok('probe holder carries button group + fold', Array.isArray(probeKids) && probeKids.length === 2 && probeGroup.props.className === 'fb-diet-probe-group');
    c.ok('probe group carries dual buttons (proxy and dom)', Array.isArray(probeButtons) && probeButtons.length === 2 && probeButtons[0].props.className.includes('fb-diet-probe-btn-proxy') && probeButtons[1].props.className.includes('fb-diet-probe-btn-dom'));
    c.ok('proxy probe button carries a click handler', typeof probeButtons[0].props.onClick === 'function');
    c.ok('dom probe button carries a click handler', typeof probeButtons[1].props.onClick === 'function');
    // Clicking must not throw even inside the test harness
    let clickThrew = false;
    try {
      probeButtons[0].props.onClick({ stopPropagation() {}, preventDefault() {} });
      probeButtons[1].props.onClick({ stopPropagation() {}, preventDefault() {} });
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
    const reportWithoutEntry = t.win.FBDietProbe.buildUnitProbeReport({ payload: { feedUnit: { id: 'u1', __typename: 'FeedUnitRoot', post_id: 'p123' } } }, classifyRes, []).report;
    c.equals('entryCategory omitted when null', reportWithoutEntry.entryCategory, undefined);
    c.equals('settings omitted from report', reportWithoutEntry.settings, undefined);
    c.equals('top-level unitTypename removed', reportWithoutEntry.unitTypename, undefined);
    c.equals('payload.feedUnit post_id preserved', reportWithoutEntry.payload.feedUnit.post_id, 'p123');
    c.equals('payload.feedUnit __id removed', reportWithoutEntry.payload.feedUnit.__id, undefined);
    c.equals('payload.feedUnit __typename removed', reportWithoutEntry.payload.feedUnit.__typename, undefined);
    c.ok('payloadKeys captured', Array.isArray(reportWithoutEntry.payload.payloadKeys));
    c.ok('feedUnitKeys captured', Array.isArray(reportWithoutEntry.payload.feedUnitKeys));
    c.equals('version matches FB_DIET_DEFAULTS.VERSION', reportWithoutEntry.version, t.win.FB_DIET_DEFAULTS.VERSION);
    c.ok('at.rendered present', Boolean(reportWithoutEntry.at && reportWithoutEntry.at.rendered));
    c.ok('at.probed present', Boolean(reportWithoutEntry.at && reportWithoutEntry.at.probed));
    c.ok('memory object present', Boolean(reportWithoutEntry.memory));
    c.ok('dom object present', Boolean(reportWithoutEntry.dom));
    c.ok('url object present', Boolean(reportWithoutEntry.url));
    c.equals('outer enrichment removed', reportWithoutEntry.enrichment, undefined);

    const reportWithSignals = t.win.FBDietProbe.buildUnitProbeReport({
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

    const reportWithEntry = t.win.FBDietProbe.buildUnitProbeReport({ entryCategory: 'marketAds', payload: { feedUnit: {} } }, classifyRes, []).report;
    c.equals('entryCategory present when provided', reportWithEntry.entryCategory, 'marketAds');

    /* --- probe report scope fields (STRATEGY.md decision #26) --- */
    c.ok('scope object present', Boolean(reportWithoutEntry.scope) && typeof reportWithoutEntry.scope === 'object');
    c.equals('scope.restricted reflects the default restriction', reportWithoutEntry.scope.restricted, true);
    c.equals('scope.path is null without a pathname', reportWithoutEntry.scope.path, null);

    const tScope = setup({});
    tScope.win.FB_DIET_DEFAULTS = loadDefaults();
    tScope.win.location.pathname = '/groups/feed';
    const outOfScopeReport = tScope.win.FBDietProbe.buildUnitProbeReport({ payload: { feedUnit: {} } }, classifyRes, []).report;
    c.equals('scope.path captures the page pathname', outOfScopeReport.scope.path, '/groups/feed');
    c.equals('scope.allowed is false on /groups', outOfScopeReport.scope.allowed, false);
    tScope.bridge.setSettings({ restrictFoldScope: false });
    const unrestrictedReport = tScope.win.FBDietProbe.buildUnitProbeReport({ payload: { feedUnit: {} } }, classifyRes, []).report;
    c.equals('scope.restricted false when the toggle is off', unrestrictedReport.scope.restricted, false);
    c.equals('scope.allowed true when the toggle is off', unrestrictedReport.scope.allowed, true);
  }

  /* --- 3-tier fold mode: title mode (24px persistent header bar) --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-title' });
    t.bridge.setSettings({ foldAds: 'title' });

    // Collapsed title state: renders FBDietTitleBar with [+]
    const folded = t.render(payloadOf('u-title'));
    c.ok('title mode render is a Fragment', folded.type === t.React.Fragment);
    const [titleBar, body] = folded.props.children;
    c.equals('title bar is FBDietTitleBar', titleBar.type, t.win.FBDietUI.FBDietTitleBar);
    c.ok('title bar is collapsed', titleBar.props.isExpanded === false);
    c.ok('body is hidden container', body.props.className.indexOf('fb-diet-fold-hidden') !== -1);
    const titleBarRender = titleBar.type(titleBar.props);
    c.ok('title bar rendered div has fb-diet-titlebar', titleBarRender.props.className.indexOf('fb-diet-titlebar') !== -1);

    // Toggle expand: title bar stays mounted, isExpanded becomes true ([-]), body revealed
    titleBar.props.onToggle();
    const expanded = t.render(payloadOf('u-title'));
    const [expandedTitleBar, expandedBody] = expanded.props.children;
    c.equals('expanded title bar stays FBDietTitleBar', expandedTitleBar.type, t.win.FBDietUI.FBDietTitleBar);
    c.ok('expanded title bar isExpanded is true', expandedTitleBar.props.isExpanded === true);
    const expandedTitleRender = expandedTitleBar.type(expandedTitleBar.props);
    c.ok('expanded title bar has expanded state class', expandedTitleRender.props.className.indexOf('fb-diet-state-expanded') !== -1);
    c.ok('expanded body is visible container', expandedBody.props.className.indexOf('fb-diet-expand-body') !== -1);

    // Toggle collapse: folds back to 24px!
    expandedTitleBar.props.onToggle();
    const reFolded = t.render(payloadOf('u-title'));
    c.ok('re-folded title bar is collapsed again', reFolded.props.children[0].props.isExpanded === false);
  }

  /* --- fold scope restriction: out-of-scope units stay native (STRATEGY.md decision #26) --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-1' });
    t.win.FB_DIET_DEFAULTS = loadDefaults();
    t.win.location.pathname = '/groups/feed';

    const untouched = t.render(payloadOf('u-scope'));
    c.ok('out-of-scope unit renders untouched', untouched.__source === true);
    c.equals('out-of-scope posts no blocked message', countMessages(t.win, 'blocked'), 0);
    c.equals('out-of-scope posts no regular message', countMessages(t.win, 'regular'), 0);
    c.equals('out-of-scope posts no allowed message', countMessages(t.win, 'allowed'), 0);

    // Toggle off: restriction lifts and the same unit folds on an out-of-scope path
    t.bridge.setSettings({ restrictFoldScope: false });
    const unrestricted = t.render(payloadOf('u-scope'));
    c.ok('restrictFoldScope:false folds outside the allowlist', unrestricted.type === t.React.Fragment);
    c.equals('restriction off reports blocked once', countMessages(t.win, 'blocked'), 1);

    // Toggle back on, navigate in-scope: folding resumes under the restriction
    t.bridge.setSettings({ restrictFoldScope: true });
    t.win.location.pathname = '/';
    const inScope = t.render(payloadOf('u-scope-2'));
    c.ok('in-scope unit folds with the restriction on', inScope.type === t.React.Fragment);
    c.equals('in-scope blocked reported', countMessages(t.win, 'blocked'), 2);
  }

  /* --- side-rail ad: hiding independent of scope, never counted (decision #26) --- */
  {
    const t = setup({});
    t.win.FB_DIET_DEFAULTS = loadDefaults();
    t.win.location.pathname = '/groups/feed';

    function SideSourceCmp() {
      return { type: 'div', props: { children: 'side ad' }, __source: true };
    }
    t.win.__d(SideSourceCmp, 'CometAdsSideFeedUnitItem.react', [], null, null, null, { default: SideSourceCmp });
    t.comet.require('CometAdsSideFeedUnitItem.react');
    const sideWrapper = t.comet.getExport('CometAdsSideFeedUnitItem.react').default;

    // Emulate the hydration commit gate: first pass commits the layout effect,
    // second pass renders the hidden node.
    t.React.resetHooks();
    const element = sideWrapper({ feedUnit: { id: 'side-1' } });
    c.ok('side wrapper carries lastCmp + payload', Boolean(element.props.lastCmp) && Boolean(element.props.payload));
    element.type(element.props);
    t.React.resetHooks();
    const hidden = element.type(element.props);

    c.ok('side ad hides on an out-of-scope page', Boolean(hidden) && hidden.type === 'div' && hidden.props.className === 'adhidden fb-diet-side-ad-hidden');
    c.equals('side ad hiding posts no blocked message', countMessages(t.win, 'blocked'), 0);
  }

  /* --- fold bar title modes: showTitleMode three-state (STRATEGY.md decision #27) --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-1' });
    t.win.FB_DIET_DEFAULTS = loadDefaults();

    // In Lite mode, title is always disabled regardless of showTitleMode
    t.bridge.setSettings({ dietMode: 'lite', showTitleMode: 'always' });
    let outLite = t.render(payloadOf('u-titlemode-lite'));
    c.equals('lite mode disables title bar even with always', outLite.props.children[0].props.showTitle, false);

    // In Full mode, default showTitleMode = 'whenFolded': folded bars show the title text...
    t.bridge.setSettings({ dietMode: 'full', showTitleMode: 'whenFolded' });
    let out = t.render(payloadOf('u-titlemode'));
    c.ok('default mode folds the unit', out.type === t.React.Fragment);
    c.equals('folded bar shows the title under whenFolded', out.props.children[0].props.showTitle, true);

    // ...and expanded bars keep only the badge
    out.props.children[0].props.onToggle();
    out = t.render(payloadOf('u-titlemode'));
    c.equals('expanded bar hides the title under whenFolded', out.props.children[0].props.showTitle, false);

    // Fold it again for the remaining mode checks
    t.bridge.toggle('u-titlemode');
    out = t.render(payloadOf('u-titlemode'));
    c.equals('unit folds again', out.props.children[0].props.isExpanded, false);

    // 'always': title visible even while folded AND when expanded
    t.bridge.setSettings({ showTitleMode: 'always' });
    out = t.render(payloadOf('u-titlemode'));
    c.equals('folded bar shows the title under always', out.props.children[0].props.showTitle, true);
    out.props.children[0].props.onToggle();
    out = t.render(payloadOf('u-titlemode'));
    c.equals('expanded bar shows the title under always', out.props.children[0].props.showTitle, true);
    out.props.children[0].props.onToggle(); // fold back

    // 'never': no title in either state
    t.bridge.setSettings({ showTitleMode: 'never' });
    out = t.render(payloadOf('u-titlemode'));
    c.equals('folded bar hides the title under never', out.props.children[0].props.showTitle, false);
    out.props.children[0].props.onToggle();
    out = t.render(payloadOf('u-titlemode'));
    c.equals('expanded bar hides the title under never', out.props.children[0].props.showTitle, false);

    // Zero-compat policy: the legacy showFeedTitle boolean has no influence at all — a
    // missing showTitleMode falls back to the schema default ('whenFolded').
    t.bridge.toggle('u-titlemode'); // fold again
    t.bridge.setSettings({ showTitleMode: undefined, showFeedTitle: false });
    out = t.render(payloadOf('u-titlemode'));
    c.equals('missing showTitleMode falls back to whenFolded while folded', out.props.children[0].props.showTitle, true);
    c.equals('legacy showFeedTitle:false no longer hides the folded title', out.props.children[0].props.showTitle, true);

    // The legacy key is ignored in both directions: true behaves exactly like false.
    t.bridge.setSettings({ showFeedTitle: true });
    out = t.render(payloadOf('u-titlemode'));
    c.equals('legacy showFeedTitle:true changes nothing while folded', out.props.children[0].props.showTitle, true);
    out.props.children[0].props.onToggle();
    out = t.render(payloadOf('u-titlemode'));
    c.equals('legacy showFeedTitle:true changes nothing when expanded', out.props.children[0].props.showTitle, false);
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
    const cleanResult = result && (result.__source === true || (result.props && result.props.children && (result.props.children.__source === true || (Array.isArray(result.props.children) && result.props.children[0] && result.props.children[0].__source === true))));
    c.ok('hostile payload degrades to the untouched render', Boolean(cleanResult));
  }

  /* --- title bar DOM extraction and author/snippet display --- */
  {
    const t = setup({});
    const ui = t.win.FBDietUI;
    ui.titleBarCache.set('u-dom-title', {
      actorName: 'Hedy Lamarr',
      snippetText: 'Spread spectrum technology',
      groupName: '',
      adUrl: ''
    });
    t.React.resetHooks();
    const renderedBar = ui.FBDietTitleBar({
      category: 'suggested',
      unitId: 'u-dom-title',
      showTitle: true,
      isExpanded: true
    });
    c.ok('title bar rendered element', Boolean(renderedBar) && renderedBar.props.className.includes('fb-diet-titlebar'));
    const contentBox = renderedBar.props.children;
    const kids = contentBox.props.children;
    c.equals('badge rendered', kids[0].props.className, 'fb-diet-badge fb-diet-badge-suggested');
    c.equals('author rendered', kids[1].props.children, 'Hedy Lamarr:');
    c.equals('snippet rendered', kids[2].props.children, 'Spread spectrum technology');
  }

  /* --- full mode, always show title, folded state displays title extracted from DOM --- */
  {
    const t = setup({ '^^actors[0].subscribe_status': 'CAN_SUBSCRIBE' });
    t.bridge.setSettings({
      enabled: true,
      dietMode: 'full',
      showTitleMode: 'always',
      foldSuggested: true
    });

    const unitId = 'u-full-always-fold';
    const payload = payloadOf(unitId);

    // 1. Initial render of FBDietFold in folded state
    t.React.resetHooks();
    const foldOut = t.render(payload);
    c.ok('full mode folded output is Fragment', foldOut.type === t.React.Fragment);

    const [barEl, hiddenContainerEl] = foldOut.props.children;
    c.equals('notice bar receives category suggested', barEl.props.category, 'suggested');
    c.equals('notice bar receives unitId', barEl.props.unitId, unitId);
    c.equals('folded bar has showTitle: true under always mode', barEl.props.showTitle, true);
    c.equals('folded bar has isExpanded: false in folded state', barEl.props.isExpanded, false);
    c.equals('squash container has fb-diet-fold-hidden class', hiddenContainerEl.props.className, 'fb-diet-fold-hidden fb-diet-foldsquash');

    // 2. Construct simulated DOM inside the folded container:
    // Recommendation header (should be skipped), Real Author heading, Action buttons, Timestamp (should be skipped), Real Message
    const recHeader = makeNode('h3', {}, [], '為你推薦');
    const realAuthorLink = makeNode('a', { role: 'link' }, [], 'Marie Curie');
    const authorHeading = makeNode('h4', { role: 'heading' }, [realAuthorLink]);
    const followBtn = makeNode('div', { role: 'button' }, [], '追蹤');
    const timeSpan = makeNode('span', { dir: 'auto' }, [], '3 小時');
    const msgSpan = makeNode('span', { dir: 'auto' }, [], 'Discovered Polonium and Radium\nNobel Prize laureate');

    const domFoldContainer = makeNode('div', { className: 'fb-diet-fold-hidden fb-diet-foldsquash' }, [
      recHeader,
      authorHeading,
      followBtn,
      timeSpan,
      msgSpan
    ]);

    const domBarNode = makeNode('div', { className: 'fb-diet-titlebar' });
    makeNode('div', {}, [domBarNode, domFoldContainer]);

    // 3. Connect React ref to the bar DOM element and render FBDietTitleBar
    t.React.resetHooks();
    t.React.setRef(0, domBarNode);

    const renderedBar = t.win.FBDietUI.FBDietTitleBar(barEl.props);
    c.ok('title bar component renders', Boolean(renderedBar));
    c.ok('title bar has base class fb-diet-titlebar', renderedBar.props.className.includes('fb-diet-titlebar'));
    c.ok('folded title bar does NOT have fb-diet-state-expanded', !renderedBar.props.className.includes('fb-diet-state-expanded'));

    // Cache should be populated from DOM scan
    const cached = t.win.FBDietUI.titleBarCache.get(unitId);
    c.ok('titleBarCache populated for folded unit', Boolean(cached));
    c.equals('author extracted skips 為你推薦', cached.actorName, 'Marie Curie');
    c.equals('snippet extracted skips timestamp', cached.snippetText, 'Discovered Polonium and Radium');

    // Re-render (or inspect rendered element children)
    t.React.resetHooks();
    const finalBar = t.win.FBDietUI.FBDietTitleBar(barEl.props);
    const contentBox = finalBar.props.children;
    const kids = contentBox.props.children;

    c.equals('badge displayed in folded state', kids[0].props.className, 'fb-diet-badge fb-diet-badge-suggested');
    c.equals('author displayed with colon in folded state', kids[1].props.children, 'Marie Curie:');
    c.equals('snippet displayed in folded state', kids[2].props.children, 'Discovered Polonium and Radium');

    // 4. Also verify toggle to expanded keeps title under 'always'
    t.bridge.toggle(unitId);
    t.React.resetHooks();
    const expandedFoldOut = t.render(payload);
    const [expandedBarEl] = expandedFoldOut.props.children;
    c.equals('expanded bar keeps showTitle: true under always mode', expandedBarEl.props.showTitle, true);
    c.equals('expanded bar has isExpanded: true', expandedBarEl.props.isExpanded, true);

    t.React.resetHooks();
    const renderedExpandedBar = t.win.FBDietUI.FBDietTitleBar(expandedBarEl.props);
    c.ok('expanded title bar has fb-diet-state-expanded class', renderedExpandedBar.props.className.includes('fb-diet-state-expanded'));
    const expandedKids = renderedExpandedBar.props.children.props.children;
    c.equals('author still displayed in expanded state', expandedKids[1].props.children, 'Marie Curie:');
    c.equals('snippet still displayed in expanded state', expandedKids[2].props.children, 'Discovered Polonium and Radium');
  }

  /* --- media bypass: reels and stories bypass DOM scan and show localized labels --- */
  {
    const t = setup({});
    const ui = t.win.FBDietUI;

    // 1. Label localization check
    t.win.document = { documentElement: { lang: 'zh-TW' } };
    c.equals('stories label in zh-TW', ui.getMediaLabel('stories'), '限時動態');
    c.equals('reels label in zh-TW', ui.getMediaLabel('reels'), '連續短片');
    c.equals('suggestedGroup label in zh-TW', ui.getMediaLabel('suggestedGroup'), '推薦社團列表');

    t.win.document.documentElement.lang = 'en-US';
    c.equals('stories label in en', ui.getMediaLabel('stories'), 'Stories');
    c.equals('reels label in en', ui.getMediaLabel('reels'), 'Reels');
    c.equals('suggestedGroup label in en', ui.getMediaLabel('suggestedGroup'), 'Suggested Groups');

    // 2. Stories rendering in TitleBar (no snippet, author is localized media label)
    t.win.document.documentElement.lang = 'zh-TW';
    t.React.resetHooks();
    const storiesBar = ui.FBDietTitleBar({
      category: 'stories',
      showTitle: true,
      unitId: 'u-stories-test'
    });
    const storiesKids = storiesBar.props.children.props.children;
    c.equals('stories bar has media badge', storiesKids[0].props.className, 'fb-diet-badge fb-diet-badge-media');
    c.equals('stories bar uses non-bold fb-diet-title-media class', storiesKids[1].props.className, 'fb-diet-title-media');
    c.equals('stories bar shows 限時動態', storiesKids[1].props.children, '限時動態');
    c.equals('stories bar has no snippet', storiesKids.length, 2);

    // 3. Reels rendering in TitleBar (no snippet, author is localized media label)
    t.React.resetHooks();
    const reelsBar = ui.FBDietTitleBar({
      category: 'reels',
      showTitle: true,
      unitId: 'u-reels-test'
    });
    const reelsKids = reelsBar.props.children.props.children;
    c.equals('reels bar has media badge', reelsKids[0].props.className, 'fb-diet-badge fb-diet-badge-media');
    c.equals('reels bar uses non-bold fb-diet-title-media class', reelsKids[1].props.className, 'fb-diet-title-media');
    c.equals('reels bar shows 連續短片', reelsKids[1].props.children, '連續短片');
    c.equals('reels bar has no snippet', reelsKids.length, 2);

    // 4. SuggestedGroup rendering in TitleBar (no snippet, no group, author is localized media label)
    t.React.resetHooks();
    const groupBar = ui.FBDietTitleBar({
      category: 'suggestedGroup',
      showTitle: true,
      unitId: 'u-group-test'
    });
    const groupKids = groupBar.props.children.props.children;
    c.equals('suggestedGroup bar has other badge', groupKids[0].props.className, 'fb-diet-badge fb-diet-badge-other');
    c.equals('suggestedGroup bar uses non-bold fb-diet-title-media class', groupKids[1].props.className, 'fb-diet-title-media');
    c.equals('suggestedGroup bar shows 推薦社團列表', groupKids[1].props.children, '推薦社團列表');
    c.equals('suggestedGroup bar has no snippet', groupKids.length, 2);

    // 5. Verify no cache entry was created by DOM scan
    c.ok('stories has no titleBarCache entry', !ui.titleBarCache.has('u-stories-test'));
    c.ok('reels has no titleBarCache entry', !ui.titleBarCache.has('u-reels-test'));
    c.ok('suggestedGroup has no titleBarCache entry', !ui.titleBarCache.has('u-group-test'));

    // 6. Regular group post rendering in TitleBar
    t.React.resetHooks();
    const costcoTitleBar = ui.FBDietTitleBar({
      category: 'regular',
      showTitle: true,
      unitId: 'u-costco-test',
      enrichment: {
        actor: { name: 'Rosa Chiou' },
        group: { name: 'COSTCO 好市多 商品消費心得分享區' },
        content: { message: '#Hardbite洋芋片好吃' }
      }
    });
    const costcoKids = costcoTitleBar.props.children.props.children;
    c.equals('costco bar has group span', costcoKids[1].props.className, 'fb-diet-title-group');
    const groupInnerKids = costcoKids[1].props.children;
    c.equals('costco group starts with [', groupInnerKids[0], '[');
    c.equals('costco group inner span class is fb-diet-title-group-name', groupInnerKids[1].props.className, 'fb-diet-title-group-name');
    c.equals('costco group inner span contains group name', groupInnerKids[1].props.children, 'COSTCO 好市多 商品消費心得分享區');
    c.equals('costco group ends with ]', groupInnerKids[2], ']');
    c.equals('costco bar has author span', costcoKids[2].props.className, 'fb-diet-title-author');
  }

  /* --- module drift watchdog verdict --- */
  {
    // Healthy path: the registered feed module matched, so drift is never suspected
    // (the harness only streams one module definition).
    const t = setup({});
    const healthy = t.fold.checkModuleDrift();
    c.ok('healthy drift report is not suspected', healthy.suspected === false);
    c.equals('healthy drift report counts matched modules', healthy.seen, 1);
    c.equals('healthy drift report counts registrations', healthy.registered, t.fold.FEED_UNIT_MODULES.length);
    c.ok('getStatus exposes the drift verdict', t.fold.getStatus().drift && t.fold.getStatus().drift.suspected === false);

    // Drift path: loader streamed 300+ module definitions, none of ours matched,
    // Relay ready, fold scope allowed. Warns exactly once per session.
    const d = setup({}, { noFeedModule: true });
    d.win.FBDietRelay = { isReady: () => true };
    for (let i = 0; i < 320; i++) {
      d.win.__d(function () {}, 'drift/Filler' + i + '.react', [], null, null, null, {});
    }
    const origWarn = console.warn;
    let warnCount = 0;
    console.warn = () => { warnCount += 1; };
    let drift;
    try {
      drift = d.win.FBDietFold.checkModuleDrift();
      d.win.FBDietFold.checkModuleDrift();
    } finally {
      console.warn = origWarn;
    }
    c.ok('drift suspected when loader streamed and nothing matched', drift.suspected === true);
    c.ok('drift report counts loader definitions', drift.dCalls >= 300);
    c.equals('drift report seen stays zero', drift.seen, 0);
    c.equals('drift report patched stays zero', drift.patched, 0);
    c.equals('drift warns exactly once per session', warnCount, 1);

    // Relay not ready vetoes the verdict (early page state must not warn)
    const d2 = setup({}, { noFeedModule: true });
    d2.win.FBDietRelay = { isReady: () => false };
    for (let i = 0; i < 320; i++) {
      d2.win.__d(function () {}, 'drift/Filler' + i + '.react', [], null, null, null, {});
    }
    c.ok('relay not ready vetoes drift suspicion', d2.win.FBDietFold.checkModuleDrift().suspected === false);

    // Few loader definitions veto the verdict (tiny pages must not warn)
    const d3 = setup({}, { noFeedModule: true });
    d3.win.FBDietRelay = { isReady: () => true };
    for (let i = 0; i < 50; i++) {
      d3.win.__d(function () {}, 'drift/Filler' + i + '.react', [], null, null, null, {});
    }
    c.ok('few loader definitions veto drift suspicion', d3.win.FBDietFold.checkModuleDrift().suspected === false);
  }

  /* --- pre-hydration right rail ad suppression style injection & settings lifecycle --- */
  {
    const t = setup({});
    let appendedStyle = null;
    const fakeHead = {
      appendChild(el) {
        appendedStyle = el;
      }
    };
    const fakeDoc = {
      head: fakeHead,
      getElementById(id) {
        if (appendedStyle && appendedStyle.id === id) return appendedStyle;
        return null;
      },
      createElement(tag) {
        return {
          tagName: tag.toUpperCase(),
          textContent: '',
          parentNode: fakeHead
        };
      }
    };
    fakeHead.removeChild = (el) => {
      if (appendedStyle === el) appendedStyle = null;
    };

    const res = t.fold.install(fakeDoc);
    c.ok('install() returns truthy after component registration and style injection', Boolean(res));
    c.ok('install() appends style with id fb-diet-right-rail-style', Boolean(appendedStyle) && appendedStyle.id === 'fb-diet-right-rail-style');
    c.ok('injected style suppresses ads with attributionsrc', appendedStyle.textContent.includes('a[attributionsrc]'));
    c.ok('injected style suppresses ads with target^=rhcad', appendedStyle.textContent.includes('a[target^="rhcad"]'));
    c.ok('injected style suppresses ads with fbclid', appendedStyle.textContent.includes('a[href*="fbclid="]'));
    c.ok('injected style retains .adhidden and .fb-diet-side-ad-hidden', appendedStyle.textContent.includes('.CometHomeRightRailUnit:has(') && appendedStyle.textContent.includes('.fb-diet-side-ad-hidden'));

    // Dynamic sync: when foldAds is disabled, style is removed
    t.bridge.setSettings({ foldAds: false });
    t.fold.syncRightRailStyle(fakeDoc);
    c.ok('syncRightRailStyle removes stylesheet when foldAds is false', appendedStyle === null);

    // Dynamic sync: re-enabling foldAds restores the style
    t.bridge.setSettings({ foldAds: true });
    t.fold.syncRightRailStyle(fakeDoc);
    c.ok('syncRightRailStyle restores stylesheet when foldAds is re-enabled', Boolean(appendedStyle));
  }
}

module.exports = { run, FEED_MODULE };