'use strict';
/**
 * Lifecycle test for the shared DOM observer in src/inject/fold.js.
 *
 * One observer serves every unfilled detection slot (stage 3 of the DOM pipeline), so this
 * suite asserts the *shared* infrastructure: attach timing, burst coalescing, per-slot
 * silencing on hit (the observer itself keeps watching the remaining slots), the detached
 * and skeleton bailouts, the props-ad short-circuit, the tray veto skip, and the final
 * stop at the hard timeout.
 *
 * The harness has no real React commit, so the container ref is wired manually and the
 * observer is driven through its observer/timer doubles. That makes the suite deterministic
 * and instant while still asserting the module's *own* guards rather than the browser's
 * behaviour.
 *
 * Not covered here (inspection only): the `isNested` skip, which needs a nested fold context
 * the harness does not model.
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

function setup() {
  const React = createFakeReact();
  const win = createWindow();
  const comet = createFakeComet(win, React);

  loadMainWorld(win);

  win.FBDietRelayClassify.setRelayReader(() => null);

  // This suite is about the shared observer, and the sponsorship detector now shares the
  // same arm (decision #39 needs no dedicated scanner of its own). Removing the module keeps
  // the slot math to the two under test (suggested + surface); the sponsorship slot has its
  // own suite (tests/sponsored-scanner.test.js).
  delete win.FBDietDOMSponsored;

  const SourceCmp = () => ({ type: 'div', props: { children: 'original post' }, __source: true });
  win.__d(SourceCmp, FEED_MODULE, [], null, null, null, { default: SourceCmp });
  comet.require(FEED_MODULE);
  const wrapper = comet.getExport(FEED_MODULE).default;

  // The detector is replaced by a counting stub: each call is one full five-scan sweep in
  // production, so the call count is what the coalescing assertions measure. The surface
  // detector stays real (a plain container never matches it) and is counted through a
  // wrapper so the shared-arm assertions can tell the slots apart.
  let detectCalls = 0;
  let verdict = null;
  win.FBDietDOMSuggested.detect = () => {
    detectCalls += 1;
    return verdict;
  };
  let surfaceCalls = 0;
  const realSurfaceDetect = win.FBDietDOMSurface.detect;
  win.FBDietDOMSurface.detect = (el) => {
    surfaceCalls += 1;
    return realSurfaceDetect(el);
  };

  const container = makeNode('div', { className: 'fb-diet-full-container' });

  return {
    React,
    win,
    container,
    detectCalls: () => detectCalls,
    surfaceCalls: () => surfaceCalls,
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
  const scannerPending = () => pendingTimers(t.win).filter((timer) => setupTimers.indexOf(timer) !== -1);
  const newTimers = () => pendingTimers(t.win)
    .filter((timer) => setupTimers.indexOf(timer) === -1 && preMountTimers.indexOf(timer) === -1);

  // One shared observer serves every open slot (here suggested + surface), so the counts
  // below are fixed at one arm: one observer pair, one six-rung ladder, one hard timeout.
  c.equals('the container commit builds one shared MutationObserver', mutations.length, 1);
  c.equals('the container commit builds one shared IntersectionObserver', intersections.length, 1);
  c.ok('MutationObserver watches the unit container', mutations[0].observed[0] === t.container);
  c.ok('IntersectionObserver watches the unit container', intersections[0].observed[0] === t.container);
  c.equals('mount runs exactly one synchronous detection pass for the suggested detector', t.detectCalls(), 1);
  c.equals('mount runs the surface detector in the same pass', t.surfaceCalls(), 1);
  c.equals('setup arms one retry ladder plus one hard timeout, shared', setupTimers.length, 6 + 1);

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

  /* --- a hit silences its slot but the shared observer keeps watching the rest --- */
  t.setVerdict({ isSuggested: true, signal: 'Follow', reason: 'dom:follow_button', text: '· 追蹤' });
  mutations[0].trigger();
  const hitTimer = newTimers()[0];
  c.equals('the hit is detected by a coalesced pass', flushTimers(t.win, (timer) => timer === hitTimer), 1);
  const afterHit = t.detectCalls();
  c.ok('a hit does not disconnect the shared MutationObserver', mutations[0].disconnected !== true);
  c.ok('a hit does not disconnect the shared IntersectionObserver', intersections[0].disconnected !== true);
  c.ok('a hit does not cancel the shared ladder', scannerPending().length > 0);

  /* --- the answered slot is never swept again while the others still are --- */
  mutations[0].trigger();
  intersections[0].trigger([{ isIntersecting: true }]);
  const rescanTimer = newTimers()[0];
  flushTimers(t.win, (timer) => timer === rescanTimer);
  c.equals('an answered slot is never swept again', t.detectCalls(), afterHit);
  c.ok('the open slot is still swept', t.surfaceCalls() > 1);

  /* --- the hard timeout stops everything for good --- */
  // Flushing the 15s timeout (plus the remaining ladder) ends the arm: with no re-render
  // in the harness nothing re-arms, so this is the terminal state.
  flushTimers(t.win, () => true);
  c.equals('the timeout disconnects the MutationObserver', mutations[0].disconnected, true);
  c.equals('the timeout disconnects the IntersectionObserver', intersections[0].disconnected, true);
  c.equals('the timeout cancels every timer the observer armed', scannerPending().length, 0);
  const quietCalls = t.detectCalls();
  mutations[0].trigger();
  flushTimers(t.win, () => true);
  c.equals('a late burst after the timeout detects nothing', t.detectCalls(), quietCalls);

  /* --- a detached container is skipped without diagnosing --- */
  {
    const detached = setup();
    detached.win.FBDietBridge.setSettings({
      dietMode: 'dom',
      enabled: true,
      alwaysShowFoldBar: false,
      debugProbe: false
    });
    const detachedContainer = makeNode('div', { className: 'fb-diet-full-container' });
    detachedContainer.isConnected = false;
    const detachedElement = detached.hydrationPass({ feedUnit: { id: 'scanner-detached', __typename: 'FeedUnitRoot' } });
    detached.React.resetHooks();
    detached.React.setRef(0, detachedContainer);
    detachedElement.type(detachedElement.props);
    c.equals('a detached container runs no detector', detached.detectCalls(), 0);
    c.equals('a detached container attaches no observer', detached.win.__observers.mutation.length, 0);
    c.ok('a detached container still arms the ladder for later rounds', pendingTimers(detached.win).length > 0);
  }

  /* --- a skeleton container is skipped without diagnosing --- */
  {
    const skeleton = setup();
    skeleton.win.FBDietBridge.setSettings({
      dietMode: 'dom',
      enabled: true,
      alwaysShowFoldBar: false,
      debugProbe: false
    });
    const skeletonContainer = makeNode('div', { className: 'fb-diet-full-container' });
    skeletonContainer.childElementCount = 0;
    const skeletonElement = skeleton.hydrationPass({ feedUnit: { id: 'scanner-skeleton', __typename: 'FeedUnitRoot' } });
    skeleton.React.resetHooks();
    skeleton.React.setRef(0, skeletonContainer);
    skeletonElement.type(skeletonElement.props);
    c.equals('a skeleton container runs no detector', skeleton.detectCalls(), 0);
    c.equals('a skeleton container attaches no observer', skeleton.win.__observers.mutation.length, 0);
    c.ok('a skeleton container still arms the ladder for later rounds', pendingTimers(skeleton.win).length > 0);
  }

  /* --- a props-decided ad mounts nothing at all --- */
  {
    const adUnit = setup();
    adUnit.win.FBDietBridge.setSettings({
      dietMode: 'dom',
      enabled: true,
      alwaysShowFoldBar: false,
      debugProbe: false
    });
    // install() parks two drift-check timers at load; the short-circuit must add none.
    const timersAtLoad = pendingTimers(adUnit.win).length;
    const adPayload = { feedUnit: { id: 'scanner-ad', __typename: 'FeedUnitRoot', th_dat_spo: 'ad-marker' } };
    const adElement = adUnit.hydrationPass(adPayload);
    adUnit.containerPass(adElement);
    c.equals('a props-decided ad runs no detector', adUnit.detectCalls(), 0);
    c.equals('a props-decided ad attaches no observer', adUnit.win.__observers.mutation.length, 0);
    c.equals('a props-decided ad schedules no timer', pendingTimers(adUnit.win).length, timersAtLoad);
  }

  /* --- a vetoed tray never pays for the suggestion sweep --- */
  {
    const tray = setup();
    tray.win.FBDietBridge.setSettings({
      dietMode: 'dom',
      enabled: true,
      alwaysShowFoldBar: false,
      debugProbe: false
    });
    const trayContainer = makeNode('div', { className: 'fb-diet-full-container' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [
        makeNode('h3', {}, [], '連續短片')
      ])
    ]);
    const trayElement = tray.hydrationPass({ feedUnit: { id: 'scanner-tray', __typename: 'FeedUnitRoot' } });
    tray.React.resetHooks();
    tray.React.setRef(0, trayContainer);
    trayElement.type(trayElement.props);
    c.ok('a tray container still runs the surface detector', tray.surfaceCalls() >= 1);
    c.equals('a vetoed tray never runs the suggestion sweep', tray.detectCalls(), 0);
  }
}

module.exports = { run };
