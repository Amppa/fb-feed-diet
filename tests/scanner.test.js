'use strict';
/**
 * Lifecycle test for the DOM suggestion scanner in src/inject/fold.js.
 *
 * The harness has no real React commit, so the container ref is wired manually and the
 * scanner is driven through its observer/timer doubles. That makes the suite deterministic
 * and instant while still asserting the module's *own* guards (attach timing, burst
 * coalescing, the final stop) rather than the browser's behaviour.
 *
 * Not covered here (inspection only): the `isNested` skip, which needs a nested fold context
 * the harness does not model.
 */
const {
  createFakeReact,
  createWindow,
  loadInject,
  loadDefaults,
  createFakeComet,
  makeNode,
  flushTimers
} = require('./harness');

const FEED_MODULE = 'CometFeedUnitErrorBoundary.react';
const LADDER_LENGTH = 6; // DOM_SUGGESTED_SCAN_DELAYS

const pendingTimers = (win) => win.__timers.filter((timer) => !timer.cleared);

function setup() {
  const React = createFakeReact();
  const win = createWindow();
  const comet = createFakeComet(win, React);

  win.FB_DIET_DEFAULTS = loadDefaults();
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

  win.FBDietRelayClassify.setRelayReader(() => null);

  // This suite is about the SUGGESTED scanner, and the sponsorship scanner now arms in the same
  // effect run (decision #39), which would double every observer and timer count below. Removing
  // the module keeps the counts measuring the one scanner under test; the sponsorship scanner has
  // its own suite (tests/sponsored-scanner.test.js).
  delete win.FBDietDOMSponsored;

  const SourceCmp = () => ({ type: 'div', props: { children: 'original post' }, __source: true });
  win.__d(SourceCmp, FEED_MODULE, [], null, null, null, { default: SourceCmp });
  comet.require(FEED_MODULE);
  const wrapper = comet.getExport(FEED_MODULE).default;

  // The detector is replaced by a counting stub: each call is one full five-scan sweep in
  // production, so the call count is what the coalescing assertions measure.
  let detectCalls = 0;
  let verdict = null;
  win.FBDietDOMSuggested.detect = () => {
    detectCalls += 1;
    return verdict;
  };

  const container = makeNode('div', { className: 'fb-diet-full-container' });

  return {
    React,
    win,
    container,
    detectCalls: () => detectCalls,
    setVerdict: (next) => { verdict = next; },
    // Pass 1 is the hydration commit: the unit still returns its original tree, so nothing
    // carries containerRef yet. Pass 2 is the commit that mounts the wrapper.
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
    }
  };
}

function run(c) {
  const t = setup();
  t.win.FBDietBridge.setSettings({
    dietMode: 'dom',
    enabled: true,
    alwaysShowFoldBar: false,
    debugProbe: false
  });

  const payload = { feedUnit: { id: 'scanner-1', __typename: 'FeedUnitRoot' } };

  /* --- attaching waits for the commit that mounts the container ref --- */
  const beforeHydration = t.win.__timers.length;
  const element = t.hydrationPass(payload);
  c.equals('the hydration commit attaches no observer', t.win.__observers.mutation.length, 0);
  c.equals('the hydration commit schedules no timer', t.win.__timers.length, beforeHydration);

  const beforeMount = t.win.__timers.length;
  t.containerPass(element);
  const preMountTimers = t.win.__timers.slice(0, beforeMount);
  const setupTimers = t.win.__timers.slice(beforeMount);

  const mutations = t.win.__observers.mutation;
  const intersections = t.win.__observers.intersection;
  // The suggested detector arms first, so its timers are the first LADDER_LENGTH + 1 of
  // setupTimers; the rest belong to the other armed detector, which stays armed after this
  // scanner hits. Only the suggested scanner's own timers are this suite's subject.
  const suggestedTimers = setupTimers.slice(0, LADDER_LENGTH + 1);
  const scannerPending = () => pendingTimers(t.win).filter((timer) => suggestedTimers.indexOf(timer) !== -1);
  const newTimers = () => pendingTimers(t.win)
    .filter((timer) => setupTimers.indexOf(timer) === -1 && preMountTimers.indexOf(timer) === -1);

  // 'dom' is the mode that mounts a DOM engine, and it mounts every detector whose module is
  // present — here the suggested and surface detectors. Each builds its own observer pair, so the
  // counts below are per armed detector rather than fixed at one.
  const ARMED = 2;

  c.equals('the container commit builds one MutationObserver per armed detector', mutations.length, ARMED);
  c.equals('the container commit builds one IntersectionObserver per armed detector', intersections.length, ARMED);
  c.ok('MutationObserver watches the unit container', mutations[0].observed[0] === t.container);
  c.ok('IntersectionObserver watches the unit container', intersections[0].observed[0] === t.container);
  c.equals('mount runs exactly one synchronous detection pass for the suggested detector', t.detectCalls(), 1);
  c.equals('setup arms the retry ladder plus one hard timeout, per detector', setupTimers.length, ARMED * (LADDER_LENGTH + 1));

  /* --- mutation bursts are coalesced into one pending pass --- */
  const beforeBursts = t.detectCalls();
  mutations[0].trigger();
  mutations[0].trigger();
  mutations[0].trigger();
  c.equals('three synchronous bursts cause no synchronous pass', t.detectCalls(), beforeBursts);
  c.equals('three bursts coalesce into one pending pass', newTimers().length, 1);
  c.equals('the coalesced pass runs on its own timer', flushTimers(t.win, (timer) => timer === newTimers()[0]), 1);
  c.equals('the coalesced pass detects once', t.detectCalls(), beforeBursts + 1);

  /* --- the IntersectionObserver entry point is throttled the same way --- */
  intersections[0].trigger([{ isIntersecting: false }]);
  c.equals('a non-intersecting entry schedules nothing', newTimers().length, 0);
  intersections[0].trigger([{ isIntersecting: true }]);
  c.equals('an intersecting entry schedules one pass', newTimers().length, 1);
  const scrollTimer = newTimers()[0];
  c.equals('the scroll pass runs on its timer', flushTimers(t.win, (timer) => timer === scrollTimer), 1);
  c.equals('the scroll pass detects once', t.detectCalls(), beforeBursts + 2);

  /* --- a hit stops the scanner for good --- */
  t.setVerdict({ isSuggested: true, signal: 'Follow', reason: 'dom:follow_button', text: '· 追蹤' });
  mutations[0].trigger();
  const hitTimer = newTimers()[0];
  c.equals('the hit is detected by a coalesced pass', flushTimers(t.win, (timer) => timer === hitTimer), 1);
  c.equals('a hit disconnects the MutationObserver', mutations[0].disconnected, true);
  c.equals('a hit disconnects the IntersectionObserver', intersections[0].disconnected, true);
  c.equals('a hit cancels every timer the scanner armed', scannerPending().length, 0);

  /* --- nothing can restart it: a folded unit stays mounted, so React never re-runs it --- */
  const afterHit = t.detectCalls();
  mutations[0].trigger();
  mutations[0].trigger();
  intersections[0].trigger([{ isIntersecting: true }]);
  c.equals('a late burst schedules nothing', newTimers().length, 0);
  c.equals('a late burst cannot detect again', t.detectCalls(), afterHit);
  c.equals('a late burst cannot re-arm an observer', t.win.__observers.mutation.length, ARMED);
  c.equals('the scanner holds no live timer after the hit', scannerPending().length, 0);
}

module.exports = { run };
