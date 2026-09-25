'use strict';
/**
 * Tests for src/content/detector.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Checker, makeNode, createWindow, loadDefaults, ROOT } = require('./harness');

function loadDetector(pathname) {
  const detectorCode = fs.readFileSync(path.join(ROOT, 'src', 'content', 'detector.js'), 'utf8');
  const win = createWindow();
  win.location.pathname = pathname || '/';
  win.FB_DIET_DEFAULTS = loadDefaults();
  const sandbox = {
    window: win,
    document: { createTreeWalker: () => ({ nextNode: () => null }) },
    NodeFilter: { SHOW_TEXT: 4 },
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(detectorCode, sandbox);
  return { detector: win.FBDietDetector, win };
}

function run(checker) {
  const { detector, win } = loadDetector('/');
  checker.ok('FBDietDetector is exposed on window', Boolean(detector));

  // makeNode doubles lack nodeType; detector.isElement gates on nodeType === 1.
  const asElement = (node) => {
    node.nodeType = 1;
    return node;
  };
  const anchor = (href) => asElement(makeNode('a', { href }));
  const unit = (...children) => asElement(makeNode('div', {}, children));

  /* --- structural ad links: true positives --- */
  checker.ok('relative /ads/about byline link is sponsored', detector.isSponsored(unit(anchor('/ads/about/?ad_id=123'))));
  checker.ok('absolute facebook.com /ads/about link is sponsored', detector.isSponsored(unit(anchor('https://www.facebook.com/ads/about/'))));
  checker.ok('mobile subdomain facebook.com /ads/ link is sponsored', detector.isSponsored(unit(anchor('https://m.facebook.com/ads/about?x=1'))));
  checker.ok('facebook.com/ads/ path still counts (ad library style)', detector.isSponsored(unit(anchor('https://www.facebook.com/ads/library'))));
  checker.ok('ad_id as an actual query parameter is sponsored', detector.isSponsored(unit(anchor('/permalink.php?story_fbid=1&id=2&ad_id=3'))));

  /* --- structural ad links: false positives that must NOT match --- */
  checker.ok('external site /ads/about link is not sponsored', !detector.isSponsored(unit(anchor('https://example.com/ads/about'))));
  checker.ok('thread_id param does not match the ad_id marker', !detector.isSponsored(unit(anchor('/groups/123/posts/456/?thread_id=789'))));
  checker.ok('/ads/ path embedded in a query value is not sponsored', !detector.isSponsored(unit(anchor('https://www.facebook.com/l.php?u=/ads/about'))));
  checker.ok('external thread_id substring is not sponsored', !detector.isSponsored(unit(anchor('https://example.com/watch?thread_id=2'))));

  /* --- other sponsored signals --- */
  checker.ok('data-ad-id attribute is sponsored', detector.isSponsored(unit(asElement(makeNode('div', { 'data-ad-id': '123' })))));
  checker.ok('aria-label keyword is sponsored', detector.isSponsored(unit(asElement(makeNode('span', { 'aria-label': '贊助' })))));
  checker.ok(
    'plain organic unit is not sponsored',
    !detector.isSponsored(unit(anchor('/groups/123/posts/456'), asElement(makeNode('span', {}, [], '朋友貼文'))))
  );

  /* --- marketplace / search reuse the same precise check --- */
  win.location.pathname = '/marketplace/item/123/';
  checker.ok('marketplace unit folds on facebook /ads/about link', detector.isMarketAd(unit(anchor('/ads/about/'))));
  checker.ok('marketplace unit ignores external /ads/about link', !detector.isMarketAd(unit(anchor('https://example.com/ads/about'))));
  checker.ok('marketplace unit ignores thread_id substring', !detector.isMarketAd(unit(anchor('/groups/1/posts/2?thread_id=3'))));

  win.location.pathname = '/search/top';
  checker.ok('search unit folds on facebook /ads/about link', detector.isSearchAd(unit(anchor('https://www.facebook.com/ads/about/'))));
  checker.ok('search unit ignores external /ads/about link', !detector.isSearchAd(unit(anchor('https://example.com/ads/about'))));
}

module.exports = { run };
