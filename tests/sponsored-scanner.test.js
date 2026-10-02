'use strict';
/**
 * Lifecycle test for the sponsorship slot of the shared DOM observer in
 * src/inject/fold.js (decision #39).
 *
 * scanner.test.js covers the shared infrastructure; what is unique here and therefore
 * worth its own suite:
 *   - it is armed only in dom mode,
 *   - it shares the single arm with the other slots (one observer, one ladder),
 *   - it receives no store verdict and no second argument: the detector answers from
 *     the page alone,
 *   - a hit silences only its own slot (the shared observer keeps watching the rest)
 *     while still folding the unit as an ad on the next render.
 *
 * The harness has no real React commit, so the container ref is wired by hand and the
 * observer is driven through its observer/timer doubles, exactly as scanner.test.js does.
 */
const {
  createFakeReact,
  createWindow,
  loadMainWorld,
  createFakeComet,
  makeNode,
  flushTimers
} = require('./harness');

const FEED_MODULE = 'CometFeedUnitErrorBoundary.react';

const pendingTimers = (win) => win.__timers.filter((timer) => !timer.cleared);

function setup(relayMap) {
  const React = createFakeReact();
  const win = createWindow();
  const comet = createFakeComet(win, React);

  loadMainWorld(win, { include: ['dom-sponsored.js'] });

  win.FBDietRelayClassify.setRelayReader((ids, path) => {
    const id = Array.isArray(ids) ? ids[0] : ids;
    if (typeof relayMap === 'function') return relayMap(id, path);
    return (relayMap && relayMap[path]) || null;
  });

  // Both detectors become counting stubs. The suggested one stays silent, so the sponsorship
  // scanner is what the effect arms on its next run — the production ordering.
  const suggestedCalls = { n: 0 };
  win.FBDietDOMSuggested.detect = () => {
    suggestedCalls.n += 1;
    return null;
  };

  const sponsoredCalls = [];
  let sponsoredVerdict = null;
  win.FBDietDOMSponsored.detect = function (...args) {
    sponsoredCalls.push({ args, container: args[0] });
    return sponsoredVerdict;
  };

  const SourceCmp = () => ({ type: 'div', props: { children: 'original post' }, __source: true });
  win.__d(SourceCmp, FEED_MODULE, [], null, null, null, { default: SourceCmp });
  comet.require(FEED_MODULE);
  const wrapper = comet.getExport(FEED_MODULE).default;

  const container = makeNode('div', { className: 'fb-diet-full-container' });

  return {
    React,
    win,
    container,
    suggestedCalls,
    sponsoredCalls,
    setSponsoredVerdict: (next) => { sponsoredVerdict = next; },
    // Pass 1: hydration commit (no container ref yet). Pass 2: the commit that mounts it.
    hydrationPass(payload) {
      React.resetHooks();
      const element = wrapper(payload);
      element.type(element.props);
      return element;
    },
    containerPass(element) {
      React.resetHooks();
      React.setRef(0, container);
      return element.type(element.props);
    },
    // A third pass off the same element, which is what a re-render looks like in the harness: the
    // container ref stays mounted and the hook cursor restarts, so state set during the container
    // pass is read back.
    render(element) {
      React.resetHooks();
      React.setRef(0, container);
      return element.type(element.props);
    }
  };
}

