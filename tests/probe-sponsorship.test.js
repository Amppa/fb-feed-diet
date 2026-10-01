'use strict';
/**
 * Contract tests for the DOM sponsorship block in the probe report (STRATEGY.md decision #39).
 *
 * `dom.extracted.sponsored` is the detector's own verdict: which signal matched and the text it
 * matched on. It is reported whether or not it changed the verdict, so a hit that merely confirmed
 * the store is still visible.
 *
 * The detector is stubbed in most cases (its matching is covered by dom-sponsored.test.js); the
 * last block runs the real module so the two halves are proven to fit together.
 */
const { createWindow, loadInject, loadDefaults, makeNode } = require('./harness');

const FEED_MODULE = 'CometFeedUnitErrorBoundary.react';

function buildWorld(detector) {
  const win = createWindow();
  win.FB_DIET_DEFAULTS = loadDefaults();
  win.document = { documentElement: { lang: 'zh-TW' } };
  loadInject(win, 'relay.js');
  loadInject(win, 'bridge.js');
  loadInject(win, 'dom-metadata.js');
  loadInject(win, 'ui.js');
  loadInject(win, 'probe.js');
  if (detector) win.FBDietDOMSponsored = detector;
  return win;
}

const props = { moduleName: FEED_MODULE, payload: { feedUnit: { post_id: 'post_1' } } };
// The render path hands the probe a verdict, and a verdict names what produced it. These are the
// two shapes a `relay` mode unit arrives in.
const regularClassify = { unitId: 'unit_1', category: 'regular', reason: 'no-match', source: 'relay', evidence: { id: 'unit_1' } };
const adClassify = { unitId: 'unit_1', category: 'sponsored', reason: 'sponsored_data.ad_id', source: 'relay', evidence: { adId: 'ad_1' } };
/** A `dom` mode unit the engine examined and did not fold: the verdict is null, the display is not. */
const noVerdict = { unitId: 'unit_1', category: null, reason: 'dom:no-verdict', source: 'dom', moduleName: FEED_MODULE, display: { category: 'regular', substituted: true } };

/** The detector takes only the container and keeps no state, so a stub needs nothing else. */
function stubDetector(verdict) {
  const calls = [];
  return {
    calls,
    detect(container) {
      calls.push({ container });
      return verdict || null;
    }
  };
}

/** A card the DOM metadata collector can read, so the dom block is built at all. */
function liveCard() {
  return makeNode('article', {}, [
    makeNode('h3', { role: 'heading' }, [makeNode('a', { role: 'link' }, [], 'Sponsored Brand')]),
    makeNode('div', { dir: 'auto' }, [], 'Buy the thing')
  ]);
}

const DOM_HIT = {
  isSponsored: true,
  signal: 'plain_text',
  reason: 'dom:plain_text',
  text: 'Sponsored',
  debug: { matchedText: 'Sponsored', signal: 'plain_text' }
};

