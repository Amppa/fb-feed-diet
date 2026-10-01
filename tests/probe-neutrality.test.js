'use strict';
/**
 * The probe is a neutral observer, and these tests hold it to that.
 *
 * Found on 2026-09-28 by comparing two real field reports of the SAME unit: a Reels tray probed
 * under `relay` and again under `dom`. The `verdict` blocks correctly differed — that is what the
 * mode selects — but the data blocks should not have, and they did. In DOM-only mode the report
 * showed `relay: { isReady: true, sourceCount: 6 }` with no reads at all, because `resolveVerdict`
 * skips the data engine (decision #40) and the probe had been receiving the store read as a
 * parameter from that same call. The diagnostic's fidelity was a by-product of the pipeline it was
 * supposed to be observing.
 *
 * So: the probe now performs its own `classify` pass, reported as `relay.dataEngine`, and
 * the verdict is untouched. These tests pin both halves — that the data appears in every mode, and
 * that making it appear changes no decision.
 *
 * The block reports when the probe's own read DIFFERS from what the render path decided. In every
 * mode that runs the data engine the two are the same function on the same payload, so it was a
 * verbatim copy on every unit of the page; DOM-only mode has no render-path result at all, so the
 * block is always there, which is the mode whose whole purpose is the comparison.
 */
const { createWindow, loadInject, loadDefaults, makeNode } = require('./harness');
const H = { makeNode };

const FEED_MODULE = 'CometFeedUnitErrorBoundary.react';

/** A store that reports a Reels tray: the `ShowcaseFeedUnit` typename is the whole answer. */
function reelWorld() {
  const win = createWindow();
  win.FB_DIET_DEFAULTS = loadDefaults();
  win.document = { documentElement: { lang: 'zh-TW' } };
  loadInject(win, 'relay.js');
  loadInject(win, 'relay-classify.js');
  loadInject(win, 'bridge.js');
  loadInject(win, 'dom-metadata.js');
  loadInject(win, 'ui.js');
  loadInject(win, 'dom-surface.js');
  loadInject(win, 'dom-suggested.js');
  loadInject(win, 'probe.js');
  win.FBDietRelayClassify.setRelayReader(() => null);
  return win;
}

const reelProps = {
  moduleName: FEED_MODULE,
  payload: { feedUnit: { id: 'reel-unit-1', __typename: 'ShowcaseFeedUnit' } }
};

