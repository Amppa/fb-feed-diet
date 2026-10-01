'use strict';
const { Checker, createFakeReact, makeNode, createWindow, loadInject, loadDefaults, createFakeComet, countMessages, ROOT } = require('./harness');
const fs = require('fs');
const path = require('path');

const FEED_MODULE = 'CometFeedUnitErrorBoundary.react';
const SPONSORED_PATH = '^sponsored_data.ad_id';

function setup(relayMap, opts) {
  const React = createFakeReact();
  const win = createWindow();
  const loader = createFakeComet(win, React);

  win.FB_DIET_DEFAULTS = loadDefaults();
  // comet.js reads the settings cache itself (it runs before bridge.js exists), so a test that
  // wants the hard-disabled boot path must arm the cache before comet.js loads.
  if (opts && opts.cachedSettings !== undefined) {
    const cached = JSON.stringify(opts.cachedSettings);
    win.localStorage = { getItem: (key) => (key === 'fb_diet_settings_cache' ? cached : null) };
  }
  loadInject(win, 'comet.js');
  loadInject(win, 'relay-metadata.js');
  loadInject(win, 'relay-classify.js');
  loadInject(win, 'bridge.js');
  loadInject(win, 'dom-surface.js');
  loadInject(win, 'dom-suggested.js');
  loadInject(win, 'dom-metadata.js');
  loadInject(win, 'ui.js');
  loadInject(win, 'probe.js');
  loadInject(win, 'fold.js');

  win.FBDietRelayClassify.setRelayReader((ids, path) => {
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
    loader.require(FEED_MODULE);
    wrapper = loader.getExport(FEED_MODULE).default;
  }

  return {
    React,
    win,
    loader,
    bridge: win.FBDietBridge,
    fold: win.FBDietFold,
    comet: win.FBDietComet,
    // wrapper() returns the React element for FoldUnit; invoking its type emulates
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
  const payloadOf = (id, extra) => ({ feedUnit: Object.assign({ id, __typename: 'FeedUnitRoot' }, extra) });

  /* --- boot state --- */
  {
    const t = setup({});
    c.ok('fold API exposed', Boolean(t.fold) && typeof t.fold.FoldUnit === 'function');
    c.equals('fold registered its module', t.comet.listRegistered()[FEED_MODULE][0], '[6].default');
    c.ok('fold exposes its feed module table', t.fold.FEED_UNIT_MODULES.length > 0);
    c.ok('every feed module has a definer path', t.fold.FEED_UNIT_MODULES.every((item) => typeof item.definerPath === 'string' && item.definerPath));
    c.equals('right rail keeps its render definer path', t.fold.FEED_UNIT_MODULES.find((item) => item.name === 'CometHomeRightRailUnit.react').definerPath, '[6].default.render');
    c.ok('every feed module is registered', t.fold.FEED_UNIT_MODULES.every((item) => Boolean(t.comet.listRegistered()[item.name])));
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
    c.equals('header bar is TitleBar', headerBar.type, t.win.FBDietUI.TitleBar);
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
    c.equals('folded regular has TitleBar', foldedRegular.props.children[0].type, t.win.FBDietUI.TitleBar);
    c.equals('folded regular has isMini true', foldedRegular.props.children[0].props.isMini, true);
  }

  /* --- regular payload with default settings: 36px title bar when unfolded --- */
  {
    const t = setup({});
    // minimizedFoldMode is false by default, alwaysShowFoldBar is true by default
    const result = t.render(payloadOf('u-regular-default'));
    c.ok('regular default renders TitleBar (36px)', result.type === t.React.Fragment && result.props.children[0].type === t.win.FBDietUI.TitleBar);
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
    c.equals('bar is TitleBar', bar.type, t.win.FBDietUI.TitleBar);
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
    c.ok('alwaysShowFoldBar on + mini off renders unfolded with title bar', unfoldedTitleBar.type === t.React.Fragment && unfoldedTitleBar.props.children[0].type === t.win.FBDietUI.TitleBar);

    t.bridge.setSettings({ foldAds: true, minimizedFoldMode: true, alwaysShowFoldBar: true });
    c.ok('category restored folds again', t.render(payloadOf('u1')).type === t.React.Fragment && t.render(payloadOf('u1')).props.children[0].type === t.win.FBDietUI.TitleBar);
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

  /* --- relay-ready wake-up: store-not-ready units stay pending without a regular report --- */
  {
    // A unit the store cannot identify (no id) with the store not yet captured: pending,
    // untouched, and NOT counted as regular — the relay-ready broadcast re-renders it later
    // instead of double-counting regular-then-blocked.
    const t = setup({});
    t.win.FBDietRelay = { isReady: () => false };
    const out = t.render({ feedUnit: {} });
    c.ok('store-not-ready unit renders untouched', out.__source === true);
    c.equals('no regular report while pending', countMessages(t.win, 'regular'), 0);
    c.ok('relay-ready listener armed',
      Array.isArray(t.win.__listeners['fb-diet:relay-ready']) && t.win.__listeners['fb-diet:relay-ready'].length >= 1);

    // The same unit once the store lands: reported as regular exactly once (genuine no-id).
    t.win.FBDietRelay = { isReady: () => true };
    t.render({ feedUnit: {} });
    c.equals('regular reported once the store is ready', countMessages(t.win, 'regular'), 1);

    // No relay module at all (harness default): legacy behaviour, regular reported immediately.
    const bare = setup({});
    const bareOut = bare.render({ feedUnit: {} });
    c.ok('no-relay-module unit renders untouched', bareOut.__source === true);
    c.equals('no-relay-module unit still reports regular', countMessages(bare.win, 'regular'), 1);
  }

  /* --- resolveVerdict: the DOM sponsorship override (STRATEGY.md decision #39) --- */
  {
    // resolveVerdict is exported as a pure function precisely so this rule can be checked
    // without mounting a feed unit. props is what the wrapper hands it: a payload the
    // classifier can identify, and the module name as classification context.
    const domHit = {
      isSponsored: true,
      signal: 'plain_text',
      reason: 'dom:plain_text',
      text: 'Sponsored',
      debug: { matchedText: 'Sponsored', signal: 'plain_text' }
    };
    const propsOf = (id) => ({ moduleName: FEED_MODULE, payload: payloadOf(id) });

    // Relay finds nothing: the unit is identified and regular.
    const plain = setup({});
    const clean = plain.fold.resolveVerdict(propsOf('u-dom-1'), null, null);
    c.equals('no DOM evidence leaves the store verdict alone', clean.category, 'regular');
    c.equals('no DOM evidence keeps the store reason', clean.reason, 'no-match');
    c.equals('the store result is handed back untouched', clean.store.reason, 'no-match');
    c.equals('the store is what decided it', clean.source, 'relay');

    // `relay` mode mounts no DOM engine, so a DOM hit carried in from a previous mode (or from a
    // caller that passes one anyway) cannot reach the verdict. The two engines are peers, not a
    // store with a corrector attached, and this is the assertion that says so.
    const hit = plain.fold.resolveVerdict(propsOf('u-dom-2'), null, domHit);
    c.equals('relay mode ignores a DOM sponsorship hit', hit.category, 'regular');
    c.equals('…and keeps the store reason', hit.reason, 'no-match');
    c.equals('…with no DOM evidence attached', hit.domEvidence, null);

    const missed = plain.fold.resolveVerdict(propsOf('u-dom-3'), null, { isSponsored: false });
    c.equals('a negative DOM scan changes nothing', missed.category, 'regular');
    c.equals('a negative DOM scan keeps the store reason', missed.reason, 'no-match');

    // Relay already said sponsored: the store's reason stands and the DOM adds nothing to it.
    const adStore = setup({ [SPONSORED_PATH]: 'ad-1' });
    const confirmed = adStore.fold.resolveVerdict(propsOf('u-dom-4'), null, domHit);
    c.equals('a unit the store already called sponsored stays sponsored', confirmed.category, 'sponsored');
    c.equals('an agreeing DOM hit does not replace the store reason', confirmed.reason, 'sponsored_data.ad_id');
    c.equals('an agreeing DOM hit is not attached as evidence', confirmed.domEvidence, null);

    // Relay decided a different category: the DOM must not touch it.
    const other = setup({ '^^actors[0].subscribe_status': 'CAN_SUBSCRIBE' });
    const untouched = other.fold.resolveVerdict(propsOf('u-dom-5'), null, domHit);
    c.equals('a suggested unit is never turned into an ad by the DOM', untouched.category, 'suggested');
    c.equals('its store reason survives the DOM hit', untouched.reason, 'actors[0].subscribe_status');

    // The module-declared category path skips the classifier entirely.
    const declared = plain.fold.resolveVerdict({ moduleName: FEED_MODULE, entryCategory: 'reels', payload: payloadOf('u-dom-6') }, null, domHit);
    c.equals('a module-declared category is not overruled', declared.category, 'reels');
    c.equals('a module-declared unit is never classified', declared.store, null);
    c.equals('…so nothing produced the verdict', declared.source, 'entry');

    // A suggested DOM hit and a sponsored one cannot both apply, because no DOM engine is mounted.
    const both = plain.fold.resolveVerdict(
      propsOf('u-dom-7'),
      { isSuggested: true, signal: 'Follow', reason: 'dom:follow_button' },
      domHit
    );
    c.equals('relay mode ignores a suggested DOM hit too', both.category, 'regular');

    // No classifier: the caller answers by leaving the render untouched.
    plain.win.FBDietRelayClassify = null;
    c.equals('an unclassifiable unit returns null', plain.fold.resolveVerdict(propsOf('u-dom-8'), null, domHit), null);
  }

  /* --- dom mode: the mounted-DOM engine is the sole authority (decision #40) --- */
  {
    const t = setup({});
    const props = { moduleName: FEED_MODULE, payload: payloadOf('u-dom-only') };
    const domHit = { isSponsored: true, signal: 'plain_text', reason: 'dom:plain_text', debug: { matchedText: 'Sponsored', signal: 'plain_text' } };
    const DOM = { skipDataEngine: true };

    // The store knows this is a Reel, but the mode must not consult it: the point of the mode is
    // that the DOM is the only authority, so a Reels unit cannot be smuggled in through the store.
    const reelProps = { moduleName: FEED_MODULE, payload: { feedUnit: { id: 'u-reel', __typename: 'ShowcaseFeedUnit' } } };
    const withEngine = t.fold.resolveVerdict(reelProps, null, null);
    c.equals('the relay pipeline still reads the store and finds the Reel', withEngine.category, 'reels');
    const withoutEngine = t.fold.resolveVerdict(reelProps, null, null, DOM);
    c.equals('dom mode does not run the data engine at all', withoutEngine.category, null);
    c.equals('…and leaves no store result behind', withoutEngine.store, null);
    c.equals('…naming the engine that ran', withoutEngine.source, 'dom');

    // A DOM hit IS the verdict here — there is no store result to decorate and none is invented.
    const adVerdict = t.fold.resolveVerdict(props, null, domHit, DOM);
    c.equals('a DOM hit decides under dom mode', adVerdict.category, 'sponsored');
    c.equals('the DOM reason is the verdict reason', adVerdict.reason, 'dom:plain_text');
    c.equals('the DOM capability that decided is named', adVerdict.source, 'dom_sponsorship');
    c.ok('the DOM evidence rides along on the verdict', adVerdict.domEvidence === domHit);
    // signal is the detector's hit signal (how the label was read), not the category name:
    // "plain_text" is what tells a field report which of the five label renderings matched.
    c.equals('the signal is the DOM hit signal', adVerdict.signal, 'plain_text');
    c.equals('no store result is manufactured to stand in for one', adVerdict.store, null);
    c.equals('…and no store evidence either', adVerdict.evidence, null);

    // A hit that carries no signal still gets a category-shaped fallback, so the report never
    // shows an empty signal for a unit that was folded as an ad.
    const bare = t.fold.resolveVerdict(props, null, { isSponsored: true }, DOM);
    c.equals('a signal-less hit still becomes sponsored', bare.category, 'sponsored');
    c.equals('a signal-less hit gets a default reason', bare.reason, 'dom:sponsored');
    c.equals('a signal-less hit gets a default signal', bare.signal, 'Sponsored');

    // A unit with no store id is no longer a special case: nothing about this verdict was ever
    // reachable through a store guard, because there is no store guard here.
    const noId = { moduleName: FEED_MODULE, payload: { feedUnit: { __typename: null } } };
    c.equals('a unit with no store id is decided by the DOM', t.fold.resolveVerdict(noId, null, domHit, DOM).category, 'sponsored');
    c.equals('and is undecided without a DOM hit', t.fold.resolveVerdict(noId, null, null, DOM).category, null);

    // A module-declared category is structural, not a store read, so it survives the skip.
    const declared = t.fold.resolveVerdict({ moduleName: FEED_MODULE, entryCategory: 'marketAds', payload: payloadOf('u-decl') }, null, null, DOM);
    c.equals('a module-declared category survives dom mode', declared.category, 'marketAds');

    // An undecided unit must still SAY that it is undecided. A field report showed a bare
    // "regular" with no reason and no detectionSource at all, which reads as a classifier result
    // when it is in fact the absence of one — exactly the distinction this mode exists to make.
    const quiet = t.fold.resolveVerdict(props, null, null, DOM);
    c.equals('an uncaught unit stays undecided for the report', quiet.category, null);
    c.equals('it says so rather than inheriting the component reason', quiet.reason, 'dom:no-verdict');
    c.equals('the verdict and the display are kept apart', quiet.display.category, 'regular');
    c.equals('…and the substitution is marked as such', quiet.display.substituted, true);
    c.ok('a non-detection carries no DOM evidence', !quiet.domEvidence);

    // A caught unit keeps its own reason — the no-verdict marker must not overwrite a real hit.
    const caught = t.fold.resolveVerdict(props, null, domHit, DOM);
    c.equals('a caught unit keeps the DOM reason', caught.reason, 'dom:plain_text');
    c.equals('a decided unit needs no display substitution', caught.display.substituted, false);

    // The skip is about the STORE, not the props. A field report on 2026-09-29 showed an ad
    // whose only sponsorship evidence was `feedUnit.th_dat_spo` — a plain prop, with
    // `evidence.source: 'props'` — resolving to `dom:no-verdict` -> 'regular' and never folding,
    // purely because the whole classifier was bypassed. Nothing about that signal needs store
    // capture, so the skip must not take it.
    const adProps = { feedUnit: { post_id: 'p-spo', th_dat_spo: { brs_filter_setting: 90 } } };
    const viaProps = t.fold.resolveVerdict({ moduleName: FEED_MODULE, payload: adProps }, null, null, DOM);
    c.equals('dom mode folds an ad carrying th_dat_spo in props', viaProps.category, 'sponsored');
    c.equals('…and says the props decided it', viaProps.reason, 'props:th_dat_spo');
    c.equals('…naming the props rule as the source', viaProps.source, 'props');
    c.equals('…without leaving a store result behind', viaProps.store, null);
    c.ok('…carrying the props evidence for attribution', Boolean(viaProps.propsEvidence));
    c.ok('…and no DOM evidence, because no scan decided it', !viaProps.domEvidence);
    c.equals('…and the unit id still identifies that one unit', viaProps.unitId, FEED_MODULE + '_p-spo');

    // The guarantee decision #40 actually protects is that the dom verdict never depends on
    // store capture. A props read must not reintroduce one, so the relay reader is never asked.
    const noStore = setup({});
    noStore.win.FBDietRelayClassify.setRelayReader(() => {
      throw new Error('the store must not be read in dom mode');
    });
    const storeFree = noStore.fold.resolveVerdict({ moduleName: FEED_MODULE, payload: adProps }, null, null, DOM);
    c.equals('the props ad decision never touches the store', storeFree.category, 'sponsored');

    // Every other category stays store-bound, so the mode still reports honestly on what the
    // page alone can prove. A Reels unit in props is NOT decided from props.
    const reelPropsOnly = { feedUnit: { post_id: 'p-reel', __typename: 'ShowcaseFeedUnit' } };
    c.equals('dom mode still will not decide reels from props', t.fold.resolveVerdict({ moduleName: FEED_MODULE, payload: reelPropsOnly }, null, null, DOM).category, null);

    // A unit with no ad prop is unaffected: the props check must not invent a verdict.
    c.equals('an ordinary unit is still undecided under dom mode', t.fold.resolveVerdict(props, null, null, DOM).reason, 'dom:no-verdict');

    // A rendered label beats the free props signal, because what the page shows is the stronger
    // claim of the two and the report should name it.
    const both = t.fold.resolveVerdict({ moduleName: FEED_MODULE, payload: adProps }, null, domHit, DOM);
    c.equals('both signals agree on the category', both.category, 'sponsored');
    c.equals('…and the rendered label wins', both.reason, 'dom:plain_text');
    c.equals('…credited to the DOM capability', both.source, 'dom_sponsorship');

    // relay mode is untouched: nothing about this changes what the store decides.
    const relay = t.fold.resolveVerdict({ moduleName: FEED_MODULE, payload: adProps }, null, null);
    c.equals('the relay pipeline still reads the store for this unit', relay.reason, 'th_dat_spo');
  }

  /* --- dom mode: the store-independence guarantee covers the metadata layer too (decision #40) --- */
  {
    // The classifier half of this guarantee is tested where `resolveVerdict` is called directly. This
    // is the layer that sat one call away from it: `FBDietRelayMetadata.collect` derives the record
    // ids it reads from the classify result, so a verdict with no store result must never reach it.
    // Before the verdict carried an honest `store`, the `dom` path handed it a synthetic unitId and
    // it issued real store reads against a record that does not exist.
    const t = setup({});
    t.bridge.setSettings({ dietMode: 'dom', enabled: true, showTitleMode: 'always', foldAds: true });

    const storeReads = [];
    t.win.FBDietRelayMetadata = {
      collect(result) {
        storeReads.push(result && (result.unitId || (result.evidence && result.evidence.id) || null));
        return { actor: { username: 'from-the-store' } };
      }
    };

    // Decided from free props, so the unit folds and the title bar renders in `dom` mode.
    t.React.resetHooks();
    const out = t.render(payloadOf('u-dom-no-store', { sponsored_data: { ad_id: 'ad-1' }, post_id: 'p-1' }));
    c.ok('a dom-mode fold renders the Fragment tree', out.type === t.React.Fragment);
    const barEl = out.props.children[0];
    c.equals('a dom-mode unit still folds on its free props', barEl.props.category, 'sponsored');
    c.equals('the title bar is told to read the DOM instead', barEl.props.allowDomScan, true);
    c.equals('nothing asked the store for metadata', storeReads.length, 0);
    c.equals('…so no store value reached the title bar', barEl.props.enrichment, null);

    // The probe is the other caller. It holds the verdict rather than a classify result, and it
    // reads ids off the same field, so it must make the same distinction.
    t.bridge.setSettings({ dietMode: 'dom', enabled: true, debugProbe: true, showTitleMode: 'always', foldAds: true });
    t.React.resetHooks();
    const probed = t.render(payloadOf('u-dom-probe-no-store', { sponsored_data: { ad_id: 'ad-2' }, post_id: 'p-2' }));
    c.ok('the probe holder is mounted for a dom-mode unit', JSON.stringify(probed).indexOf('fb-diet-probe-btn') !== -1);
    c.equals('the probe asked the store for nothing either', storeReads.length, 0);
  }

  /* --- The surface detector has authority in the DOM path only --- */
  {
    const t = setup({});
    const reelProps = { moduleName: FEED_MODULE, payload: { feedUnit: { id: 'r-1', __typename: 'Story' } } };
    const surfaceHit = { isSurface: true, category: 'reels', reason: 'dom:reels_tray_label', text: 'Reel' };
    const opts = { skipDataEngine: true, domSurface: surfaceHit };

    const decided = t.fold.resolveVerdict(reelProps, null, null, opts);
    c.equals('a reels tray the DOM names is decided in dom mode', decided.category, 'reels');
    c.equals('and the surface reason is the verdict reason', decided.reason, 'dom:reels_tray_label');
    c.ok('the verdict credits the surface rules as what decided it', decided.source === 'dom_surface' && decided.domEvidence === surfaceHit);
    c.equals('the result the probe and the counters read is reels', decided.category, 'reels');

    // relay mode is untouched: the store answers for these categories, and a surface hit that
    // the mode cannot use must not change the verdict. This is the guard the whole design rests on.
    const daily = t.fold.resolveVerdict(reelProps, null, null, { domSurface: surfaceHit });
    c.equals('the relay pipeline ignores the surface answer entirely', daily.category, 'regular');
    c.equals('…and keeps the store reason', daily.reason, 'no-match');
    c.ok('…and credits no DOM evidence for it', !daily.domEvidence);

    // Precedence inside the DOM path: a module-declared category is the strongest structural claim,
    // and a rendered sponsorship label is the one thing allowed to overrule everything (#39).
    const declared = t.fold.resolveVerdict(
      { moduleName: FEED_MODULE, entryCategory: 'stories', payload: { feedUnit: { post_id: 'r-2' } } },
      null, null, opts
    );
    c.equals('a module-declared category outranks the surface rules', declared.category, 'stories');

    const domHit = { isSponsored: true, signal: 'plain_text', reason: 'dom:plain_text' };
    const adOnTray = t.fold.resolveVerdict(reelProps, null, domHit, opts);
    c.equals('a sponsorship label still has the last word', adOnTray.category, 'sponsored');
    c.equals('…and replaces the surface reason', adOnTray.reason, 'dom:plain_text');

    // A decided tray must not be re-decided by the button heuristics: every tile of a horizontal
    // tray is a heading plus a pill plus a menu, which is what made a Reel fold as a suggestion.
    const suggestedHit = { isSuggested: true, signal: 'Follow', reason: 'dom:follow_button' };
    const tray = t.fold.resolveVerdict(reelProps, suggestedHit, null, opts);
    c.equals('a surface decision is not overridden by the suggested heuristic', tray.category, 'reels');

    // Other surfaces travel the same path.
    const group = { isSurface: true, category: 'suggestedGroup', reason: 'dom:group_tray', text: 'groups you might like' };
    c.equals('a group tray is decided as suggestedGroup', t.fold.resolveVerdict(reelProps, null, null, { skipDataEngine: true, domSurface: group }).category, 'suggestedGroup');

    // Field report 2026-09-29, verbatim: a GroupsYouShouldJoin tray arrived with BOTH verdicts —
    // the surface rules and the suggested scanner's `aria_keyword` on 為你推薦 — and came out
    // `suggested`. This is the ordering that produced it, stated as a case: the tray is what the
    // store called it, and a recommendation badge on a fifteen-card tray hides all fifteen posts
    // behind one row. It only ever happened because the surface rules could not see the tray at
    // all; the ordering itself was already right, and this guards that it stays right.
    const ariaSuggestedHit = { isSuggested: true, signal: 'Other', reason: 'dom:aria_suggested', text: '為你推薦' };
    const both = t.fold.resolveVerdict(reelProps, ariaSuggestedHit, null, { skipDataEngine: true, domSurface: group });
    c.equals('a decided tray outranks a fired aria_suggested cue', both.category, 'suggestedGroup');
    c.equals('…and the tray is the reason the report shows', both.reason, 'dom:group_tray');

    // A detector that declined is not a hit, and must not fake one.
    const declined = { isSurface: undefined, category: null };
    const quiet = t.fold.resolveVerdict(reelProps, null, null, { skipDataEngine: true, domSurface: declined });
    c.equals('a declined surface leaves the unit undecided', quiet.category, null);
    c.equals('…and says it found nothing', quiet.reason, 'dom:no-verdict');
  }

  /* --- REGRESSION: the fallback unitId must identify ONE unit, not the whole feed --- */
  {
    // ui.js keys its titleBarCache by unitId. The old fallback was moduleName + typename, which is
    // constant for every post, so with no store id to read (the DOM-only pipeline) all units shared
    // one key and the second post's author and snippet were served to all of them — a field report
    // showed the same author on every post in the feed.
    const t = setup({});
    const idOf = (payload) => t.fold.resolveVerdict(
      { moduleName: FEED_MODULE, payload },
      null, null, { skipDataEngine: true }
    ).unitId;

    const a = idOf({ feedUnit: { post_id: '111111111' } });
    const b = idOf({ feedUnit: { post_id: '222222222' } });
    c.ok('two posts get different unit ids', a !== b);
    c.ok('the post id is part of the key', a.indexOf('111111111') !== -1 && b.indexOf('222222222') !== -1);

    // No post id at all: feedPosition still keeps neighbours apart, and the last-resort shape is
    // the old one so nothing downstream ends up with an empty key.
    c.ok('feedPosition separates two posts with no id', idOf({ feedUnit: {}, position: 3 }) !== idOf({ feedUnit: {}, position: 4 }));
    const nameless = idOf({ feedUnit: {} });
    c.ok('a unit with neither still gets a non-empty key', typeof nameless === 'string' && nameless.length > 0);

    // The store path is untouched: when a store id exists it is still the key.
    const withStore = setup({ [SPONSORED_PATH]: 'ad-1' });
    c.equals('the relay pipeline still keys on the store id', withStore.fold.resolveVerdict({ moduleName: FEED_MODULE, payload: payloadOf('u-store') }).unitId, 'u-store');
  }

  /* --- hide-mode override: the memory A/B lever --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-hide' });
    t.bridge.setSettings({ foldAds: 'title' });
    const squashed = t.render(payloadOf('u-squash'));
    const squashKids = squashed.props.children;
    c.equals('default hide keeps the 1x1 squash class', Array.isArray(squashKids) && squashKids[1] && squashKids[1].props.className, 'fb-diet-fold-hidden fb-diet-foldsquash');

    t.win.__fbDietHideMode = 'none';
    const plain = t.render(payloadOf('u-plain'));
    const plainKids = plain.props.children;
    c.equals('hide-mode none drops the squash class', Array.isArray(plainKids) && plainKids[1] && plainKids[1].props.className, 'fb-diet-fold-hidden');
    delete t.win.__fbDietHideMode;
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
    const rawButtons = probeGroup && probeGroup.props && probeGroup.props.children;
    const probeButtons = Array.isArray(rawButtons) ? rawButtons : (rawButtons ? [rawButtons] : null);
    c.ok('probe holder carries button group + fold', Array.isArray(probeKids) && probeKids.length === 2 && probeGroup.props.className === 'fb-diet-probe-group');
    c.ok('probe group carries the single unified button', Array.isArray(probeButtons) && probeButtons.length === 1 && probeButtons[0].props.className.includes('fb-diet-probe-btn-unified'));
    c.ok('unified probe button carries a click handler', typeof probeButtons[0].props.onClick === 'function');
    // Clicking must not throw even inside the test harness
    let clickThrew = false;
    try {
      probeButtons[0].props.onClick({ stopPropagation() {}, preventDefault() {} });
    } catch (e) {
      clickThrew = true;
    }
    c.ok('probe click survives the harness', clickThrew === false);
    // Probe off again: back to the plain fold
    t.bridge.setSettings({ debugProbe: false });
    c.ok('probe off restores the plain fold', t.render(payloadOf('u1')).type === t.React.Fragment);

    /* --- probe report shape (Probe v5 unified lifecycle) --- */
    const classifyRes = {
      category: 'sponsored',
      unitId: 'u1',
      unitTypename: 'FeedUnitRoot',
      reason: 'sponsored_data.ad_id',
      evidence: { ownTypename: 'FeedUnitRoot', adId: 'ad-1', id: 'u1', idCount: 1 }
    };
    const reportWithoutEntry = t.win.FBDietProbe.buildProbeReport({ payload: { feedUnit: { id: 'u1', __typename: 'FeedUnitRoot', post_id: 'p123' } } }, classifyRes, [], null).report;
    c.equals('entryCategory omitted when null', reportWithoutEntry.relay.entryCategory, undefined);
    c.equals('settings omitted from report', reportWithoutEntry.settings, undefined);
    c.equals('top-level unitTypename removed', reportWithoutEntry.unitTypename, undefined);
    c.equals('payload.feedUnit does not reprint the post id', reportWithoutEntry.relay.payload, undefined);
    // Pinned to the literal, not to FBDietProbe.SCHEMA_VERSION: that constant is the same
    // declaration the report is built from, so comparing the two is true for any schema and fails
    // only if the wiring breaks. tests/probe.test.js owns the version bump itself.
    c.equals('schemaVersion matches the pinned report schema', reportWithoutEntry.schemaVersion, 6);
    c.equals('probe report has no bare version key', reportWithoutEntry.version, undefined);
    c.equals('env.extVersion records the release build', reportWithoutEntry.env.extVersion, t.win.FB_DIET_DEFAULTS.VERSION);
    c.equals('retired at block removed', reportWithoutEntry.at, undefined);
    c.ok('env.probed present', Boolean(reportWithoutEntry.env.probed));
    c.ok('relay.renderedAt present', Boolean(reportWithoutEntry.relay.renderedAt));
    c.ok('unit block carries unitId and postId', reportWithoutEntry.unit.unitId === 'u1' && reportWithoutEntry.unit.postId === 'p123');
    c.ok('verdict block carries category and default-on ads fold', reportWithoutEntry.verdict.category === 'sponsored' && reportWithoutEntry.verdict.foldMode === 'title' && reportWithoutEntry.verdict.settingKey === 'foldAds');
    c.equals('redundant mode alias key removed', reportWithoutEntry.mode, undefined);
    c.equals('verdict carries no redundant enabled boolean', reportWithoutEntry.verdict.enabled, undefined);
    c.ok('dom phase object present', Boolean(reportWithoutEntry.dom));
    c.equals('store counters omitted without the relay module', reportWithoutEntry.relay.isReady, undefined);
    c.equals('memory.enrichment relocated under relay', reportWithoutEntry.memory, undefined);
    c.ok('relay.initialClassify keeps the pre-DOM category', reportWithoutEntry.relay.initialClassify.category === 'sponsored');
    // The structural key lists are what the payload block is FOR — they answer "the field this rule
    // reads is not here" — and that is a question about a unit no rule matched. A unit the store
    // called `sponsored` is answered, so it carries no key listing at all.
    c.equals('a classified unit carries no payload block', reportWithoutEntry.relay.payload, undefined);
    const noMatchReport = t.win.FBDietProbe.buildProbeReport(
      { payload: { feedUnit: { id: 'u1', __typename: 'FeedUnitRoot', post_id: 'p123' } } },
      { unitId: 'u1', category: 'regular', reason: 'no-match' },
      [],
      null
    ).report;
    c.ok('payloadKeys captured on a no-match unit', Array.isArray(noMatchReport.relay.payload.payloadKeys), JSON.stringify(noMatchReport.relay.payload));
    c.ok('feedUnitKeys captured on a no-match unit', Array.isArray(noMatchReport.relay.payload.feedUnitKeys));
    c.equals('…while the post id stays in the unit block', noMatchReport.unit.postId, 'p123');

    const reportWithSignals = t.win.FBDietProbe.buildProbeReport({
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
    }, classifyRes, [], null).report;
    c.ok('diagnostic signals extracted under relay', Array.isArray(reportWithSignals.relay.signals) && reportWithSignals.relay.signals.length > 0);
    c.equals('signal path matches', reportWithSignals.relay.signals[0].path, 'feedUnit.comet_sections.header.story.title.text');
    c.equals('signal value matches', reportWithSignals.relay.signals[0].value, '為你推薦');

    const reportWithEntry = t.win.FBDietProbe.buildProbeReport({ entryCategory: 'marketAds', payload: { feedUnit: {} } }, classifyRes, [], null).report;
    c.equals('entryCategory present under relay when provided', reportWithEntry.relay.entryCategory, 'marketAds');

    /* --- probe report scope fields (STRATEGY.md decision #26) --- */
    c.ok('scope nested under verdict', Boolean(reportWithoutEntry.verdict.scope) && typeof reportWithoutEntry.verdict.scope === 'object');
    c.equals('scope.restricted reflects the default restriction', reportWithoutEntry.verdict.scope.restricted, true);
    c.equals('scope.path is absent without a pathname', reportWithoutEntry.verdict.scope.path, undefined);

    const tScope = setup({});
    tScope.win.FB_DIET_DEFAULTS = loadDefaults();
    tScope.win.location.pathname = '/groups/feed';
    const outOfScopeReport = tScope.win.FBDietProbe.buildProbeReport({ payload: { feedUnit: {} } }, classifyRes, [], null).report;
    c.equals('scope.path captures the page pathname', outOfScopeReport.verdict.scope.path, '/groups/feed');
    c.equals('scope.allowed is false on /groups', outOfScopeReport.verdict.scope.allowed, false);
    tScope.bridge.setSettings({ restrictFoldScope: false });
    const unrestrictedReport = tScope.win.FBDietProbe.buildProbeReport({ payload: { feedUnit: {} } }, classifyRes, [], null).report;
    c.equals('scope.restricted false when the toggle is off', unrestrictedReport.verdict.scope.restricted, false);
    c.equals('scope.allowed true when the toggle is off', unrestrictedReport.verdict.scope.allowed, true);
  }

  /* --- 3-tier fold mode: title mode (24px persistent header bar) --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-title' });
    t.bridge.setSettings({ foldAds: 'title' });

    // Collapsed title state: renders TitleBar with [+]
    const folded = t.render(payloadOf('u-title'));
    c.ok('title mode render is a Fragment', folded.type === t.React.Fragment);
    const [titleBar, body] = folded.props.children;
    c.equals('title bar is TitleBar', titleBar.type, t.win.FBDietUI.TitleBar);
    c.ok('title bar is collapsed', titleBar.props.isExpanded === false);
    c.ok('body is hidden container', body.props.className.indexOf('fb-diet-fold-hidden') !== -1);
    const titleBarRender = titleBar.type(titleBar.props);
    c.ok('title bar rendered div has fb-diet-titlebar', titleBarRender.props.className.indexOf('fb-diet-titlebar') !== -1);

    // Toggle expand: title bar stays mounted, isExpanded becomes true ([-]), body revealed
    titleBar.props.onToggle();
    const expanded = t.render(payloadOf('u-title'));
    const [expandedTitleBar, expandedBody] = expanded.props.children;
    c.equals('expanded title bar stays TitleBar', expandedTitleBar.type, t.win.FBDietUI.TitleBar);
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
    t.loader.require('CometAdsSideFeedUnitItem.react');
    const sideWrapper = t.loader.getExport('CometAdsSideFeedUnitItem.react').default;

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

    /* --- fold bar title modes: showTitleMode three-state (STRATEGY.md decisions #27, #36) --- */
  {
    const t = setup({ [SPONSORED_PATH]: 'ad-1' });
    t.win.FB_DIET_DEFAULTS = loadDefaults();

    // The relay mode honours showTitleMode and keeps its no-DOM-scan contract: the bar receives
    // allowDomScan=false so the title bar effect never attaches a subtree scanner.
    t.bridge.setSettings({ dietMode: 'relay', showTitleMode: 'always' });
    let outLite = t.render(payloadOf('u-titlemode-lite'));
    c.equals('relay mode shows the title under always', outLite.props.children[0].props.showTitle, true);
    c.equals('relay mode forbids the DOM scan', outLite.props.children[0].props.allowDomScan, false);

    // A profile stored before the rename still says 'lite'; it must behave exactly like 'relay'
    // rather than falling back to the default and silently gaining DOM scanning.
    t.bridge.setSettings({ dietMode: 'lite', showTitleMode: 'always' });
    let outLegacy = t.render(payloadOf('u-titlemode-legacy'));
    c.equals('a legacy lite value still forbids the DOM scan', outLegacy.props.children[0].props.allowDomScan, false);

    // The relay mode folds the unit (the store answers sponsored) and keeps its no-DOM-scan
    // contract, so it is the mode the title-mode policy assertions below run under.
    t.bridge.setSettings({ dietMode: 'relay', showTitleMode: 'whenFolded' });
    let out = t.render(payloadOf('u-titlemode'));
    c.ok('relay mode folds the unit', out.type === t.React.Fragment);
    c.equals('folded bar shows the title under whenFolded', out.props.children[0].props.showTitle, true);
    c.equals('relay mode forbids the DOM scan', out.props.children[0].props.allowDomScan, false);

    // 'dom' is the one mode with a mounted-DOM engine, so it lets the title bar scan. The 1.0
    // hybrid 'relay+dom' is retired.
    t.bridge.setSettings({ dietMode: 'dom', showTitleMode: 'whenFolded' });
    let outDom = t.render(payloadOf('u-titlemode-dom'));
    c.equals('dom allows the DOM scan', outDom.props.children[0].props.allowDomScan, true);

    // 'full' is the old name for the retired hybrid, so it lands on 'relay' — the half of that
    // hybrid which actually decided every non-regular unit.
    t.bridge.setSettings({ dietMode: 'full', showTitleMode: 'whenFolded' });
    let outLegacyFull = t.render(payloadOf('u-titlemode-legacy-full'));
    c.equals('a legacy full value no longer allows the DOM scan', outLegacyFull.props.children[0].props.allowDomScan, false);

    // The inline mode fallback in detectionMode() cannot fire under manifest load order, but if
    // it ever does it must not collapse 'dom' into 'relay' — that would re-enable the data
    // engine and silently report a DOM verdict as a Relay one.
    const savedDefaults = t.win.FB_DIET_DEFAULTS;
    t.win.FB_DIET_DEFAULTS = undefined;
    try {
      t.bridge.setSettings({ dietMode: 'dom', showTitleMode: 'whenFolded' });
      const outNoDefaults = t.render(payloadOf('u-titlemode-dom-nodefaults'));
      c.equals(
        'dom keeps its identity without the defaults module',
        outNoDefaults.props.children[0].props.allowDomScan,
        true
      );
    } finally {
      t.win.FB_DIET_DEFAULTS = savedDefaults;
    }

    // Restore the mode the remaining title assertions below run under.
    t.bridge.setSettings({ dietMode: 'relay', showTitleMode: 'whenFolded' });

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
    const renderedBar = ui.TitleBar({
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

  /* --- title bar tooltip modes: custom arms hover, native keeps title --- */
  {
    const t = setup({});
    const ui = t.win.FBDietUI;
    ui.titleBarCache.set('u-tip-fold', {
      actorName: 'Hedy Lamarr',
      snippetText: 'Spread spectrum technology',
      groupName: 'Vienna Group',
      adUrl: ''
    });
    // Custom: folded bars carry no native title and arm hover instead.
    t.React.resetHooks();
    const foldedBar = ui.TitleBar({
      category: 'suggested',
      unitId: 'u-tip-fold',
      showTitle: true,
      isExpanded: false,
      tooltipMode: 'custom'
    });
    c.ok('custom folded bar carries no native title', !('title' in foldedBar.props));
    c.equals('custom folded bar arms hover', typeof foldedBar.props.onMouseEnter, 'function');
    c.equals('custom folded bar arms hover-out', typeof foldedBar.props.onMouseLeave, 'function');

    // Custom expanded bars show nothing and arm nothing.
    t.React.resetHooks();
    const expandedBar = ui.TitleBar({
      category: 'suggested',
      unitId: 'u-tip-fold',
      showTitle: true,
      isExpanded: true,
      tooltipMode: 'custom'
    });
    c.ok('custom expanded bar carries no tooltip', !('title' in expandedBar.props));
    c.ok('custom expanded bar arms no hover', !('onMouseEnter' in expandedBar.props));

    // Off: nothing anywhere, even folded with text.
    t.React.resetHooks();
    const offBar = ui.TitleBar({
      category: 'suggested',
      unitId: 'u-tip-fold',
      showTitle: true,
      isExpanded: false,
      tooltipMode: 'off'
    });
    c.ok('off bar carries no title', !('title' in offBar.props));
    c.ok('off bar arms no hover', !('onMouseEnter' in offBar.props));

    // Native keeps the previous contract: folded shows the full snippet,
    // expanded offers collapse in the feed locale.
    t.React.resetHooks();
    const nativeBar = ui.TitleBar({
      category: 'suggested',
      unitId: 'u-tip-fold',
      showTitle: true,
      isExpanded: false,
      tooltipMode: 'native'
    });
    c.equals('native folded bar tooltip is the full snippet', nativeBar.props.title, 'Spread spectrum technology');
    t.bridge.setSettings({ lang: 'en' });
    t.React.resetHooks();
    const nativeExpandedBar = ui.TitleBar({
      category: 'suggested',
      unitId: 'u-tip-fold',
      showTitle: true,
      isExpanded: true,
      tooltipMode: 'native'
    });
    c.equals('native expanded bar tooltip collapses in en', nativeExpandedBar.props.title, 'Collapse');

    // Missing mode falls back to the schema default (native).
    t.React.resetHooks();
    const defaultBar = ui.TitleBar({
      category: 'suggested',
      unitId: 'u-tip-fold',
      showTitle: true,
      isExpanded: false
    });
    c.equals('missing tooltipMode falls back to native', defaultBar.props.title, 'Spread spectrum technology');

    // No text to show means no tooltip and no hover in any mode.
    // A fresh setup: the harness keeps useState values across TitleBar calls,
    // so reusing this block's instance would leak the cached snippet above.
    const t2 = setup({});
    const ui2 = t2.win.FBDietUI;
    t2.React.resetHooks();
    const emptyBar = ui2.TitleBar({
      category: 'regular',
      unitId: 'u-tip-empty',
      showTitle: true,
      isExpanded: false,
      tooltipMode: 'custom'
    });
    c.ok('folded bar without text carries no tooltip', !('title' in emptyBar.props));
    c.ok('folded bar without text arms no hover', !('onMouseEnter' in emptyBar.props));
    t2.React.resetHooks();
    const storiesBar = ui2.TitleBar({
      category: 'stories',
      unitId: 'u-tip-stories',
      showTitle: true,
      isExpanded: false,
      tooltipMode: 'custom'
    });
    c.ok('folded media bar carries no tooltip', !('title' in storiesBar.props));
    c.ok('folded media bar arms no hover', !('onMouseEnter' in storiesBar.props));
  }

  /* --- dom mode, always show title, folded state displays title extracted from DOM --- */
  {
    const t = setup({});
    t.bridge.setSettings({
      enabled: true,
      dietMode: 'dom',
      showTitleMode: 'always',
      foldAds: true
    });

    // In `dom` mode the store is not consulted, so the unit that exercises a DOM-scanned title
    // bar has to be decided from free props — the same ad marker `relay` mode reads first.
    const unitId = 'u-dom-always-fold';
    const payload = payloadOf(unitId, { sponsored_data: { ad_id: 'ad-1' }, post_id: 'p-1' });

    // 1. Initial render of FoldUnit in folded state
    t.React.resetHooks();
    const foldOut = t.render(payload);
    c.ok('dom mode folded output is Fragment', foldOut.type === t.React.Fragment);

    const [barEl, hiddenContainerEl] = foldOut.props.children;
    c.equals('notice bar receives category sponsored', barEl.props.category, 'sponsored');
    // The DOM path has no store id to read, so the key is derived from props; how that key is
    // built is the subject of the dedicated fallback-unitId regression test above.
    c.ok('notice bar receives a unitId carrying the post id', String(barEl.props.unitId).indexOf('p-1') !== -1);
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

    // 3. Connect React ref to the bar DOM element and render TitleBar
    t.React.resetHooks();
    t.React.setRef(0, domBarNode);

    const renderedBar = t.win.FBDietUI.TitleBar(barEl.props);
    c.ok('title bar component renders', Boolean(renderedBar));
    c.ok('title bar has base class fb-diet-titlebar', renderedBar.props.className.includes('fb-diet-titlebar'));
    c.ok('folded title bar does NOT have fb-diet-state-expanded', !renderedBar.props.className.includes('fb-diet-state-expanded'));

    // Cache should be populated from DOM scan
    const cached = t.win.FBDietUI.titleBarCache.get(barEl.props.unitId);
    c.ok('titleBarCache populated for folded unit', Boolean(cached));
    c.equals('author extracted skips 為你推薦', cached.actorName, 'Marie Curie');
    c.equals('snippet extracted skips timestamp', cached.snippetText, 'Discovered Polonium and Radium Nobel Prize laureate');

    // Re-render (or inspect rendered element children)
    t.React.resetHooks();
    const finalBar = t.win.FBDietUI.TitleBar(barEl.props);
    const contentBox = finalBar.props.children;
    const kids = contentBox.props.children;

    c.equals('badge displayed in folded state', kids[0].props.className, 'fb-diet-badge fb-diet-badge-ads');
    c.equals('author displayed with colon in folded state', kids[1].props.children, 'Marie Curie:');
    c.equals('snippet displayed in folded state', kids[2].props.children, 'Discovered Polonium and Radium Nobel Prize laureate');

    // 4. Also verify toggle to expanded keeps title under 'always'
    t.bridge.toggle(barEl.props.unitId);
    t.React.resetHooks();
    const expandedFoldOut = t.render(payload);
    const [expandedBarEl] = expandedFoldOut.props.children;
    c.equals('expanded bar keeps showTitle: true under always mode', expandedBarEl.props.showTitle, true);
    c.equals('expanded bar has isExpanded: true', expandedBarEl.props.isExpanded, true);

    t.React.resetHooks();
    const renderedExpandedBar = t.win.FBDietUI.TitleBar(expandedBarEl.props);
    c.ok('expanded title bar has fb-diet-state-expanded class', renderedExpandedBar.props.className.includes('fb-diet-state-expanded'));
    const expandedKids = renderedExpandedBar.props.children.props.children;
    c.equals('author still displayed in expanded state', expandedKids[1].props.children, 'Marie Curie:');
    c.equals('snippet still displayed in expanded state', expandedKids[2].props.children, 'Discovered Polonium and Radium Nobel Prize laureate');
  }

  /* --- media bypass: reels and stories bypass DOM scan and show localized labels --- */
  {
    const t = setup({});
    const ui = t.win.FBDietUI;

    // 1. Label localization follows the extension's own language choice (settings.lang)
    t.bridge.setSettings({ lang: 'zh-TW' });
    c.equals('stories label in zh-TW', ui.getMediaLabel('stories'), '限時動態（朋友）');
    c.equals('reels label in zh-TW', ui.getMediaLabel('reels'), '連續短片');
    c.equals('suggestedGroup label in zh-TW', ui.getMediaLabel('suggestedGroup'), '推薦社團列表');

    t.bridge.setSettings({ lang: 'en' });
    c.equals('stories label in en', ui.getMediaLabel('stories'), 'Stories');
    c.equals('reels label in en', ui.getMediaLabel('reels'), 'Reels');
    c.equals('suggestedGroup label in en', ui.getMediaLabel('suggestedGroup'), 'Suggested Groups');

    // A profile that never opened Options has no choice stored, so the page still decides.
    t.bridge.setSettings({ lang: undefined });
    t.win.document = { documentElement: { lang: 'en-US' } };
    c.equals('stories label falls back to the page language', ui.getMediaLabel('stories'), 'Stories');
    t.win.document.documentElement.lang = 'zh-TW';
    c.equals('stories label follows a zh-TW page', ui.getMediaLabel('stories'), '限時動態（朋友）');

    // 2. Stories rendering in TitleBar (no snippet, author is localized media label)
    t.bridge.setSettings({ lang: 'zh-TW' });
    t.React.resetHooks();
    const storiesBar = ui.TitleBar({
      category: 'stories',
      showTitle: true,
      unitId: 'u-stories-test'
    });
    const storiesKids = storiesBar.props.children.props.children;
    c.equals('stories bar has media badge', storiesKids[0].props.className, 'fb-diet-badge fb-diet-badge-media');
    c.equals('stories bar uses non-bold fb-diet-title-media class', storiesKids[1].props.className, 'fb-diet-title-media');
    c.equals('stories bar shows 限時動態（朋友）', storiesKids[1].props.children, '限時動態（朋友）');
    c.equals('stories bar has no snippet', storiesKids.length, 2);

    // 3. Reels rendering in TitleBar (no snippet, author is localized media label)
    t.React.resetHooks();
    const reelsBar = ui.TitleBar({
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
    const groupBar = ui.TitleBar({
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
    const costcoTitleBar = ui.TitleBar({
      category: 'regular',
      showTitle: true,
      unitId: 'u-costco-test',
      enrichment: {
        actor: { name: 'Cora Chen' },
        group: { name: '量販店零食交流社團' },
        content: { message: '#Hardbite洋芋片好吃' }
      }
    });
    const costcoKids = costcoTitleBar.props.children.props.children;
    c.equals('costco bar has group span', costcoKids[1].props.className, 'fb-diet-title-group');
    const groupInnerKids = costcoKids[1].props.children;
    c.equals('costco group starts with [', groupInnerKids[0], '[');
    c.equals('costco group inner span class is fb-diet-title-group-name', groupInnerKids[1].props.className, 'fb-diet-title-group-name');
    c.equals('costco group inner span contains group name', groupInnerKids[1].props.children, '量販店零食交流社團');
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
    c.equals('healthy drift report sees the hook', healthy.hookActive, true);
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

    /* --- hard disable: a hook-less page must never be reported as module drift --- */
    const off = setup({}, { noFeedModule: true, cachedSettings: { enabled: false } });
    off.win.FBDietRelay = { isReady: () => true };
    for (let i = 0; i < 320; i++) {
      off.win.__d(function () {}, 'drift/Filler' + i + '.react', [], null, null, null, {});
    }
    {
      const origWarn = console.warn;
      const warnings = [];
      console.warn = (...args) => { warnings.push(args.join(' ')); };
      let offReport;
      try {
        offReport = off.win.FBDietFold.checkModuleDrift();
        off.win.FBDietFold.checkModuleDrift();
      } finally {
        console.warn = origWarn;
      }
      c.equals('hard disabled: drift report sees no hook', offReport.hookActive, false);
      c.equals('hard disabled: the absent hook vetoes suspicion', offReport.suspected, false);
      c.equals('hard disabled: the absent hook never counted a definition', offReport.dCalls, 0);
      c.equals('hard disabled: a disabled switch logs nothing', warnings.length, 0);
    }

    // Late enable: the switch is on now, but this page loaded without the hook. The verdict is
    // "dormant / not armed", and it must never borrow the stale-module wording.
    const late = setup({}, { noFeedModule: true, cachedSettings: { enabled: false } });
    late.win.FBDietBridge.setSettings({ enabled: true });
    late.win.FBDietRelay = { isReady: () => true };
    {
      const origWarn = console.warn;
      const warnings = [];
      console.warn = (...args) => { warnings.push(args.join(' ')); };
      let lateReport;
      try {
        lateReport = late.win.FBDietFold.checkModuleDrift();
        late.win.FBDietFold.checkModuleDrift();
      } finally {
        console.warn = origWarn;
      }
      c.equals('late enable: still reports no hook', lateReport.hookActive, false);
      c.equals('late enable: does not claim the table is stale', /FEED_UNIT_MODULES looks stale/.test(warnings.join('')), false);
      c.equals('late enable: warns exactly once', warnings.length, 1);
      c.ok('late enable: names the missing hook', /__d hook is not installed/.test(warnings[0]));
      c.ok('late enable: tells the user to reload', /Reload the page/.test(warnings[0]));
    }
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

  /* --- the fold bar's hover contract (content.css) --- */
  //
  // The bar is the only affordance left on a folded unit, so hover has to read as feedback: it
  // lightens the colour the bar already rests on, read from the token rather than restated as a
  // literal, so it still follows the theme. The expanded bar deliberately gets no hover of its own
  // (it is the bar in its second state) and the bar carries no press state at all.
  //
  // This is the one rule-level assertion the deleted probe-css suite carried: it scopes to the
  // hover block's own text, where a whole-file search for `color-mix` would not.
  {
    const css = fs.readFileSync(path.join(ROOT, 'src', 'content', 'content.css'), 'utf8');
    const hoverIdx = css.indexOf('.fb-diet-titlebar:hover');
    c.ok('content.css defines a fold bar hover rule', hoverIdx !== -1);
    const hoverBody = hoverIdx === -1 ? '' : css.slice(hoverIdx, css.indexOf('}', hoverIdx));
    c.ok('fold bar hover lightens the rest colour through color-mix',
      hoverBody.includes('color-mix') && hoverBody.includes('--fb-diet-bar-bg') &&
      !hoverBody.includes('--hover-overlay') && !hoverBody.includes('background-image'));
    c.ok('the expanded bar has no hover rule of its own', css.indexOf('.fb-diet-state-expanded:hover') === -1);
    c.ok('fold bar has no press state', css.indexOf('.fb-diet-titlebar:active') === -1);
  }
}

module.exports = { run, FEED_MODULE };