function run(c) {
  /* --- a DOM hit is reported, and does not steal the verdict's credit --- */
  {
    const detector = stubDetector(DOM_HIT);
    const win = buildWorld(detector);
    const r = win.FBDietProbe.buildProbeReport(props, regularClassify, [], liveCard()).report;

    c.ok('dom.extracted.sponsored is present on a hit', Boolean(r.dom.extracted.sponsored));
    c.equals('the reported signal is the hit signal', r.dom.extracted.sponsored.signal, 'plain_text');
    c.equals('the reported reason is the DOM reason', r.dom.extracted.sponsored.reason, 'dom:plain_text');
    c.equals('the reported evidence keeps what the label matched', r.dom.extracted.sponsored.debug.matchedText, 'Sponsored');
    // The two engines are mutually exclusive, so a label the probe found cannot be what decided a
    // verdict the store decided. It is the fact worth reporting, and the report says so.
    c.equals('the verdict keeps the credit for the engine that decided it', r.verdict.detectionSource, 'relay');
    c.equals('the live scan ran once', detector.calls.length, 1);
  }

  /* --- the breaker field is gone, so a clean run reports nothing about it --- */
  {
    const detector = stubDetector(null);
    const win = buildWorld(detector);
    const r = win.FBDietProbe.buildProbeReport(props, regularClassify, [], liveCard()).report;

    c.equals('no hit means no sponsored block', r.dom.extracted.sponsored, undefined);
    c.equals('the report carries no breaker state', r.dom.extracted.sponsorshipBreaker, undefined);
    c.equals('a clean run is credited to the store', r.verdict.detectionSource, 'relay');
  }

  /* --- REGRESSION: a DOM-driven ad must not be attributed to dom_scanner --- */
  {
    // The old attribution chain tested `classifyResult.reason.startsWith('dom:')` and returned
    // 'dom_scanner' from it. When the DOM overrules the store, effectiveClassifyResult.reason IS a
    // 'dom:*' reason, so every DOM-driven ad was reported as 'dom_scanner' and the sponsorship
    // source could never appear in the one case it exists to describe.
    const domDriven = Object.assign({}, DOM_HIT);
    const effective = {
      category: 'sponsored',
      unitId: 'unit_1',
      reason: 'dom:plain_text',
      source: 'dom_sponsorship',
      evidence: { id: 'unit_1' },
      domEvidence: domDriven
    };
    const win = buildWorld(null);
    const r = win.FBDietProbe.buildProbeReport(props, effective, [], liveCard()).report;
    c.equals('a DOM-decided ad is dom_sponsorship, not dom_scanner', r.verdict.detectionSource, 'dom_sponsorship');
    c.equals('the dom reason survives in the report', r.dom.extracted.sponsored.reason, 'dom:plain_text');
  }

  /* --- sponsored evidence does not depend on DOM metadata existing --- */
  {
    // No container at all: there is no domLive, no actor, no urls. The render-time evidence must
    // still be reported, because "the DOM overruled the store" is a verdict fact, not a metadata
    // fact.
    const domDriven = Object.assign({}, DOM_HIT, {
      signal: 'aria_label',
      reason: 'dom:aria_label',
      debug: { matchedText: 'Sponsored content', signal: 'aria_label' }
    });
    const withEvidence = Object.assign({}, regularClassify, { source: 'dom_sponsorship', domEvidence: domDriven });
    const detector = stubDetector(DOM_HIT);
    const win = buildWorld(detector);
    const r = win.FBDietProbe.buildProbeReport(props, withEvidence, [], null).report;
    c.equals('with no container the detector is not re-scanned', detector.calls.length, 0);
    c.equals('with no DOM metadata the dom block is still present', Boolean(r.dom), true);
    c.equals('with no DOM metadata the evidence is still reported', r.dom.extracted.sponsored.signal, 'aria_label');
    c.equals('and it is still what decided the verdict', r.verdict.detectionSource, 'dom_sponsorship');
  }

  /* --- the render-time verdict is preferred over a second live scan --- */
  {
    const renderVerdict = Object.assign({}, DOM_HIT, {
      signal: 'own_text',
      reason: 'dom:own_text',
      debug: { matchedText: 'Sponsored', signal: 'own_text' }
    });
    const detector = stubDetector(DOM_HIT);
    const win = buildWorld(detector);
    const withEvidence = Object.assign({}, regularClassify, { source: 'dom_sponsorship', domEvidence: renderVerdict });
    const r = win.FBDietProbe.buildProbeReport(props, withEvidence, [], liveCard()).report;

    c.equals('a verdict that carries evidence is not re-scanned', detector.calls.length, 0);
    c.equals('the render-time evidence is the one reported', r.dom.extracted.sponsored.signal, 'own_text');
  }

  /* --- a store ad confirmed by the DOM stays credited to the store --- */
  {
    const detector = stubDetector(DOM_HIT);
    const win = buildWorld(detector);
    const r = win.FBDietProbe.buildProbeReport(props, adClassify, [], liveCard()).report;
    c.equals('agreement with the store is not credited to the DOM', r.verdict.detectionSource, 'relay');
    c.equals('the confirmation is still reported as evidence', r.dom.extracted.sponsored.signal, 'plain_text');
  }

  /* --- a suggested DOM hit outranks the sponsorship field --- */
  {
    // The suggested detector hit live inside the probe (no render-time evidence was carried),
    // which is exactly what probe_fallback means: the diagnostic found it, not the scanner.
    const detector = stubDetector(DOM_HIT);
    const win = buildWorld(detector);
    win.FBDietDOMSuggested = {
      detect: () => ({ isSuggested: true, signal: 'Follow', reason: 'dom:follow_button', debug: {} })
    };
    const r = win.FBDietProbe.buildProbeReport(props, regularClassify, [], liveCard()).report;
    c.equals('a live suggested hit is credited to the probe fallback', r.verdict.detectionSource, 'probe_fallback');
    c.equals('the suggested hit becomes the effective verdict', r.verdict.category, 'suggested');
    c.equals('the sponsorship evidence is still reported alongside it', r.dom.extracted.sponsored.signal, 'plain_text');
  }

  /* --- a broken detector cannot break the report --- */
  {
    const broken = { detect() { throw new Error('boom'); } };
    const win = buildWorld(broken);
    let report = null;
    try {
      report = win.FBDietProbe.buildProbeReport(props, regularClassify, [], liveCard()).report;
    } catch (e) {
      report = null;
    }
    c.ok('a throwing detector does not throw out of the report', Boolean(report));
    c.equals('a throwing detector contributes no evidence', report.dom.extracted.sponsored, undefined);
  }

  /* --- no detector module at all (module load order) --- */
  {
    const win = buildWorld(null);
    const r = win.FBDietProbe.buildProbeReport(props, regularClassify, [], liveCard()).report;
    c.equals('a missing detector contributes no sponsored block', r.dom.extracted.sponsored, undefined);
    c.equals('a missing detector does not break attribution', r.verdict.detectionSource, 'relay');
  }

  /* --- dom mode: a live hit must not claim a verdict the engine never made --- */
  //
  // The first real-machine report in `dom` mode carried `reason: "dom:no-verdict"` beside
  // `detectionSource: "dom_sponsorship"`. The reason says no engine decided anything, the source says
  // the sponsorship rules did. Attribution was re-derived from a `dom:` reason prefix, and every
  // reason in that pipeline begins with `dom:`, the decline included — so the probe's own live scan
  // was credited as the verdict's origin. The render path now names what decided, and the name is
  // the whole of the answer. The scan still belongs in the report — an ad whose label appeared after
  // the fold's scan window closed is precisely what a diagnostic mode is for — it just cannot
  // impersonate a decision.
  {
    const detector = stubDetector(DOM_HIT);
    const win = buildWorld(detector);
    win.FBDietBridge.setSettings({ dietMode: 'dom', enabled: true });
    const r = win.FBDietProbe.buildProbeReport(props, noVerdict, [], liveCard()).report;
    c.equals('a live hit in dom mode is not credited as the source', r.verdict.detectionSource, 'dom');
    c.equals('…while the reason still says nothing decided', r.verdict.reason, 'dom:no-verdict');
    c.ok('…and the hit itself stays visible as evidence', Boolean(r.dom.extracted.sponsored));
    c.equals('…with the signal it matched', r.dom.extracted.sponsored.signal, 'plain_text');
    // The display substitution the verdict carries, stated rather than left for the reader to infer.
    c.equals('the report says what the mounted UI shows', r.verdict.category, 'regular');
    c.ok('…and that it is not what was decided', /displayed as regular/.test(r.verdict.displayNote || ''));

    // Render-time DOM evidence is not automatically sponsorship's: the surface rules carry their own
    // flag, and crediting a live sponsorship scan over them would name the wrong capability.
    const surfaceDecided = {
      unitId: 'unit_1',
      category: 'reels',
      reason: 'dom:reels_tray_label',
      source: 'dom_surface',
      moduleName: FEED_MODULE,
      domEvidence: { isSurface: true, category: 'reels', reason: 'dom:reels_tray_label', text: 'Reel' }
    };
    const surfaceWorld = buildWorld(stubDetector(DOM_HIT));
    surfaceWorld.FBDietBridge.setSettings({ dietMode: 'dom', enabled: true });
    const s = surfaceWorld.FBDietProbe.buildProbeReport(props, surfaceDecided, [], liveCard()).report;
    c.equals('a surface-decided unit keeps the surface credit', s.verdict.detectionSource, 'dom_surface');

    // A `relay` verdict beside a live DOM hit is a state the product can no longer reach — `relay`
    // mounts no container, so there is nothing for the probe to scan. The report still has to answer
    // honestly if one is ever constructed: the credit belongs to the engine that decided.
    const daily = buildWorld(stubDetector(DOM_HIT));
    daily.FBDietBridge.setSettings({ dietMode: 'relay', enabled: true });
    const d = daily.FBDietProbe.buildProbeReport(props, regularClassify, [], liveCard()).report;
    c.equals('a live DOM ad beside a store verdict does not take the credit', d.verdict.detectionSource, 'relay');
  }

  /* --- a props-decided ad in dom mode is credited to the props, not to the DOM --- */
  //
  // `dom` mode skips the store, not the props (decision #40 read literally): an ad whose only
  // evidence is a plain prop is decided from it. Crediting that verdict 'dom' would claim a scanner
  // reasoned its way to 'sponsored' when no scan ran — the same read-provenance-off-a-shape error
  // the surrounding cases exist to prevent.
  {
    const propsDecided = {
      unitId: 'unit_1',
      category: 'sponsored',
      reason: 'props:th_dat_spo',
      source: 'props',
      moduleName: FEED_MODULE,
      propsEvidence: { category: 'sponsored', reason: 'th_dat_spo' }
    };
    const win = buildWorld(null);
    win.FBDietBridge.setSettings({ dietMode: 'dom', enabled: true });
    const r = win.FBDietProbe.buildProbeReport(props, propsDecided, [], liveCard()).report;
    c.equals('a props-decided ad is credited to the props', r.verdict.detectionSource, 'props');
    c.equals('…and the reason names the field it read', r.verdict.reason, 'props:th_dat_spo');
    c.equals('…while the verdict is an ad', r.verdict.category, 'sponsored');

    // A rendered label is the stronger claim when both fire, so the DOM keeps the last word.
    const bothWorld = buildWorld(stubDetector(DOM_HIT));
    bothWorld.FBDietBridge.setSettings({ dietMode: 'dom', enabled: true });
    const both = bothWorld.FBDietProbe.buildProbeReport(
      props,
      Object.assign({}, propsDecided, { source: 'dom_sponsorship', domEvidence: DOM_HIT }),
      [],
      liveCard()
    ).report;
    c.equals('a rendered label outranks the props for attribution', both.verdict.detectionSource, 'dom_sponsorship');

    // The relay pipeline's own verdict still comes from the store, and nothing about it changed.
    const dailyWorld = buildWorld(stubDetector(DOM_HIT));    dailyWorld.FBDietBridge.setSettings({ dietMode: 'relay', enabled: true });
    const daily = dailyWorld.FBDietProbe.buildProbeReport(props, adClassify, [], liveCard()).report;
    c.equals('the relay pipeline still credits the store', daily.verdict.detectionSource, 'relay');
  }

  /* --- the real module, end to end with the report --- */
  {
    const win = createWindow();
    win.FB_DIET_DEFAULTS = loadDefaults();
    win.document = { documentElement: { lang: 'zh-TW' } };
    loadInject(win, 'relay.js');
    loadInject(win, 'bridge.js');
loadInject(win, 'dom-metadata.js');
  loadInject(win, 'ui.js');
    loadInject(win, 'dom-sponsored.js');
    loadInject(win, 'probe.js');

    // The plain-text path needs no childNodes: a leaf span is read through textContent alone.
    const card = makeNode('div', {}, [makeNode('span', {}, [], 'Sponsored')]);
    const decided = {
      unitId: 'unit_1',
      category: 'sponsored',
      reason: 'dom:plain_text',
      source: 'dom_sponsorship',
      domEvidence: DOM_HIT
    };
    const r = win.FBDietProbe.buildProbeReport(props, decided, [], card).report;
    c.equals('the real detector is reachable from the report', r.dom.extracted.sponsored && r.dom.extracted.sponsored.signal, 'plain_text');
    c.equals('the real detector is credited as the source', r.verdict.detectionSource, 'dom_sponsorship');
    c.equals('a second report of the same card is identical', win.FBDietProbe.buildProbeReport(props, decided, [], card).report.verdict.detectionSource, 'dom_sponsorship');
  }

  /* --- the detectors block: why each detector answered as it did --- */
  //
  // The gap this closes: a detector that returned null and a detector that was never asked looked
  // identical in a field report, so a real page could only ever be summarised as "regular". The
  // block is reported whether or not the detector fired — a miss is the case worth seeing.
  {
    // A stub with no `explain`, i.e. a detector module that predates it or failed to load. The
    // report must still build, and must SAY the detector is unavailable rather than staying silent:
    // on a real page a half-present block reads as "this detector ran and declined", which is the
    // opposite of what an unreloaded extension means. The suggested half is missing here too,
    // because this world loads no detector at all.
    const legacy = buildWorld(stubDetector(null));
    const noExplain = legacy.FBDietProbe.buildProbeReport(props, regularClassify, [], liveCard()).report;
    c.equals('a detector with no explain does not break the report', noExplain.dom.extracted.sponsored && noExplain.dom.extracted.sponsored.signal, undefined);
    c.equals('a stub with no explain is named, not silently dropped', noExplain.dom.extracted.detectors.sponsored.outcome, 'module_unavailable');
    c.equals('…naming which module is missing', noExplain.dom.extracted.detectors.sponsored.outcomeReason, 'sponsored_module_missing');
    c.equals('…and the same for the detector this world does not load at all', noExplain.dom.extracted.detectors.suggested.outcomeReason, 'suggested_module_missing');

    // An `explain` that throws must not propagate: a diagnostic that can break the report is worse
    // than no diagnostic, since the whole report is then lost. But it must be reported too.
    const hostile = buildWorld({
      detect: () => null,
      explain() { throw new Error('boom'); }
    });
    const survived = hostile.FBDietProbe.buildProbeReport(props, regularClassify, [], liveCard()).report;
    c.equals('a throwing explain is swallowed, not propagated', survived.dom.extracted.detectors.sponsored.outcome, 'scan_error');
    c.equals('…and the throw is carried into the report', survived.dom.extracted.detectors.sponsored.outcomeReason, 'boom');
    c.equals('…and the report still carries a verdict', survived.verdict.category, 'regular');

    // The real module, end to end: the block arrives populated on both a hit and a miss.
    const real = createWindow();
    real.FB_DIET_DEFAULTS = loadDefaults();
    real.document = { documentElement: { lang: 'zh-TW' } };
    loadInject(real, 'relay.js');
    loadInject(real, 'bridge.js');
    loadInject(real, 'ui.js');
    loadInject(real, 'dom-sponsored.js');
    loadInject(real, 'probe.js');

    const hit = real.FBDietProbe.buildProbeReport(props, regularClassify, [], makeNode('div', {}, [makeNode('span', {}, [], 'Sponsored')])).report;
    c.equals('a real hit explains itself', hit.dom.extracted.detectors.sponsored.outcome, 'detected');
    c.equals('…naming what it matched', hit.dom.extracted.detectors.sponsored.matchedText, 'Sponsored');

    // The miss case, which is the whole point. Before this, a report could not distinguish "the
    // DOM carries no sponsored label here" from "the label is there and the vocabulary is stale".
    const miss = real.FBDietProbe.buildProbeReport(props, regularClassify, [], makeNode('div', {}, [makeNode('span', {}, [], 'Sponsorship pending review')])).report;
    c.equals('a real miss explains itself', miss.dom.extracted.detectors.sponsored.outcome, 'no_label_matched');
    c.equals('…and shows the text it actually read', miss.dom.extracted.detectors.sponsored.sampleTexts.indexOf('Sponsorship pending review') >= 0, true);
  }
}

module.exports = { run };