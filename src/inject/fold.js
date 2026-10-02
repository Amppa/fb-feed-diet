/**
 * FB Diet - React fold wrapper coordinator (MAIN world)
 *
 * Boot and diagnosis only. This file owns what happens once per page load - the
 * pre-hydration right-rail stylesheet, the Comet registration pass, the settings
 * listener, and the module drift watchdog - and assembles the public
 * window.FBDietFold surface out of its four siblings:
 *
 *   fold-config.js      (window.FBDietFoldConfig)      the fold table and every tuning
 *   fold-verdict.js     (window.FBDietFoldVerdict)     scope gate, mode, verdict, report
 *   fold-observer.js    (window.FBDietFoldObserver)    the shared DOM arm
 *   fold-components.js  (window.FBDietFoldComponents)  FoldUnit and its two siblings
 *
 * Nothing here decides a category, renders a unit, or watches the DOM. Group badges,
 * fold bars and probe reports live in their own modules (window.FBDietUI /
 * window.FBDietProbe) and are always read from there. Members are not prefixed with the
 * module's own name, so the module reads window.FBDietUI.TitleBar rather than
 * window.FBDietUI.FBDietTitleBar.
 *
 * Public API (window.FBDietFold): FEED_UNIT_MODULES, HIDE_MODE, FoldUnit, install(),
 * checkModuleDrift(), getStatus()
 */