function run(c) {
  const payload = { feedUnit: { id: 'sponsor-1', __typename: 'FeedUnitRoot' } };
  const DOM = { dietMode: 'dom', enabled: true, alwaysShowFoldBar: false, debugProbe: false };

  /* --- the sponsorship scanner arms only in the mode that has a mounted-DOM engine --- */
  {
    const relay = setup({});
    relay.win.FBDietBridge.setSettings(Object.assign({}, DOM, { dietMode: 'relay' }));
    const element = relay.hydrationPass(payload);
    relay.containerPass(element);
    c.equals('relay mode runs no suggested scanner', relay.suggestedCalls.n, 0);
    c.equals('relay mode runs no sponsorship scanner', relay.sponsoredCalls.length, 0);
    c.equals('relay mode attaches no observer', relay.win.__observers.mutation.length, 0);

    // DOM-only has the visual engine as its ONLY engine, so not arming there would leave the
    // mode with no way to see anything at all.
    const domOnly = setup({});
    domOnly.win.FBDietBridge.setSettings(Object.assign({}, DOM, { dietMode: 'dom' }));
    const domElement = domOnly.hydrationPass(payload);
    domOnly.containerPass(domElement);
    c.ok('dom-only mode arms the suggested scanner', domOnly.suggestedCalls.n >= 1);
    c.ok('dom-only mode arms the sponsorship scanner', domOnly.sponsoredCalls.length >= 1);
  }

  /* --- arming: one shared arm runs every open slot in precedence order --- */
  {
    const t = setup({});
    t.win.FBDietBridge.setSettings(DOM);
    const element = t.hydrationPass(payload);
    const afterHydration = t.sponsoredCalls.length;
    t.containerPass(element);

    c.ok('the suggested slot runs on the container commit', t.suggestedCalls.n >= 1);
    c.equals('the hydration commit runs no sponsorship scan', afterHydration, 0);
    c.ok('the container commit arms the sponsorship slot too', t.sponsoredCalls.length >= 1);
    c.ok('the sponsorship scan watches the unit container', t.sponsoredCalls[0].container === t.container);
    c.equals('the shared arm attaches a single MutationObserver', t.win.__observers.mutation.length, 1);
  }

  /* --- the detector is called with the container and nothing else --- */
  {
    // It used to receive the store verdict as a second argument, purely so the circuit breaker
    // could count disagreements. With the breaker gone the argument has no consumer, and passing
    // it would reintroduce a data-engine dependency into a module that is meant to answer from
    // the page alone.
    const t = setup({});
    t.win.FBDietBridge.setSettings(DOM);
    const element = t.hydrationPass(payload);
    t.containerPass(element);
    t.win.__observers.mutation[t.win.__observers.mutation.length - 1].trigger();
    flushTimers(t.win, () => true);

    c.ok('the sponsorship scanner ran', t.sponsoredCalls.length >= 2);
    c.ok('every call passed the unit container', t.sponsoredCalls.every((call) => call.container === t.container));
    c.ok('every call passed exactly one argument', t.sponsoredCalls.every((call) => call.args.length === 1));
  }

  /* --- a DOM hit silences its slot and folds the unit as an ad --- */
  {
    const t = setup({});
    t.win.FBDietBridge.setSettings(Object.assign({}, DOM, { minimizedFoldMode: true }));
    const element = t.hydrationPass(payload);
    t.containerPass(element);

    const mutations = t.win.__observers.mutation;
    t.setSponsoredVerdict({
      isSponsored: true,
      signal: 'plain_text',
      reason: 'dom:plain_text',
      text: 'Sponsored',
      debug: { matchedText: 'Sponsored', signal: 'plain_text' }
    });

    const callsBefore = t.sponsoredCalls.length;
    // Fires one coalesced pass without touching the ladder or the hard timeout: only
    // timers scheduled by the trigger itself are flushed.
    const firePass = () => {
      const before = pendingTimers(t.win).slice();
      mutations[mutations.length - 1].trigger();
      const fresh = pendingTimers(t.win).filter((timer) => before.indexOf(timer) === -1);
      return flushTimers(t.win, (timer) => fresh.indexOf(timer) !== -1);
    };
    c.ok('the coalesced pass re-detected', firePass() >= 1 && t.sponsoredCalls.length > callsBefore);
    // The shared observer belongs to the remaining slots too, so a hit must not kill it:
    // the sponsored slot goes quiet while the arm lives on until the hard timeout.
    const silencedCalls = t.sponsoredCalls.length;
    firePass();
    c.equals('a hit silences its own slot', t.sponsoredCalls.length, silencedCalls);
    c.ok('a hit keeps the shared observer alive', mutations[mutations.length - 1].disconnected !== true);
    c.ok('a hit keeps the shared ladder alive', pendingTimers(t.win).length > 0);

    // The next render sees the DOM verdict and folds as sponsored even though Relay found nothing.
    t.containerPass(element);
    const blocked = t.win.__messages.filter((m) => m && m.type === 'blocked');
    c.ok('a DOM-only ad is reported as blocked', blocked.length >= 1);
    c.equals('a DOM-only ad is reported as sponsored', blocked[blocked.length - 1].payload.category, 'sponsored');
    c.equals('a DOM-only ad is reported with the DOM reason', blocked[blocked.length - 1].payload.reason, 'dom:plain_text');
  }

  /* --- REGRESSION: a DOM-only ad must be reachable at all --- */
  {
    // This is the case the whole feature exists for, and it is the one the wiring used to make
    // impossible: the sponsorship scanner only armed after the SUGGESTED scanner had already
    // produced a hit, and a suggested hit also sets the category to 'suggested' — so the
    // `category === 'regular'` guard could never be satisfied and no DOM-only ad could ever fold.
    // No suggested signal is in play at all here, which is the real page shape.
    const t = setup({});
    t.win.FBDietBridge.setSettings(Object.assign({}, DOM, { minimizedFoldMode: true }));
    t.setSponsoredVerdict({
      isSponsored: true,
      signal: 'plain_text',
      reason: 'dom:plain_text',
      text: 'Sponsored',
      debug: { matchedText: 'Sponsored', signal: 'plain_text' }
    });

    const element = t.hydrationPass(payload);
    t.containerPass(element);

    c.equals('the suggested detector found nothing', t.suggestedCalls.n >= 1, true);
    c.ok('the sponsorship scanner armed without waiting for a suggested hit', t.sponsoredCalls.length >= 1);

    // The very first synchronous pass hit, so the next render must fold it as an ad.
    // containerPass resets the hook cursor itself, which is what re-reads the new state.
    t.containerPass(element);
    const blocked = t.win.__messages.filter((m) => m && m.type === 'blocked');
    c.ok('an organic post the DOM calls an ad is folded', blocked.length >= 1);
    c.equals('it folds as sponsored on DOM evidence alone', blocked[blocked.length - 1].payload.category + ':' + blocked[blocked.length - 1].payload.reason, 'sponsored:dom:plain_text');
  }

  /* --- a module-declared unit arms the sponsorship slot alone --- */
  {
    // entryCategory is structural (this IS the tray): surface and suggested can never change
    // the verdict, so sweeping them per pass is pure waste. Only the unconditional
    // sponsorship override (decision #39) still can, so it stays armed.
    const t = setup({});
    t.win.FBDietBridge.setSettings(DOM);
    let surfaceCalls = 0;
    const realSurfaceDetect = t.win.FBDietDOMSurface.detect;
    t.win.FBDietDOMSurface.detect = (...args) => {
      surfaceCalls += 1;
      return realSurfaceDetect.apply(t.win.FBDietDOMSurface, args);
    };
    const props = {
      lastCmp: { type: 'div', props: { children: 'stories tray' } },
      moduleName: 'StoriesTray.react',
      entryCategory: 'stories',
      payload: { feedUnit: { id: 'tray-1', __typename: 'Story' } }
    };
    t.React.resetHooks();
    t.win.FBDietFold.FoldUnit(props);
    t.React.resetHooks();
    t.React.setRef(0, t.container);
    t.win.FBDietFold.FoldUnit(props);
    c.equals('a declared tray never sweeps the surface detector', surfaceCalls, 0);
    c.equals('a declared tray never sweeps the suggested detector', t.suggestedCalls.n, 0);
    c.ok('a declared tray still arms the sponsorship override', t.sponsoredCalls.length >= 1);
  }

  /* --- REGRESSION: DOM-only must render a bar and a probe, not the bare source --- */
  {
    // A unit the DOM has not caught has category null in this pipeline, and null used to end the
    // render before the fold bar and before the probe got a container. On a real page that made
    // the diagnostic mode look like a broken extension: no headers, no probe buttons, nothing to
    // read. The mode is judged by what it sees across the whole feed, so "scanned, found
    // nothing" has to be visible and inspectable like any other unit.
    const t = setup({});
    t.win.location.pathname = '/';
    t.win.FBDietBridge.setSettings({ dietMode: 'dom', enabled: true, debugProbe: true, alwaysShowFoldBar: true, minimizedFoldMode: true });
    // Both DOM detectors find nothing at all.
    t.win.FBDietDOMSuggested.detect = () => null;
    t.win.FBDietDOMSponsored.detect = () => null;

    const quiet = { feedUnit: { id: 'u-dom-quiet', __typename: 'FeedUnitRoot' } };
    const element = t.hydrationPass(quiet);
    t.containerPass(element);
    const out = t.render(element);

    c.ok('the unit is no longer the untouched source', out.__source !== true);
    c.equals('a probe holder wraps it', out.props.className, 'fb-diet-probe-holder');
    c.ok('a probe button is present', JSON.stringify(out).indexOf('fb-diet-probe-btn') !== -1);

    const bar = out.props.children[1].props.children[0];
    c.equals('the fold bar renders', bar.type, t.win.FBDietUI.TitleBar);
    c.equals('an uncaught unit shows as regular', bar.props.category, 'regular');
  }
}

module.exports = { run };