function run(c) {
  /* --- the store read appears with no classify result handed in, which is the DOM-only shape --- */
  {
    // `null, null` is exactly what `fold.js` passes under `skipDataEngine`: no store result, no
    // read log. Before this change the report showed a ready store and no reads.
    const win = reelWorld();
    const r = win.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;

    c.equals('with no classify result, the report still reads the store', r.relay.dataEngine.category, 'reels');
    c.equals('…and names why', r.relay.dataEngine.reason, 'unitTypename:ShowcaseFeedUnit');
    // The typename itself is the block's own `unitTypename` header; evidence does not reprint it.
    c.equals('…carrying the typename evidence', r.relay.dataEngine.unitTypename, 'ShowcaseFeedUnit');
    // initialClassify answers a different question — what the render path decided — and in this
    // shape it is legitimately absent. It must NOT be back-filled from the probe's own read.
    c.equals('initialClassify stays absent, it is not the probe read', r.relay.initialClassify, undefined);
  }

  /* --- a unit that genuinely reads the store shows its reads in DOM-only mode --- */
  {
    const win = reelWorld();
    // A sponsored ad is the interesting case: the store read is what finds it, and DOM-only mode
    // never consults that read. The report still has to show that the store had it.
    // The path is a Relay lookup, caret-prefixed like every other SPONSORED_PATH read in relay-classify.js.
    win.FBDietRelayClassify.setRelayReader((ids, path) => (path === '^sponsored_data.ad_id' ? 'ad-42' : null));
    const adProps = { moduleName: FEED_MODULE, payload: { feedUnit: { id: 'ad-unit-1', __typename: 'FeedUnitRoot' } } };
    const r = win.FBDietProbe.buildProbeReport(adProps, null, null, null).report;

    c.equals('the probe finds the ad in the store', r.relay.dataEngine.category, 'sponsored');
    c.equals('…with the ad id as evidence', r.relay.dataEngine.evidence.adId, 'ad-42');
    c.ok('…and the read that found it is in the log', r.relay.reads.some((x) => x.value === 'ad-42'));
    // The decisive assertion: the verdict did not move. The probe's read is diagnostic.
    c.equals('the verdict is untouched by the probe own read', r.verdict.category, 'regular');
    // `dom:no-verdict` is fold.js's own marker for a render path that consulted nothing, so a
    // report built with no classify result has no reason to carry it. What matters here is simply
    // that the probe's store read did not become the verdict.
    c.equals('…and the probe read did not become the reason', r.relay.initialClassify, undefined);
  }

  /* --- neutrality: two reports of one unit differ only where the mode differs --- */
  {
    const win = reelWorld();
    const r = win.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;
    const relaySide = win.FBDietProbe.buildProbeReport(
      reelProps,
      { unitId: 'reel-unit-1', category: 'reels', reason: 'unitTypename:ShowcaseFeedUnit', evidence: { ownTypename: 'ShowcaseFeedUnit' } },
      [],
      null
    ).report;

    c.equals('both modes report the same store category', r.relay.dataEngine.category, relaySide.relay.dataEngine.category);
    c.equals('both modes report the same reason', r.relay.dataEngine.reason, relaySide.relay.dataEngine.reason);
    c.equals('both modes report the same typename', r.relay.dataEngine.unitTypename, relaySide.relay.dataEngine.unitTypename);
    // …while the verdicts differ, which is the mode doing its job.
    c.equals('the DOM-only verdict stays undecided', r.verdict.category, 'regular');
    c.equals('the relay-mode verdict is reels', relaySide.verdict.category, 'reels');
  }

  /* --- the unit id is printed once per report, not once per evidence block --- */
  {
    // Found on a real report: `dataEngine.evidence.id` reprinted the same ~400-character Relay key
    // that `unit.unitId` already carries. `initialClassify` had always stripped it, so the rule
    // existed — inline, for that one block — and a second block added later quietly bypassed it.
    const win = reelWorld();
    const r = win.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;
    const UNIT = reelProps.payload.feedUnit.id;

    c.equals('dataEngine evidence does not reprint the unit id', r.relay.dataEngine.evidence.id, undefined);
    // `ownTypename` is not reprinted either, for the same reason and by the same rule: it equals the
    // block's own `unitTypename`, so it is a second copy of one string rather than new evidence. The
    // typename is still in the report — as the header of the block that decided on it.
    c.equals('…and does not reprint the typename as evidence', r.relay.dataEngine.evidence.ownTypename, undefined);
    c.equals('…the typename is still reported, as the block header', r.relay.dataEngine.unitTypename, 'ShowcaseFeedUnit');
    c.equals('…and the id count that qualifies it', r.relay.dataEngine.evidence.idCount, 1);

    // The removal is conditional on the typename MATCHING, which is the part that matters: pitfall 3
    // is a unit whose own typename differs from the nested attachment it carries, and there the two
    // are different facts rather than duplicates.
    const nested = win.FBDietProbe.buildProbeReport(
      reelProps,
      { unitId: UNIT, unitTypename: 'Story', category: 'regular', reason: 'no-match', evidence: { ownTypename: 'Story', nestedTypename: 'ShowcaseFeedUnit', id: UNIT, idCount: 1 } },
      [],
      null
    ).report;
    c.equals('a differing typename survives as evidence', nested.relay.initialClassify.evidence.nestedTypename, 'ShowcaseFeedUnit');
    c.equals('…while the matching one is still dropped', nested.relay.initialClassify.evidence.ownTypename, undefined);
    c.equals('…and the reported typename is the unit own', nested.relay.initialClassify.unitTypename, 'Story');

    // The same rule must hold when the render path DID classify, or the two blocks would disagree
    // about whether the id belongs in evidence.
    const both = win.FBDietProbe.buildProbeReport(
      reelProps,
      { unitId: UNIT, category: 'reels', reason: 'unitTypename:ShowcaseFeedUnit', evidence: { ownTypename: 'ShowcaseFeedUnit', id: UNIT, idCount: 1 } },
      [],
      null
    ).report;
    c.equals('initialClassify evidence drops the id too', both.relay.initialClassify.evidence.id, undefined);
    c.equals('…and the dataEngine block agrees', both.relay.dataEngine.evidence.id, undefined);
  }

  /* --- provenance: DOM-only mode must not credit the store --- */
  {
    // Found on a real report: a DOM-only unit showed `detectionSource: "relay"` (v5 and earlier:
    // `reason: "dom:no-verdict"`. `fold.js` synthesises a classify-shaped result in that mode, so
    // "a classify result was passed in" was true while "the store decided anything" was false —
    // the store is never consulted there. Claiming a store verdict that does not exist is the same
    // mistake as crediting `dom_scanner` off a `dom:` string prefix: reading provenance off a
    // shape instead of off what actually ran.
    const win = reelWorld();
    win.FBDietBridge.setSettings({ dietMode: 'dom', enabled: true });
    // Exactly what fold.js passes under skipDataEngine: a DOM-decided unit with no store verdict.
    const domDecided = { category: null, reason: 'dom:no-verdict', source: 'dom', unitId: 'reel-unit-1', moduleName: FEED_MODULE, display: { category: 'regular', substituted: true } };
    const r = win.FBDietProbe.buildProbeReport(reelProps, domDecided, null, null).report;

    c.equals('DOM-only mode credits the DOM engine, not the store', r.verdict.detectionSource, 'dom');
    // …and the reason still says why, so the source is not the only thing carrying the story.
    c.equals('…while the reason still names the DOM-only state', r.verdict.reason, 'dom:no-verdict');

    // The two must not read the same. 'dom' means an engine ran and answered "nothing to fold";
    // an absent source means no engine ran at all (a module-declared category). Conflating them
    // would make the popup's Source row blank for one and populated for the other with no way
    // to tell which situation you are looking at.
    const structural = win.FBDietProbe.buildProbeReport(
      Object.assign({}, reelProps, { entryCategory: 'stories' }), null, null, null
    ).report;
    c.equals('a module-declared category still reports no source', structural.verdict.detectionSource, undefined);

    // The same shape in a mode that DOES consult the store is credited to it — otherwise this fix
    // would have thrown out a correct attribution along with the wrong one.
    win.FBDietBridge.setSettings({ dietMode: 'relay', enabled: true });
    const storeDecided = { category: 'reels', reason: 'unitTypename:ShowcaseFeedUnit', source: 'relay', unitId: 'reel-unit-1', moduleName: FEED_MODULE };
    const relaySide = win.FBDietProbe.buildProbeReport(reelProps, storeDecided, [], null).report;
    c.equals('a store-decided verdict is still credited to the store', relaySide.verdict.detectionSource, 'relay');

    // A DOM verdict the report CAN attribute outranks the skip: the DOM really did decide this one.
    win.FBDietBridge.setSettings({ dietMode: 'dom', enabled: true });
    const domHit = {
      category: 'suggested',
      reason: 'dom:follow_button',
      source: 'dom_scanner',
      unitId: 'reel-unit-1',
      moduleName: FEED_MODULE,
      signal: 'Follow',
      domEvidence: { isSuggested: true, reason: 'dom:follow_button', signal: 'Follow' }
    };
    const attributed = win.FBDietProbe.buildProbeReport(reelProps, domHit, null, null).report;
    c.equals('a DOM verdict that is attributable is still credited to the DOM', attributed.verdict.detectionSource, 'dom_scanner');
  }

  /* --- a surface-decided verdict is credited as its own capability --- */
  {
    const win = reelWorld();
    win.FBDietBridge.setSettings({ dietMode: 'dom', enabled: true });
    // Exactly the shape fold.js synthesises when the surface rules decide a Reels tray.
    const surfaceHit = {
      category: 'reels',
      reason: 'dom:reels_tray_label',
      source: 'dom_surface',
      unitId: 'reel-unit-1',
      moduleName: FEED_MODULE,
      domEvidence: { isSurface: true, category: 'reels', reason: 'dom:reels_tray_label', text: 'Reel' }
    };
    const r = win.FBDietProbe.buildProbeReport(reelProps, surfaceHit, null, null).report;
    c.equals('the surface rules are credited by name, not as a generic scanner', r.verdict.detectionSource, 'dom_surface');
    c.equals('…and the reason survives the attribution', r.verdict.reason, 'dom:reels_tray_label');
    c.ok('the detector verdict is reported where the DOM read it', Boolean(r.dom && r.dom.extracted && r.dom.extracted.surface));
    c.equals('…naming the category it reached', r.dom.extracted.surface.category, 'reels');
    // The explanation block is the half a field report actually reads: it is present whether the
    // rules fired or declined, so "the DOM never looked" and "the DOM looked and declined" stay
    // two different facts rather than one absent key.
    c.ok('the surface detector explains itself in the detectors block', Boolean(r.dom.extracted.detectors && r.dom.extracted.detectors.surface));
    c.equals('…naming why it could not read a unit with no container', r.dom.extracted.detectors.surface.outcomeReason, 'no_container');

    // The two claims must stay tellable apart: a sponsorship label, a button heuristic and a tray
    // structure are three different reasons to fold, and one shared source string would make a rule
    // that is too loose indistinguishable from one that is merely unused.
    const sponsoredEvidence = Object.assign({}, surfaceHit, {
      category: 'sponsored',
      reason: 'dom:plain_text',
      source: 'dom_sponsorship',
      domEvidence: { isSponsored: true, reason: 'dom:plain_text', signal: 'plain_text' }
    });
    c.equals('a sponsorship verdict is still credited as sponsorship', win.FBDietProbe.buildProbeReport(reelProps, sponsoredEvidence, null, null).report.verdict.detectionSource, 'dom_sponsorship');
    c.equals('…and leaves the surface block out rather than emptying it', win.FBDietProbe.buildProbeReport(reelProps, sponsoredEvidence, null, null).report.dom.extracted.surface, undefined);

    // A suggested-shaped domEvidence must not be pasted under `extracted.suggested` any more than a
    // surface one: the block is seeded by the flag the producing detector sets.
    const suggested = { category: 'suggested', reason: 'dom:follow_button', unitId: 'reel-unit-1', domEvidence: { isSuggested: true, reason: 'dom:follow_button', signal: 'Follow' } };
    c.equals('a real suggested hit is still reported', (win.FBDietProbe.buildProbeReport(reelProps, suggested, null, null).report.dom.extracted.suggested || {}).isSuggested, true);
    const sponsoredOnly = { category: 'sponsored', reason: 'dom:plain_text', unitId: 'reel-unit-1', domEvidence: { isSponsored: true, reason: 'dom:plain_text' } };
    c.equals('…while a sponsorship hit no longer appears as a suggestion', win.FBDietProbe.buildProbeReport(reelProps, sponsoredOnly, null, null).report.dom.extracted.suggested, undefined);
  }

  /* --- the module inventory names what is missing, so a stale install is a fact not a mystery --- */
  {
    // The list used to be the twelve modules that loaded, which is the same twelve names on every
    // unit of a page load and says something only when nothing is wrong. It is now the modules that
    // did NOT load, and is absent when nothing is missing — the absence being the signal, and the
    // name in it being the file a reader has to go and look at.
    const win = reelWorld();
    const r = win.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;
    // `reelWorld` deliberately does not load `dom-sponsored.js`, which is the whole shape of the
    // original failure: committed, valid, listed in the manifest, and still unavailable on the page.
    c.ok('env names the module that never loaded', r.env.modules.indexOf('FBDietDOMSponsored') >= 0, JSON.stringify(r.env.modules));
    c.equals('…and does not name one that did', r.env.modules.indexOf('FBDietRelayClassify'), -1);
    // The surface detector the reels verdict needs is present here, so it is not named.
    c.equals('a loaded surface detector is not reported missing', r.env.modules.indexOf('FBDietDOMSurface'), -1);

    // Load every remaining module and the block disappears entirely rather than becoming an empty
    // list. `reelWorld` is deliberately a partial world, so "missing" is the honest answer until
    // the rest of the page load is simulated.
    for (const m of ['comet.js', 'relay-metadata.js', 'fold.js']) {
      if (!win[m.replace('.js', '')]) loadInject(win, m);
    }
    win.FBDietDOMSponsored = { detect() { return null; }, explain() { return { scanned: false, outcome: 'not_scanned' }; } };
    const withIt = win.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;
    c.equals('a complete page load reports no missing modules at all', withIt.env.modules, undefined);

    // Mode-independent, like every other data block: the list describes the page, not the mode.
    // Same world, two modes — comparing two different worlds would compare their load order too.
    win.FBDietBridge.setSettings({ dietMode: 'relay', enabled: true });
    const relaySide = win.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;
    c.equals('the module list does not depend on the mode', JSON.stringify(withIt.env.modules), JSON.stringify(relaySide.env.modules));
  }

  /* --- the rest of the page-level blocks report only when they are the answer --- */
  {
    // `reelWorld` never installs the capture (no Comet module to register the hook with), so that
    // IS a broken capture and the counters are reported. The healthy side is stubbed onto the relay
    // module: this is the probe's gating being tested, not relay.js's install path.
    const win = reelWorld();
    const broken = win.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;
    c.equals('a capture that never applied is reported in full', broken.relay.capture.applied, false);

    win.FBDietRelay.isReady = () => true;
    win.FBDietRelay.getSourceCount = () => 6;
    win.FBDietRelay.getLastError = () => null;
    win.FBDietRelay.getCaptureStats = () => ({
      hooked: 1, noExports: 0, noConstructor: 0, alreadyWrapped: 0, wrapped: 1, applied: true,
      constructs: 0, rejectedNoGet: 0, protoHooked: 1, alreadyPatched: 0, protoHits: 591,
      shapeMismatch: 0, lastShapeMismatch: null
    });
    const healthy = win.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;
    c.equals('the store is ready either way', healthy.relay.isReady, true);
    // Thirteen resolved counters on a store with six sources is the same thirteen names on every
    // unit of the page, and the answer to none of them.
    c.equals('a healthy capture is not reported', healthy.relay.capture, undefined);

    // `shapeMismatch` is the counter that names a Relay path to fix, so it alone brings the block
    // back even though every other counter is resolved.
    win.FBDietRelay.getCaptureStats = () => ({
      hooked: 1, wrapped: 1, applied: true, protoHooked: 1, protoHits: 591,
      shapeMismatch: 2, lastShapeMismatch: 'RelayRecordSourceProxy.get: sponsored_data'
    });
    const mismatched = win.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;
    c.equals('a shape mismatch brings the counters back', mismatched.relay.capture.shapeMismatch, 2);
  }

  /* --- drift is the only question moduleHealth.unseen answers --- */
  {
    const win = reelWorld();
    loadInject(win, 'comet.js');
    // The drift counters are per registered module, and registrations happen at module load — so the
    // registrations are replayed here rather than at boot, which is what puts names in `unseen`.
    for (const name of ['CometFeedUnitErrorBoundary.react', 'StoriesTray.react']) {
      win.FBDietComet.registerComponent(name, { component: function Cmp() {}, definerPath: '[6].default' });
    }
    const healthy = win.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;
    c.equals('module health is reported', healthy.comet.moduleHealth !== undefined, true);
    c.equals('…with the drift verdict', healthy.comet.moduleHealth.suspected, false);
    // Without the verdict the unseen names were material the verdict had already dismissed.
    c.equals('…and no unseen list while drift is not suspected', healthy.comet.moduleHealth.unseen, undefined);

    // `checkModuleDrift` needs `FBDietFold`; a stub returning a suspected verdict is the whole
    // condition `unseen` is conditional on.
    win.FBDietFold = { checkModuleDrift: () => ({ suspected: true }) };
    const drifted = win.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;
    c.equals('a suspected drift is reported', drifted.comet.moduleHealth.suspected, true);
    c.ok('…and names the modules it did not see', Array.isArray(drifted.comet.moduleHealth.unseen), JSON.stringify(drifted.comet.moduleHealth));
    c.ok('…including the ones a reader has to go and look at', drifted.comet.moduleHealth.unseen.length === 2, JSON.stringify(drifted.comet.moduleHealth.unseen));
  }

  /* --- dataEngine appears exactly when it differs from what the render path decided --- */
  {
    const win = reelWorld();
    // The probe's own read of this payload, spelled out so the two blocks are made identical: same
    // category, same reason, same typename, same evidence. In every mode that runs the data engine
    // these are the same function on the same payload, so the block was a verbatim copy.
    const asTheStoreReadsIt = {
      category: 'reels',
      unitTypename: 'ShowcaseFeedUnit',
      reason: 'unitTypename:ShowcaseFeedUnit',
      evidence: { source: 'none', idCount: 1 }
    };
    const agreed = win.FBDietProbe.buildProbeReport(
      reelProps,
      Object.assign({ unitId: 'reel-unit-1' }, asTheStoreReadsIt),
      [],
      null
    ).report;
    c.equals('a dataEngine that agrees with the render path is not reprinted', agreed.relay.dataEngine, undefined);
    c.equals('…and the render path verdict is still there', agreed.relay.initialClassify.category, 'reels');

    // A divergence is the case the block exists for, so it must survive.
    const diverged = win.FBDietProbe.buildProbeReport(
      reelProps,
      { unitId: 'reel-unit-1', category: 'regular', reason: 'no-match', evidence: { source: 'props' } },
      [],
      null
    ).report;
    c.equals('a dataEngine that disagrees with the render path is reported', diverged.relay.dataEngine.category, 'reels');
    c.equals('…beside the render path it disagrees with', diverged.relay.initialClassify.category, 'regular');

    // …and the third case is the one an absent key cannot carry. Suppressing the block on agreement
    // made "the probe's read confirmed the render path" indistinguishable from "the probe could not
    // read at all" — decision #39's failure, reintroduced by the fix for it. Found on the four real
    // reports pasted back from a live page, where no report exercised this path.
    const noClassify = win.FBDietRelayClassify;
    win.FBDietRelayClassify = null;
    const blind = win.FBDietProbe.buildProbeReport(
      reelProps,
      Object.assign({ unitId: 'reel-unit-1' }, asTheStoreReadsIt),
      [],
      null
    ).report;
    win.FBDietRelayClassify = noClassify;
    c.equals('a render-path verdict is still reported', blind.relay.initialClassify.category, 'reels');
    c.equals('a probe that could not read says so', blind.relay.dataEngine.outcomeReason, 'no_store_read');
    c.equals('…and does not pretend it read nothing', blind.relay.dataEngine.scanned, false);
    c.equals('…while a probe that agreed leaves the block out entirely', agreed.relay.dataEngine, undefined);
  }

  /* --- the structural key lists report only when the store named no category --- */
  {
    const win = reelWorld();
    loadInject(win, 'relay-metadata.js');
    const missProps = { moduleName: FEED_MODULE, payload: { feedUnit: { id: 'u-1', __typename: 'FeedUnitRoot' } } };
    const missed = win.FBDietProbe.buildProbeReport(missProps, { unitId: 'u-1', category: 'regular', reason: 'no-match' }, [], null).report;
    // "The field this rule reads is not here" is the question the key lists answer, and it is only
    // asked when no rule matched.
    c.ok('a no-match unit carries the key lists', Array.isArray(missed.relay.payload.feedUnitKeys), JSON.stringify(missed.relay.payload));

    const named = win.FBDietProbe.buildProbeReport(missProps, { unitId: 'u-1', category: 'reels', reason: 'unitTypename:ShowcaseFeedUnit' }, [], null).report;
    c.equals('a unit the store classified carries no payload block at all', named.relay.payload, undefined);

    // The nested-block case the shallow compaction missed: `enrichment` on a post with no group and
    // no attachments is `group` and `media` as all-null sub-objects. Both disappear — the report has
    // no `{}` anywhere, because an empty object reads as "this block exists and is empty".
    if (missed.relay.enrichment) {
      c.equals('an all-null enrichment sub-block is dropped', missed.relay.enrichment.group, undefined);
      c.equals('…both of them', missed.relay.enrichment.media, undefined);
    }
  }

  /* --- a cue list in which nothing fired is not the finding; the outcome already is --- */
  {
    const win = reelWorld();
    const miss = win.FBDietProbe.buildProbeReport(
      { moduleName: FEED_MODULE, payload: { feedUnit: { id: 'u-2', __typename: 'FeedUnitRoot' } } },
      { unitId: 'u-2', category: 'regular', reason: 'no-match' },
      [],
      H.makeNode('article', {}, [H.makeNode('div', {}, [], 'body')])
    ).report;
    const suggested = miss.dom.extracted.detectors.suggested;
    c.equals('the outcome still says no cue matched', suggested.outcome, 'no_cue_matched');
    // Five `{cue, fired: false}` entries were 665 characters saying exactly that.
    c.equals('and the unfired cue list is not reprinted', suggested.cues, undefined);
  }

  /* --- a veto drops the cue list too, and stays tellable apart from a clean scan --- */
  {
    // Real reports from 2026-09-29 show a Reels tray and a group carousel both arriving as
    // `vetoed_as_tray`, i.e. with `cues` already gone. The distinction #44 turns on therefore rests
    // entirely on the outcome NAME, so it is pinned here: the two must never collapse into one.
    const win = reelWorld();
    // The shape of field report #1: an `hscroll-child` tile whose H3 reads "Reel".
    const tile = H.makeNode('div', { 'data-type': 'hscroll-child' }, [H.makeNode('h3', {}, [], 'Reel')]);
    const card = H.makeNode('div', { role: 'article' }, [tile]);
    const r = win.FBDietProbe.buildProbeReport(
      { moduleName: FEED_MODULE, payload: { feedUnit: { id: 'u-3', __typename: 'FeedUnitRoot' } } },
      { unitId: 'u-3', category: 'regular', reason: 'no-match' },
      [],
      card
    ).report;
    const s = r.dom.extracted.detectors.suggested;
    c.equals('a tray is vetoed, not scanned', s.outcome, 'vetoed_as_tray');
    c.equals('…and it names the marker that vetoed it', s.outcomeReason, 'hscroll_child');
    c.equals('…with no cue list, which would assert cues ran', s.cues, undefined);
    // The clean-scan outcome stays a different name. These two collapsing into one is the exact
    // failure decision #44 exists to prevent.
    c.ok('…and a clean scan is still a different outcome', s.outcome !== 'no_cue_matched');
  }

  /* --- resilience: a missing or hostile classifier --- */
  {
    const gone = reelWorld();
    gone.FBDietRelayClassify = null;
    const noClassify = gone.FBDietProbe.buildProbeReport(reelProps, null, null, null).report;
    c.equals('no classifier omits the block rather than failing', noClassify.relay.dataEngine, undefined);
    c.equals('…and the report still has a verdict', noClassify.verdict.category, 'regular');

    const hostile = reelWorld();
    hostile.FBDietRelayClassify = {
      classify() { throw new Error('hostile'); },
      getLastRelayReads: () => null,
      // bridge.js asks the classifier whether a category is foldable, so a partial stub has to
      // satisfy that too. Leaving it off throws inside `isEnabled` before the report is ever built,
      // which would test the stub's shape rather than the probe's resilience.
      isCategoryEnabled: () => false,
      getCategoryFoldMode: () => 'off'
    };
    const threw = hostile.FBDietProbe.buildProbeReport(reelProps, null, null, makeNode('div', {}, [], 'x')).report;
    c.equals('a throwing classifier is swallowed', threw.relay.dataEngine, undefined);
    c.equals('…and the report survives it', threw.verdict.category, 'regular');
  }
}

module.exports = { run };