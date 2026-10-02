'use strict';
/**
 * Contract tests for the MAIN-world unified lifecycle Probe diagnostics (schema v5).
 *
 * The independence contract (2026-09-28): the probe is a neutral observer. It reports what the data
 * layer holds AND what the page shows, in every detection mode. It used to receive the store read as
 * a parameter from `fold.js`, so in DOM-only mode — where the data engine is skipped entirely — it
 * reported `isReady: true` beside no reads at all, and a report that goes blind in one of the two
 * configurations it exists to compare cannot do its job. `tests/probe-neutrality.test.js` covers
 * that directly; this file covers the report shape around it.
 */
const { createWindow, loadMainWorld, makeNode } = require('./harness');

function run(c) {
  const win = createWindow();
  win.document = { documentElement: { lang: 'zh-TW' } };
  loadMainWorld(win, { scripts: ['comet.js', 'relay.js', 'bridge.js', 'dom-metadata.js', 'ui.js', 'probe-popup.js', 'probe.js'] });

  const probe = win.FBDietProbe;
  c.ok('FBDietProbe API is exposed', Boolean(probe));
  c.ok('buildProbeReport is a function', typeof probe.buildProbeReport === 'function');
  c.equals('legacy unit builder removed', probe.buildUnitProbeReport, undefined);
  c.equals('legacy proxy builder removed (v5 named the store phase proxy)', probe.buildProxyProbeReport, undefined);
  c.equals('legacy dom builder removed', probe.buildDomProbeReport, undefined);

  const props = {
    moduleName: 'CometFeedUnitErrorBoundary.react',
    payload: {
      position: 3,
      feedUnit: {
        post_id: 'post_98765',
        debug_info: 'test-ad-info'
      }
    }
  };

  const classifyResult = {
    unitId: 'unit_123',
    category: 'sponsored',
    reason: 'sponsored_data.ad_id',
    source: 'relay',
    evidence: { adId: 'ad_555' }
  };

  // 1. Unified report structure
  const res = probe.buildProbeReport(props, classifyResult, ['relay.path.one', { path: 'nul', value: null }, { path: 'hit', value: 'v' }], null, '2026-01-01T00:00:00.000Z');
  c.ok('report result has text', typeof res.text === 'string');
  c.ok('report result has report object', typeof res.report === 'object');
  const r = res.report;
  c.equals('schemaVersion is 6', r.schemaVersion, 6);
  c.equals('unified report drops the type discriminator', r.type, undefined);
  c.equals('unified report has no bare version key', r.version, undefined);
  c.equals('redundant mode alias removed', r.mode, undefined);
  c.equals('retired at block removed', r.at, undefined);
  c.equals('retired top-level scope removed', r.scope, undefined);

  // Environment block: what produced this report, and when
  c.equals('env.extVersion carries the release build', r.env.extVersion, win.FB_DIET_DEFAULTS.VERSION);
  c.equals('env.dietMode kept as the single mode key', r.env.dietMode, 'relay');
  c.equals('env.lang records the page locale', r.env.lang, 'zh-TW');
  c.ok('env.probed present', Boolean(r.env.probed));
  c.ok('env.probeAgeMs present and positive', typeof r.env.probeAgeMs === 'number' && r.env.probeAgeMs > 0);
  c.ok('relay.renderedAt records the snapshot time', typeof r.relay.renderedAt === 'string' && r.relay.renderedAt === '2026-01-01T00:00:00.000Z');

  // Unit identity block
  c.equals('unit.unitId matches', r.unit.unitId, 'unit_123');
  c.equals('unit.postId matches', r.unit.postId, 'post_98765');
  c.equals('unit.feedPosition matches', r.unit.feedPosition, 3);
  c.equals('unit.moduleName matches', r.unit.moduleName, 'CometFeedUnitErrorBoundary.react');

  // Verdict block (with the fold-scope gate nested inside)
  c.equals('verdict.category matches', r.verdict.category, 'sponsored');
  c.equals('verdict.reason matches', r.verdict.reason, 'sponsored_data.ad_id');
  c.equals('verdict carries no redundant enabled boolean', r.verdict.enabled, undefined);
  c.equals('verdict.foldMode present', r.verdict.foldMode, 'off');
  c.equals('verdict.detectionSource is relay for a store-decided unit', r.verdict.detectionSource, 'relay');
  c.ok('verdict.scope is nested in the verdict', Boolean(r.verdict.scope) && typeof r.verdict.scope.allowed === 'boolean');

  // Ordering: contract -> env -> unit -> verdict -> phases
  const keys = Object.keys(r);
  const envIdx = keys.indexOf('env');
  const unitIdx = keys.indexOf('unit');
  const verdictIdx = keys.indexOf('verdict');
  const cometIdx = keys.indexOf('comet');
  const relayIdx = keys.indexOf('relay');
  const domIdx = keys.indexOf('dom');
  c.ok('schemaVersion is the very first key', keys[0] === 'schemaVersion');
  c.ok('Part 1 (env) precedes Part 2 (unit)', envIdx < unitIdx);
  c.ok('Part 2 (unit) precedes Part 3 (verdict)', unitIdx < verdictIdx);
  c.ok('Part 3 (verdict) precedes Part 4 (comet, relay then dom phases)', verdictIdx < cometIdx && cometIdx < relayIdx && relayIdx < domIdx);

  // Relay phase
  c.ok('relay phase block present', Boolean(r.relay));
  c.equals('relay.initialClassify.category matches', r.relay.initialClassify.category, 'sponsored');
  c.equals('relay.initialClassify.evidence.adId matches', r.relay.initialClassify.evidence.adId, 'ad_555');
  c.equals('relay.entryCategory omitted when null', r.relay.entryCategory, undefined);
  c.equals('the store counters are reported even with no store captured', r.relay.isReady, false);
  c.equals('relay.reads filters null-valued reads', r.relay.reads.length, 2);
  c.ok('the Comet hook health has its own block', Boolean(r.comet && r.comet.moduleHealth));
  c.equals('the interception block is not part of the store block', r.relay.moduleHealth, undefined);
  c.equals('relay.payload does not reprint the post id', r.relay.payload.post_id, undefined);
  c.equals('…the unit block is where the post id lives', r.unit.postId, 'post_98765');
  // The structural key lists answer "the field this rule reads is not here", which is a question
  // about a unit the store named no category for. This one the store called `sponsored`.
  c.equals('a classified unit carries no key lists', r.relay.payload.feedUnitKeys, undefined);

  /* --- one member, one place: values the report already carries elsewhere are not reprinted --- */
  {
    const dup = probe.buildProbeReport(props, classifyResult, [], null).report;
    c.equals('initialClassify does not reprint the module name', dup.relay.initialClassify.moduleName, undefined);
    c.equals('…the unit block is where the module name lives', dup.unit.moduleName, 'CometFeedUnitErrorBoundary.react');

    // A typename that merely repeats the block's own `unitTypename` is a third copy of one string.
    const sameTypename = Object.assign({}, classifyResult, {
      unitTypename: 'Story',
      evidence: { ownTypename: 'Story', nestedTypename: 'Story', adId: 'ad_555' }
    });
    const s = probe.buildProbeReport(props, sameTypename, [], null).report;
    c.equals('a typename equal to unitTypename is not reprinted', s.relay.initialClassify.evidence.ownTypename, undefined);
    c.equals('…nor is the other one', s.relay.initialClassify.evidence.nestedTypename, undefined);

    // Pitfall 3: a friend sharing a Reel nests ShowcaseFeedUnit inside an ordinary Story. There the
    // two typenames are DIFFERENT facts, so the one that is not the reported typename must survive —
    // dropping it would hide the exact shape the misclassification table documents.
    const nestedTypename = Object.assign({}, classifyResult, {
      unitTypename: 'Story',
      evidence: { ownTypename: 'Story', nestedTypename: 'ShowcaseFeedUnit', adId: 'ad_555' }
    });
    const n = probe.buildProbeReport(props, nestedTypename, [], null).report;
    c.equals('a typename that differs from unitTypename is kept', n.relay.initialClassify.evidence.nestedTypename, 'ShowcaseFeedUnit');
    c.equals('…and the one that matches is still dropped', n.relay.initialClassify.evidence.ownTypename, undefined);
  }

  /* --- compaction is recursive: an all-null nested block disappears rather than shipping nulls --- */
  //
  // The shallow version left `enrichment.group` as `{id: null, name: null, joinState: null,
  // permalink: null}` and the assembly site already called that shape noise. One real field report
  // carried 899 characters of it.
  {
    const nulls = probe.buildProbeReport(props, classifyResult, [], null).report;
    const walk = (value, path, seen) => {
      if (value === null || typeof value !== 'object') return;
      if (seen.indexOf(value) !== -1) return;
      seen.push(value);
      if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, path + '[' + i + ']', seen));
        return;
      }
      for (const [k, v] of Object.entries(value)) {
        c.ok('no null survives anywhere in the report: ' + path + '.' + k, v !== null && v !== undefined);
        walk(v, path + '.' + k, seen);
      }
    };
    walk(nulls, 'report', []);

    // …and nothing anywhere in it is an empty object either. An empty object in a report a person
    // reads says "this block exists and is empty", which is a claim no block here can make: every
    // one of them is either populated or absent.
    const walkForEmpties = (value, path, seen) => {
      if (value === null || typeof value !== 'object' || seen.indexOf(value) !== -1) return;
      seen.push(value);
      if (Array.isArray(value)) return value.forEach((item, i) => walkForEmpties(item, path + '[' + i + ']', seen));
      c.ok('no empty object survives: ' + path, Object.keys(value).length > 0);
      for (const [k, v] of Object.entries(value)) walkForEmpties(v, path + '.' + k, seen);
    };
    walkForEmpties(nulls, 'report', []);
  }

  /* --- 0 and false are values, not absences --- */
  //
  // `surface.links: {reels: 0}` means "counted, found none" — a different claim from the block being
  // absent, and the count is what decision #43's threshold is measured against.
  {
    const zeroCard = makeNode('article', {}, []);
    const zeroReport = probe.buildProbeReport(props, classifyResult, [], zeroCard).report;
    const surface = zeroReport.dom && zeroReport.dom.extracted && zeroReport.dom.extracted.detectors
      ? zeroReport.dom.extracted.detectors.surface
      : null;
    if (surface && surface.links) {
      c.ok('a zero link count survives compaction', surface.links.reels === 0);
    }
    // isFolded: false is the common case for an unfolded unit and must never be compacted away.
    c.ok('isFolded false survives compaction', zeroReport.verdict.isFolded === false);
  }

  // Null classify keeps the report sane
  const nullClassify = probe.buildProbeReport({ payload: { feedUnit: { clip_id: 'c1' } } }, null, [], null, null).report;
  c.equals('null classify keeps relay.initialClassify null', nullClassify.relay.initialClassify, undefined);
  c.equals('null classify still resolves a verdict category', nullClassify.verdict.category, 'regular');

  // 2. DOM phase
  const authorNode = makeNode('a', { role: 'link' }, [], '賈伯斯');
  const authorH = makeNode('h3', { role: 'heading' }, [authorNode]);
  const postTitle = makeNode('h2', { dir: 'auto' }, [], 'iPhone 發表會');
  const postMsg = makeNode('div', { dir: 'auto' }, [], '這是一台革命性的手機。');
  const img1 = makeNode('img', { src: 'https://fbcdn.net/p1.jpg' });
  const img2 = makeNode('img', { src: 'https://fbcdn.net/p2.jpg' });
  const plusOverlay = makeNode('span', {}, [], '+3');
  const postLink = makeNode('a', { href: '/steve/posts/98765?fbclid=IwAR999' }, [], '剛剛');
  const groupLink = makeNode('a', { href: '/groups/apple_fans/' }, [], 'Apple 討論社團');
  const likeBtn = makeNode('div', { role: 'button', 'aria-label': '讚' }, [
    makeNode('div', { 'data-ad-rendering-role': 'like_button' }),
    makeNode('span', { dir: 'auto' }, [], '46')
  ]);
  const commentBtn = makeNode('div', { role: 'button', 'aria-label': '留言' }, [
    makeNode('div', { 'data-ad-rendering-role': 'comment_button' }),
    makeNode('span', { dir: 'auto' }, [], '2')
  ]);
  const shareBtn = makeNode('div', { role: 'button', 'aria-label': '傳送給朋友或在個人檔案上發佈。' }, [
    makeNode('div', { 'data-ad-rendering-role': 'share_button' }),
    makeNode('span', { dir: 'auto' }, [], '1')
  ]);
  const cardNode = makeNode('article', {}, [authorH, groupLink, postTitle, postMsg, img1, img2, plusOverlay, postLink, likeBtn, commentBtn, shareBtn]);

  const domRes = probe.buildProbeReport(props, classifyResult, [], cardNode);
  const dr = domRes.report;
  c.ok('dom phase carries extracted', Boolean(dr.dom && dr.dom.extracted));
  c.equals('dom extracted actor is 賈伯斯', dr.dom.extracted.actor, '賈伯斯');
  c.equals('dom extracted group matches', dr.dom.extracted.group, 'Apple 討論社團');
  c.equals('dom extracted title matches', dr.dom.extracted.title && dr.dom.extracted.title.text, 'iPhone 發表會');
  c.equals('dom extracted media counts images + overlay', dr.dom.extracted.media, '[📷 相片 x5]');
  c.equals('dom extracted omits metrics', dr.dom.extracted.metrics, undefined);
  c.ok('dom urls carry a clean primary url', Boolean(dr.dom.urls && dr.dom.urls.primary && dr.dom.urls.primary.indexOf('fbclid') === -1));
  c.equals('dom urls omit raw', dr.dom.urls.raw, undefined);
  c.equals('dom urls omit timestamp', dr.dom.urls.timestamp, undefined);
  c.equals('legacy top-level url object removed', dr.url, undefined);
  c.ok('verdict carries the scope object', Boolean(dr.verdict.scope && typeof dr.verdict.scope.allowed === 'boolean'));

  // Live UI reflection in verdict
  const mockBadge = makeNode('span', { className: 'fb-diet-badge fb-diet-badge-regular' }, [], 'Regular');
  const mockHidden = makeNode('div', { className: 'fb-diet-fold-hidden' });
  const mockHolder = makeNode('div', { className: 'fb-diet-probe-holder' }, [mockBadge, mockHidden]);
  mockBadge.parentElement = mockHolder;
  mockHidden.parentElement = mockHolder;
  const liveUiReport = probe.buildProbeReport(props, classifyResult, [], cardNode, null, mockHolder).report;
  c.equals('verdict reflects displayedTag from UI', liveUiReport.verdict.displayedTag, 'Regular');
  c.equals('verdict reflects isFolded from UI', liveUiReport.verdict.isFolded, true);

  // 3. Unified popup
  const doc = {
    createElement(tag) {
      const node = makeNode(tag);
      node.ownerDocument = doc;
      node.classList = { add() {}, remove() {} };
      node.appendChild = function (child) {
        if (child) {
          child.parentElement = node;
          node.children.push(child);
          node.textContent = (node.textContent ? node.textContent + ' ' : '') + (child.textContent || '');
        }
      };
      return node;
    }
  };
  global.document = doc;
  win.document = doc;

  try {
    const holder = doc.createElement('div');
    holder.className = 'fb-diet-probe-holder';
    probe.showProbePopup(holder, classifyResult, props, r);
    const popup = holder.querySelector('.fb-diet-probe-popup');
    c.ok('unified popup element rendered', Boolean(popup));
    c.ok('popup contains Mode', popup && popup.textContent.indexOf('Mode:') !== -1);
    c.ok('popup contains Category', popup && popup.textContent.indexOf('Category:') !== -1);
    c.ok('popup contains Signal', popup && popup.textContent.indexOf('Signal:') !== -1);
    c.ok('popup contains Source', popup && popup.textContent.indexOf('Source:') !== -1);
    c.ok('popup reads the nested verdict.scope', popup && popup.textContent.indexOf('Scope: home/search/marketplace') !== -1);
    c.ok('popup reads env.dietMode', popup && popup.textContent.indexOf('Mode: RELAY') !== -1);
    c.ok('popup contains Copied message', popup && /已複製\s+生命週期\s+診斷 JSON/.test(popup.textContent));

    // DOM-phase rows show up when live extraction is available
    const holder2 = doc.createElement('div');
    holder2.className = 'fb-diet-probe-holder';
    probe.showProbePopup(holder2, classifyResult, props, dr);
    const popup2 = holder2.querySelector('.fb-diet-probe-popup');
    c.ok('unified popup contains Author', popup2 && popup2.textContent.indexOf('賈伯斯') !== -1);
    c.ok('unified popup contains Title', popup2 && popup2.textContent.indexOf('iPhone 發表會') !== -1);
    const anchor = popup2 && popup2.querySelector('a');
    c.ok('unified popup has clickable link anchor', Boolean(anchor));
    c.ok('popup link opens in new tab', anchor && anchor.target === '_blank');
    c.ok('popup link has href', anchor && Boolean(anchor.href));
  } finally {
    delete global.document;
  }
}
module.exports = { run };