window.FBDietFold = (() => {
  'use strict';

  const driftState = { warned: false, hookWarned: false };

  /**
   * Constants delegation: the fold table, hide mode and the two tunings live in
   * fold-config.js (`window.FBDietFoldConfig`). Every read happens at call time, so
   * this module never needs its sibling present while it is being evaluated. The
   * fallbacks are deliberately empty — a missing constants module must make the fold
   * do nothing rather than wrap modules against a guessed definer path or a guessed
   * threshold.
   */
  function getConfig() {
    return window.FBDietFoldConfig || {};
  }

  function withDefaultDefinerPath() {
    const config = getConfig();
    if (typeof config.withDefaultDefinerPath !== 'function') return [];
    return config.withDefaultDefinerPath();
  }

  /**
   * Component delegation (fold.js split): the three registered components, the element
   * helpers and the hydration counters live in fold-components.js
   * (`window.FBDietFoldComponents`). Only install(), the drift report and getStatus()
   * read them, and every read is resolved at call time. A missing components module
   * answers undefined, which registerComponent then refuses - the fold registers
   * nothing rather than wrapping modules with a component that is not there.
   */
  function getComponents() {
    return window.FBDietFoldComponents || {};
  }

  let emptyHydration = null;
  function getHydration() {
    const hydration = getComponents().hydration;
    if (hydration) return hydration;
    if (!emptyHydration) emptyHydration = { count: 0, byModule: {} };
    return emptyHydration;
  }

  /**
   * Session-level drift verdict built from the Comet hook's loader counters, the Relay
   * capture state and the fold scope. `seen === 0` while the loader is streaming
   * means no registered module name matched anymore.
   */
  function computeModuleDrift() {
    const comet = window.FBDietComet;
    const health = comet && typeof comet.getModuleHealth === 'function' ? comet.getModuleHealth() : null;
    const relay = window.FBDietRelay;
    const relayReady = Boolean(relay && typeof relay.isReady === 'function' && relay.isReady());

    let scopeAllowed = true;
    try {
      const defaults = window.FB_DIET_DEFAULTS;
      if (defaults && typeof defaults.isFoldScopeAllowed === 'function') {
        scopeAllowed = defaults.isFoldScopeAllowed(window.location ? window.location.pathname : undefined);
      }
    } catch (e) {}

    const report = {
      suspected: false,
      dCalls: health ? health.dCalls : 0,
      hookActive: health ? health.hookActive === true : false,
      registered: health ? health.registered : 0,
      seen: health ? health.seen : 0,
      patched: health ? health.patched : 0,
      hydration: getHydration().count,
      relayReady,
      scopeAllowed
    };

    report.suspected = Boolean(
      health &&
      health.dCalls >= getConfig().DRIFT_MIN_DCALLS &&
      health.seen === 0 &&
      relayReady &&
      scopeAllowed
    );
    return report;
  }

  function isMasterEnabled() {
    try {
      const bridge = window.FBDietBridge;
      if (!bridge || typeof bridge.getSettings !== 'function') return true;
      const settings = bridge.getSettings();
      return !settings || settings.enabled !== false;
    } catch (e) {
      return true;
    }
  }

  /**
   * Without the hook the loader counters never move, so `suspected` can never become true and
   * a hook-less page would look perfectly healthy. This branch is the only verdict that covers
   * it, and it must never be phrased as a module rename: a disabled extension is dormant by
   * design, not stale.
   */
  function checkModuleDrift() {
    const report = computeModuleDrift();

    if (!report.hookActive) {
      if (!driftState.hookWarned && isMasterEnabled()) {
        driftState.hookWarned = true;
        try {
          console.warn(
            '[FB Diet][Drift] The __d hook is not installed on this page load, so folding is ' +
            'inactive (dormant, not stale). Reload the page to arm it.',
            report
          );
        } catch (e) {}
      }
      return report;
    }

    if (report.suspected && !driftState.warned) {
      driftState.warned = true;
      try {
        console.warn(
          '[FB Diet][Drift] No feed unit module matched after ' + report.dCalls +
          ' module definitions (Relay active, scope allowed). FEED_UNIT_MODULES looks stale and folding may be inactive.',
          report
        );
      } catch (e) {}
    }
    return report;
  }

  function scheduleDriftChecks() {
    const schedule = (typeof window !== 'undefined' && typeof window.setTimeout === 'function')
      ? window.setTimeout
      : (typeof setTimeout === 'function' ? setTimeout : null);
    if (!schedule) return;
    const delays = getConfig().DRIFT_CHECK_DELAYS;
    if (!Array.isArray(delays)) return;
    for (const delay of delays) {
      try { schedule(checkModuleDrift, delay); } catch (e) {}
    }
  }

  const RIGHT_RAIL_STYLE_ID = 'fb-diet-right-rail-style';
  const RIGHT_RAIL_PREHIDE_CSS = `
    /* Pre-hydration first-frame right rail ad suppression (SSR markup) */
    :is(div[role="complementary"], aside, [data-pagelet*="RightRail"]) :is(
      a[attributionsrc],
      a[target^="rhcad"],
      a[href*="fbclid="],
      a[href*="/l.php"]
    ),
    a[target^="rhcad"],
    :is(div[role="complementary"], aside, [data-pagelet*="RightRail"]) :is(div, li):has(> :is(
      a[attributionsrc],
      a[target^="rhcad"],
      a[href*="fbclid="],
      a[href*="/l.php"]
    )),
    .CometHomeRightRailUnit:has(.adhidden, .fb-diet-side-ad-hidden),
    .adhidden,
    .fb-diet-side-ad-hidden {
      display: none !important;
    }
  `;

  function syncRightRailStyle(doc) {
    try {
      const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
      if (!targetDoc || typeof targetDoc.createElement !== 'function') return false;

      const bridge = window.FBDietBridge;
      const settings = bridge && typeof bridge.getSettings === 'function' ? bridge.getSettings() : null;
      const shouldHide = !settings || (settings.enabled !== false && settings.foldAds !== false);

      let style = targetDoc.getElementById ? targetDoc.getElementById(RIGHT_RAIL_STYLE_ID) : null;
      if (!shouldHide) {
        if (style && style.parentNode) {
          style.parentNode.removeChild(style);
        }
        return false;
      }

      if (!style) {
        style = targetDoc.createElement('style');
        style.id = RIGHT_RAIL_STYLE_ID;
        style.textContent = RIGHT_RAIL_PREHIDE_CSS;
        (targetDoc.head || targetDoc.documentElement).appendChild(style);
      }
      return true;
    } catch (e) {
      // Non-fatal
      return false;
    }
  }

  /**
   * The four modules this file assembles. A sibling that never loaded does not break
   * anything loudly: every read degrades to "do nothing", so install() registers zero
   * components and the page simply does not fold. That silence is the reason for the
   * self-check below - see `missingSiblings`.
   */
  const REQUIRED_SIBLINGS = [
    ['FBDietFoldConfig', 'src/inject/fold-config.js'],
    ['FBDietFoldVerdict', 'src/inject/fold-verdict.js'],
    ['FBDietFoldObserver', 'src/inject/fold-observer.js'],
    ['FBDietFoldComponents', 'src/inject/fold-components.js']
  ];

  function missingSiblings() {
    return REQUIRED_SIBLINGS
      .filter((entry) => !window[entry[0]])
      .map((entry) => entry[1]);
  }

  function install(doc) {
    syncRightRailStyle(doc);

    // Self-check, after the stylesheet and before Comet is read. The right-rail pre-hide
    // is pure CSS and must not be blocked by an absent JS module, while everything past
    // this point is folding and has nothing honest to do without its siblings.
    //
    // Without this guard the drift watchdog would call the missing module a Facebook
    // redesign: `dCalls >= 300 && seen === 0 && relayReady && scopeAllowed` is exactly the
    // shape a failed load of ours produces. Announcing "FEED_UNIT_MODULES looks stale"
    // because our own script was absent would poison the diagnosis itself, so install()
    // fails loudly instead and skips the `fold-installed` announcement - content.js has
    // its own `ping`-triggered announceReady and does not wait on this one.
    const missing = missingSiblings();
    if (missing.length) {
      console.error('[FB Diet][Install] fold modules missing, folding is disabled: ' + missing.join(', '));
      return false;
    }

    const comet = window.FBDietComet;
    if (!comet || typeof comet.registerComponent !== 'function') return false;

    let registered = 0;
    const feedUnitModules = getConfig().FEED_UNIT_MODULES;
    const defaultDefinerPath = getConfig().DEFAULT_DEFINER_PATH;
    if (!Array.isArray(feedUnitModules)) return false;
    const components = getComponents();
    for (const item of feedUnitModules) {
      const moduleName = item.name;
      const category = item.category;
      const definerPath = item.definerPath || defaultDefinerPath;

      let componentToRegister;
      if (moduleName === 'CometAdsSideFeedUnitItem.react') {
        componentToRegister = components.SideAdHidden;
      } else if (moduleName === 'CometHomeRightRailUnit.react') {
        componentToRegister = components.RightRailUnitWrapper;
      } else {
        componentToRegister = function SpecificFold(props) {
          return components.FoldUnit(Object.assign({ entryCategory: category, moduleName }, props));
        };
      }

      if (comet.registerComponent(moduleName, { component: componentToRegister, definerPath })) {
        registered += 1;
      }
    }

    if (window.FBDietBridge) window.FBDietBridge.announceReady('fold-installed');
    return registered > 0;
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('fb-diet:settings-changed', () => {
      syncRightRailStyle();
    });
  }

  install();
  // Not `if (install())`: a page with no Comet hook is dormant, not broken, and the drift
  // verdict for it is the one branch that still has something to say. Only a missing
  // sibling makes install() fail here, and that page has no drift story to tell.
  if (!missingSiblings().length) scheduleDriftChecks();

  return {
    FEED_UNIT_MODULES: withDefaultDefinerPath(),
    get HIDE_MODE() { return getConfig().HIDE_MODE; },
    get FoldUnit() { return getComponents().FoldUnit; },
    // Pure: takes the props and both DOM verdicts, returns the reconciled one. Exported so the
    // DOM-override rule can be tested without mounting a feed unit (STRATEGY.md decision #39).
    // A missing verdict module answers null, the same "classification impossible" answer the
    // function already returns when no classifier module is present.
    resolveVerdict(props, domSuggested, domSponsored, opts) {
      const verdict = window.FBDietFoldVerdict || {};
      if (typeof verdict.resolveVerdict !== 'function') return null;
      return verdict.resolveVerdict(props, domSuggested, domSponsored, opts);
    },
    install,
    syncRightRailStyle,
    checkModuleDrift,
    getStatus: () => ({
      hideMode: getConfig().HIDE_MODE,
      modules: withDefaultDefinerPath(),
      // The live counters, not a copy: a snapshot would freeze the hydration count at the
      // first read.
      hydration: getHydration(),
      drift: computeModuleDrift(),
      registered: window.FBDietComet ? window.FBDietComet.listRegistered() : null,
      settings: window.FBDietBridge ? window.FBDietBridge.getSettings() : null
    })
  };
})();
