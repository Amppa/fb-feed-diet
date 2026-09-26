'use strict';
/** Contract tests for the MAIN-world unified lifecycle Probe diagnostics (schema v4). */
const { createWindow, loadInject, loadDefaults, makeNode } = require('./harness');

function run(c) {
  const win = createWindow();
  win.FB_DIET_DEFAULTS = loadDefaults();
  win.document = { documentElement: { lang: 'zh-TW' } };
  loadInject(win, 'relay.js');
  loadInject(win, 'bridge.js');
  loadInject(win, 'ui.js');
  loadInject(win, 'probe.js');

  const probe = win.FBDietProbe;
  c.ok('FBDietProbe API is exposed', Boolean(probe));
  c.ok('buildProbeReport is a function', typeof probe.buildProbeReport === 'function');
  c.equals('legacy unit builder removed', probe.buildUnitProbeReport, undefined);
  c.equals('legacy proxy builder removed', probe.buildProxyProbeReport, undefined);
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
    evidence: { adId: 'ad_555' }
  };

  // 1. Unified report structure
  const res = probe.buildProbeReport(props, classifyResult, ['relay.path.one', { path: 'nul', value: null }, { path: 'hit', value: 'v' }], null, '2026-01-01T00:00:00.000Z');
  c.ok('report result has text', typeof res.text === 'string');
  c.ok('report result has report object', typeof res.report === 'object');
  const r = res.report;
  c.equals('schemaVersion is 4', r.schemaVersion, 4);
  c.equals('unified report drops the type discriminator', r.type, undefined);
  c.equals('unified report has no bare version key', r.version, undefined);
  c.equals('redundant mode alias removed', r.mode, undefined);
  c.equals('retired at block removed', r.at, undefined);
  c.equals('retired top-level scope removed', r.scope, undefined);

  // Environment block: what produced this report, and when
  c.equals('env.extVersion carries the release build', r.env.extVersion, win.FB_DIET_DEFAULTS.VERSION);
  c.equals('env.dietMode kept as the single mode key', r.env.dietMode, 'full');
  c.equals('env.lang records the page locale', r.env.lang, 'zh-TW');
  c.ok('env.probed present', Boolean(r.env.probed));
  c.ok('proxy.renderedAt records the snapshot time', typeof r.proxy.renderedAt === 'string' && r.proxy.renderedAt === '2026-01-01T00:00:00.000Z');

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
  c.ok('verdict.scope is nested in the verdict', Boolean(r.verdict.scope) && typeof r.verdict.scope.allowed === 'boolean');

  // Ordering: contract -> env -> unit -> verdict -> phases
  const keys = Object.keys(r);
  const envIdx = keys.indexOf('env');
  const unitIdx = keys.indexOf('unit');
  const verdictIdx = keys.indexOf('verdict');
  const proxyIdx = keys.indexOf('proxy');
  const domIdx = keys.indexOf('dom');
  c.ok('schemaVersion is the very first key', keys[0] === 'schemaVersion');
  c.ok('Part 1 (env) precedes Part 2 (unit)', envIdx < unitIdx);
  c.ok('Part 2 (unit) precedes Part 3 (verdict)', unitIdx < verdictIdx);
  c.ok('Part 3 (verdict) precedes Part 4 (proxy then dom phases)', verdictIdx < proxyIdx && proxyIdx < domIdx);

  // Proxy phase
  c.ok('proxy phase block present', Boolean(r.proxy));
  c.equals('proxy.initialClassify.category matches', r.proxy.initialClassify.category, 'sponsored');
  c.equals('proxy.initialClassify.evidence.adId matches', r.proxy.initialClassify.evidence.adId, 'ad_555');
  c.equals('proxy.entryCategory omitted when null', r.proxy.entryCategory, undefined);
  c.ok('proxy.relay block present with relay.js loaded', Boolean(r.proxy.relay));
  c.equals('proxy.relay.reads filters null-valued reads', r.proxy.relay.reads.length, 2);
  c.ok('proxy.payload carries post_id', r.proxy.payload.post_id === 'post_98765');
  c.ok('proxy.payload carries key lists', Array.isArray(r.proxy.payload.payloadKeys) && Array.isArray(r.proxy.payload.feedUnitKeys));

  // Null classify keeps the report sane
  const nullClassify = probe.buildProbeReport({ payload: { feedUnit: { clip_id: 'c1' } } }, null, [], null, null).report;
  c.equals('null classify keeps proxy.initialClassify null', nullClassify.proxy.initialClassify, undefined);
  c.equals('null classify still resolves a verdict category', nullClassify.verdict.category, 'regular');
  c.equals('null classify omits a null initialClassify object', nullClassify.proxy.initialClassify, undefined);

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
    c.ok('popup reads env.dietMode', popup && popup.textContent.indexOf('Mode: FULL') !== -1);
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
