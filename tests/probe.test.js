'use strict';
/** Contract tests for the MAIN-world Dual-Probe diagnostics. */
const { createWindow, loadInject, loadDefaults, makeNode } = require('./harness');

function run(c) {
  const win = createWindow();
  win.FB_DIET_DEFAULTS = loadDefaults();
  loadInject(win, 'bridge.js');
  loadInject(win, 'ui.js');
  loadInject(win, 'probe.js');

  const probe = win.FBDietProbe;
  c.ok('FBDietProbe API is exposed', Boolean(probe));
  c.ok('buildProxyProbeReport is a function', typeof probe.buildProxyProbeReport === 'function');
  c.ok('buildDomProbeReport is a function', typeof probe.buildDomProbeReport === 'function');
  c.ok('buildUnitProbeReport is preserved', typeof probe.buildUnitProbeReport === 'function');

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

  // 1. Test Proxy Report
  const proxyReportRes = probe.buildProxyProbeReport(props, classifyResult, ['relay.path.one']);
  c.ok('proxy report result has text', typeof proxyReportRes.text === 'string');
  c.ok('proxy report result has report object', typeof proxyReportRes.report === 'object');
  const pr = proxyReportRes.report;
  c.equals('proxy report type is proxy', pr.type, 'proxy');
  c.equals('proxy report schemaVersion is 2', pr.schemaVersion, 2);
  c.equals('proxy report has no app version', pr.version, undefined);
  c.equals('proxy report unitId matches', pr.unitId, 'unit_123');
  c.equals('proxy report postId matches', pr.postId, 'post_98765');
  c.equals('proxy report feedPosition matches', pr.feedPosition, 3);
  c.ok('proxy report contains memory', Boolean(pr.memory));
  c.ok('proxy report contains payload', Boolean(pr.payload));
  c.equals('proxy report relayReads contains path', pr.relayReads && pr.relayReads[0], 'relay.path.one');
  c.equals('proxy report classifies category', pr.classify && pr.classify.category, 'sponsored');
  c.equals('proxy report classify does not duplicate unitId', pr.classify.unitId, undefined);
  c.equals('proxy report classify does not duplicate moduleName', pr.classify.moduleName, undefined);
  c.equals('proxy report classify does not duplicate categoryEnabled', pr.classify.categoryEnabled, undefined);
  c.equals('proxy report classify does not duplicate foldMode', pr.classify.foldMode, undefined);
  c.equals('proxy report omits null signals', pr.signals, undefined);
  c.equals('proxy report omits null recordKeys', pr.recordKeys, undefined);
  c.equals('proxy report omits empty url object', pr.url, undefined);

  // Test that all-null relayReads are filtered out
  const nullReadsReport = probe.buildProxyProbeReport(props, classifyResult, [
    { path: '^sponsored_data.ad_id', value: null },
    { path: 'is_sponsored', value: null }
  ]).report;
  c.equals('proxy report filters out all-null relayReads', nullReadsReport.relayReads, undefined);

  // Test 4-part architectural ordering
  const prKeys = Object.keys(pr);
  const vIdx = prKeys.indexOf('schemaVersion');
  const scopeIdx = prKeys.indexOf('scope');
  const posIdx = prKeys.indexOf('feedPosition');
  const postIdx = prKeys.indexOf('postId');
  const unitIdx = prKeys.indexOf('unitId');
  const classIdx = prKeys.indexOf('classify');
  const setIdx = prKeys.indexOf('categorySetting');
  const memIdx = prKeys.indexOf('memory');
  const payIdx = prKeys.indexOf('payload');

  c.ok('Part 1 (Environment) precedes Part 2 (Input)', vIdx < posIdx && scopeIdx < posIdx);
  c.ok('Part 2 (Input) places unitId at the end of input block', posIdx < postIdx && postIdx < unitIdx);
  c.ok('Part 2 (Input) precedes Part 3 (Classification & Policy)', unitIdx < classIdx && classIdx < setIdx);
  c.ok('Part 3 (Classification) precedes Part 4 (Diagnostics)', setIdx < memIdx && memIdx < payIdx);

  // 2. Test DOM Report
  const authorNode = makeNode('a', { role: 'link' }, [], '賈伯斯');
  const authorH = makeNode('h3', { role: 'heading' }, [authorNode]);
  const postTitle = makeNode('h2', { dir: 'auto' }, [], 'iPhone 發表會');
  const postMsg = makeNode('div', { dir: 'auto' }, [], '這是一台革命性的手機。');
  const img1 = makeNode('img', { src: 'https://fbcdn.net/p1.jpg' });
  const img2 = makeNode('img', { src: 'https://fbcdn.net/p2.jpg' });
  const plusOverlay = makeNode('span', {}, [], '+3');
  const postLink = makeNode('a', { href: '/steve/posts/98765?fbclid=IwAR999' }, [], '剛剛');
  const groupLink = makeNode('a', { href: '/groups/apple_fans/' }, [], 'Apple 討論社團');

  const cardNode = makeNode('article', {}, [authorH, groupLink, postTitle, postMsg, img1, img2, plusOverlay, postLink]);

  const domReportRes = probe.buildDomProbeReport(cardNode, props, classifyResult);
  c.ok('dom report result has text', typeof domReportRes.text === 'string');
  c.ok('dom report result has report object', typeof domReportRes.report === 'object');
  const dr = domReportRes.report;
  c.equals('dom report type is dom', dr.type, 'dom');
  c.equals('dom report schemaVersion is 2', dr.schemaVersion, 2);
  c.equals('dom report has no app version', dr.version, undefined);
  c.equals('dom report unitId matches', dr.unitId, 'unit_123');
  c.equals('dom report postId matches', dr.postId, 'post_98765');
  c.equals('dom report feedPosition matches', dr.feedPosition, 3);
  c.equals('dom report actor is 賈伯斯', dr.actor, '賈伯斯');
  c.equals('dom report group is Apple 討論社團', dr.group, 'Apple 討論社團');
  c.equals('dom report title text is extracted', dr.title && dr.title.text, 'iPhone 發表會');
  c.equals('dom report media counts images + overlay', dr.media, '[📷 相片 x5]');
  c.equals('dom report timestamp is omitted', dr.timestamp, undefined);
  c.ok('dom report has clean primary url', dr.urls && dr.urls.primary && dr.urls.primary.indexOf('fbclid') === -1);
  c.equals('dom report urls omits raw', dr.urls && dr.urls.raw, undefined);
  c.equals('dom report urls omits timestamp', dr.urls && dr.urls.timestamp, undefined);
  c.ok('dom report has textCandidates array', Array.isArray(dr.textCandidates));
  c.ok('textCandidates are <= 10 items', dr.textCandidates.length <= 10);
  c.ok('textCandidate texts <= 30 chars', dr.textCandidates.every((item) => item.text.length <= 30));

  // Test 4-part architectural ordering for DOM report
  const drKeys = Object.keys(dr);
  const drVIdx = drKeys.indexOf('schemaVersion');
  const drScopeIdx = drKeys.indexOf('scope');
  const drPosIdx = drKeys.indexOf('feedPosition');
  const drPostIdx = drKeys.indexOf('postId');
  const drUnitIdx = drKeys.indexOf('unitId');
  const drUrlsIdx = drKeys.indexOf('urls');
  const drActorIdx = drKeys.indexOf('actor');
  const drTcIdx = drKeys.indexOf('textCandidates');

  c.ok('DOM Part 1 (Environment) precedes Part 2 (Input)', drVIdx < drPosIdx && drScopeIdx < drPosIdx);
  c.ok('DOM Part 2 (Input) places unitId at the end of input block', drPosIdx < drPostIdx && drPostIdx < drUnitIdx);
  c.ok('DOM Part 2 (Input) precedes Part 3 (DOM Extraction)', drUnitIdx < drUrlsIdx && drUrlsIdx < drActorIdx);
  c.ok('DOM Part 3 (DOM Extraction) precedes Part 4 (Candidates & Debug)', drActorIdx < drTcIdx);
  c.equals('DOM report urls omits null adUrl', dr.urls.adUrl, undefined);
  c.equals('DOM report urls omits null synthesized', dr.urls.synthesized, undefined);
  c.ok('DOM report contains scope object', Boolean(dr.scope && typeof dr.scope.allowed === 'boolean'));

  // 3. Test showProbePopup
  const doc = {
    createElement(tag) {
      const node = makeNode(tag);
      node.ownerDocument = doc;
      node.classList = { add() {}, remove() {} };
      node.appendChild = function(child) {
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
    // Popup proxy mode
    const holderProxy = doc.createElement('div');
    holderProxy.className = 'fb-diet-probe-holder';
    probe.showProbePopup(holderProxy, classifyResult, props, pr, 'proxy');
    const popupProxy = holderProxy.querySelector('.fb-diet-probe-popup');
    c.ok('proxy popup element rendered', Boolean(popupProxy));
    c.ok('proxy popup contains Category', popupProxy && popupProxy.textContent.indexOf('Category:') !== -1);
    c.ok('proxy popup contains Copied message', popupProxy && popupProxy.textContent.indexOf('已複製 Proxy 診斷 JSON') !== -1);

    // Popup dom mode
    const holderDom = doc.createElement('div');
    holderDom.className = 'fb-diet-probe-holder';
    probe.showProbePopup(holderDom, classifyResult, props, dr, 'dom');
    const popupDom = holderDom.querySelector('.fb-diet-probe-popup');
    c.ok('dom popup element rendered', Boolean(popupDom));
    c.ok('dom popup contains DOM Probe header', popupDom && popupDom.textContent.indexOf('DOM Probe') !== -1);
    c.ok('dom popup contains Author', popupDom && popupDom.textContent.indexOf('賈伯斯') !== -1);
    c.ok('dom popup contains Title', popupDom && popupDom.textContent.indexOf('iPhone 發表會') !== -1);
    c.ok('dom popup contains Copied message', popupDom && popupDom.textContent.indexOf('已複製 DOM 診斷 JSON') !== -1);
  } finally {
    delete global.document;
  }
}

module.exports = { run };
