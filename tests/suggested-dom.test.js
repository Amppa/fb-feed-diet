'use strict';
const { Checker, createFakeReact, createWindow, loadInject, loadDefaults, createFakeComet, countMessages } = require('./harness');

const FEED_MODULE = 'CometFeedUnitErrorBoundary.react';

/** Simple simulated DOM node builder for unit testing DOM extractors. */
function makeNode(tag, attrs = {}, children = [], text = '') {
  const el = {
    tagName: tag.toUpperCase(),
    attributes: Object.assign({}, attrs),
    children: [],
    parentElement: null,
    textContent: text,
    getAttribute(name) {
      return this.attributes[name] !== undefined ? this.attributes[name] : null;
    },
    contains(other) {
      if (!other) return false;
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    matches(sel) {
      let s = sel.trim();
      let targetTag = '';
      if (!s.startsWith('[')) {
        const bracket = s.indexOf('[');
        if (bracket !== -1) {
          targetTag = s.slice(0, bracket).toUpperCase();
          s = s.slice(bracket);
        } else {
          return s.toUpperCase() === this.tagName;
        }
      }
      if (targetTag && targetTag !== this.tagName) return false;
      if (s.startsWith('[') && s.endsWith(']')) {
        const inner = s.slice(1, -1);
        if (inner.indexOf('*=') !== -1) {
          const [k, v] = inner.split('*=').map((str) => str.replace(/^["']|["']$/g, ''));
          return this.attributes[k] && this.attributes[k].indexOf(v) !== -1;
        }
        if (inner.indexOf('=') !== -1) {
          const [k, v] = inner.split('=').map((str) => str.replace(/^["']|["']$/g, ''));
          return this.attributes[k] === v;
        }
        return this.attributes[inner] !== undefined;
      }
      return false;
    },
    closest(sel) {
      let cur = this;
      while (cur) {
        if (cur.matches && cur.matches(sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelector(sel) {
      const list = this.querySelectorAll(sel);
      return list.length ? list[0] : null;
    },
    querySelectorAll(sel) {
      const results = [];
      const parts = sel.split(',').map((s) => s.trim());
      function walk(node) {
        for (const child of node.children) {
          for (const part of parts) {
            if (part === child.tagName.toLowerCase() || part === child.tagName || child.matches(part)) {
              if (!results.includes(child)) results.push(child);
              break;
            }
          }
          walk(child);
        }
      }
      walk(this);
      return results;
    }
  };

  for (const child of children) {
    if (child) {
      child.parentElement = el;
      el.children.push(child);
    }
  }

  // Recalculate textContent if text was not provided
  if (!text && el.children.length > 0) {
    el.textContent = el.children.map((c) => c.textContent).join(' ');
  }

  return el;
}

function run(c) {
  const win = createWindow();
  win.FB_DIET_DEFAULTS = loadDefaults();
  loadInject(win, 'proxy.js');
  loadInject(win, 'metadata.js');
  loadInject(win, 'classify.js');
  loadInject(win, 'bridge.js');
  loadInject(win, 'dom-suggested.js');
  loadInject(win, 'ui.js');
  loadInject(win, 'probe.js');
  loadInject(win, 'fold.js');
  const detector = win.FBDietDOMSuggested;
  c.ok('DOM suggested detector exposed on window', Boolean(detector) && typeof detector.detect === 'function');
  c.ok('UI no longer owns the suggested detector', typeof win.FBDietUI.detectSuggestedFromDom !== 'function');

  /* --- Edge cases & empty inputs --- */
  c.equals('null container returns null', detector.detect(null), null);
  c.equals('object without querySelector returns null', detector.detect({}), null);

  /* --- Positive 1: Recommendation keyword in top header --- */
  {
    const authorLink = makeNode('a', { role: 'link' }, [], 'Some Page');
    const heading = makeNode('h3', {}, [authorLink], 'Some Page');
    const header = makeNode('header', {}, [
      makeNode('span', {}, [], '為你推薦'),
      heading
    ], '為你推薦 Some Page');
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.ok('detects 為你推薦 in top header', Boolean(res) && res.isSuggested === true);
    c.equals('reason is dom:header_keyword', res && res.reason, 'dom:header_keyword');
    c.equals('matched text keyword', res && res.text, '為你推薦');
  }

  /* --- Positive 2: English Suggested for you in header --- */
  {
    const heading = makeNode('h2', {}, [makeNode('a', { role: 'link' }, [], 'Popular Page')]);
    const header = makeNode('div', { 'data-ad-comet-preview': 'header' }, [
      makeNode('span', {}, [], 'Suggested for you'),
      heading
    ], 'Suggested for you Popular Page');
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.ok('detects Suggested for you in header', Boolean(res) && res.isSuggested === true);
    c.equals('reason is dom:header_keyword', res && res.reason, 'dom:header_keyword');
    c.equals('matched text keyword', res && res.text, 'Suggested for you');
  }

  /* --- Positive 3: Follow button in author header --- */
  {
    const authorLink = makeNode('a', { role: 'link' }, [], 'Tech News');
    const heading = makeNode('h4', { role: 'heading' }, [authorLink]);
    const followBtn = makeNode('div', { role: 'button' }, [], '追蹤');
    const header = makeNode('header', {}, [heading, followBtn], 'Tech News 追蹤');
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.ok('detects Follow button (追蹤) in author header', Boolean(res) && res.isSuggested === true);
    c.equals('signal is Follow', res && res.signal, 'Follow');
    c.equals('reason is dom:follow_button', res && res.reason, 'dom:follow_button');
    c.equals('button text matches', res && res.text, '追蹤');
  }

  /* --- Positive 3b: Bullet-prefixed Follow button ("· 追蹤") in author header zone --- */
  {
    const heading = makeNode('h4', { role: 'heading' }, [makeNode('a', { role: 'link' }, [], 'Heaven Raven')]);
    const followSpan = makeNode('span', { role: 'button' }, [], '· 追蹤');
    const authorRow = makeNode('div', {}, [heading, followSpan]);
    const msg = makeNode('div', { 'data-ad-preview': 'message' }, [], 'Post text content');
    const card = makeNode('div', { role: 'article' }, [authorRow, msg]);

    const res = detector.detect(card);
    c.ok('detects bullet-prefixed Follow button (· 追蹤) in header zone', Boolean(res) && res.isSuggested === true);
    c.equals('signal is Follow', res && res.signal, 'Follow');
    c.equals('reason is dom:follow_button', res && res.reason, 'dom:follow_button');
  }

  /* --- Positive 3c: Follow button with aria-label="追蹤" --- */
  {
    const heading = makeNode('h4', { role: 'heading' }, [makeNode('a', { role: 'link' }, [], 'Fashion News')]);
    const followBtn = makeNode('div', { role: 'button', 'aria-label': '追蹤' }, [makeNode('i', {}, [])]);
    const header = makeNode('header', {}, [heading, followBtn]);
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.ok('detects Follow button with aria-label="追蹤"', Boolean(res) && res.isSuggested === true);
    c.equals('signal is Follow', res && res.signal, 'Follow');
    c.equals('reason is dom:follow_button_aria', res && res.reason, 'dom:follow_button_aria');
  }

  /* --- Positive 4: English Follow button in author header --- */
  {
    const heading = makeNode('h3', {}, [makeNode('a', { role: 'link' }, [], 'Nature Photos')]);
    const followBtn = makeNode('button', {}, [], '+ Follow');
    const header = makeNode('header', {}, [heading, followBtn], 'Nature Photos + Follow');
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.ok('detects English Follow button in author header', Boolean(res) && res.isSuggested === true);
    c.equals('signal is Follow', res && res.signal, 'Follow');
    c.equals('reason is dom:follow_button', res && res.reason, 'dom:follow_button');
  }

  /* --- Positive 5: Join button (加入) in author header --- */
  {
    const heading = makeNode('h3', {}, [makeNode('a', { role: 'link' }, [], 'Camping Lovers')]);
    const joinBtn = makeNode('div', { role: 'button' }, [], '加入');
    const header = makeNode('header', {}, [heading, joinBtn], 'Camping Lovers 加入');
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.ok('detects Join button (加入) in author header', Boolean(res) && res.isSuggested === true);
    c.equals('signal is Join', res && res.signal, 'Join');
    c.equals('reason is dom:join_button', res && res.reason, 'dom:join_button');
  }

  /* --- Positive 6: aria-label containing recommendation text --- */
  {
    const labelSpan = makeNode('span', { 'aria-label': '為你推薦 · 追蹤' }, [], '…');
    const header = makeNode('header', {}, [labelSpan]);
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.ok('detects aria-label suggestion', Boolean(res) && res.isSuggested === true);
    c.equals('reason is dom:aria_suggested', res && res.reason, 'dom:aria_suggested');
    c.equals('signal is Other for generic recommendation label', res && res.signal, 'Other');
  }

  /* --- Positive 7: Unrecognized extra Action button in author row -> signal: Other --- */
  {
    const authorLink = makeNode('a', { role: 'link' }, [], 'Some Creator');
    const heading = makeNode('h4', { role: 'heading' }, [authorLink]);
    const customActionBtn = makeNode('div', { role: 'button' }, [], '訂閱頻道');
    const header = makeNode('header', {}, [heading, customActionBtn]);
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.ok('detects extra Action button in author row', Boolean(res) && res.isSuggested === true);
    c.equals('signal is Other', res && res.signal, 'Other');
    c.equals('reason is dom:other_extra_button', res && res.reason, 'dom:other_extra_button');
    c.ok('debug log captures author and button info', Boolean(res && res.debug && res.debug.primaryAuthor === 'Some Creator'));
  }

  /* --- Positive 8: Extra button with SVG icon in author row -> signal: Other (dom:other_svg_icon) --- */
  {
    const authorLink = makeNode('a', { role: 'link' }, [], 'Brand Page');
    const heading = makeNode('h4', { role: 'heading' }, [authorLink]);
    const svgIcon = makeNode('svg', { 'aria-hidden': 'true' }, [makeNode('path', { d: 'M10 10...' }, [])]);
    const iconOnlyBtn = makeNode('div', { role: 'button' }, [svgIcon]);
    const header = makeNode('header', {}, [heading, iconOnlyBtn]);
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.ok('detects SVG icon button in author row', Boolean(res) && res.isSuggested === true);
    c.equals('signal is Other for svg icon', res && res.signal, 'Other');
    c.equals('reason is dom:other_svg_icon', res && res.reason, 'dom:other_svg_icon');
  }

  /* --- Negative 1: Regular friend post with no suggestion markers --- */
  {
    const authorLink = makeNode('a', { role: 'link' }, [], 'Friend Alice');
    const heading = makeNode('h2', {}, [authorLink], 'Friend Alice');
    const header = makeNode('header', {}, [heading], 'Friend Alice');
    const msg = makeNode('div', { 'data-ad-preview': 'message' }, [], 'Hello world, had a great coffee today!');
    const card = makeNode('div', { role: 'article' }, [header, msg]);

    const res = detector.detect(card);
    c.equals('regular post returns null', res, null);
  }

  /* --- Negative 1b: Regular friend post with three-dot menu and timestamp link is NOT flagged as Other --- */
  {
    const authorLink = makeNode('a', { role: 'link' }, [], 'Friend Charlie');
    const heading = makeNode('h2', {}, [authorLink], 'Friend Charlie');
    const timeLink = makeNode('a', { href: '/friend_charlie/posts/12345' }, [], '2小時 · 公開');
    const menuBtn = makeNode('div', { role: 'button', 'aria-label': '貼文選項', 'aria-haspopup': 'menu' }, [], '…');
    const header = makeNode('header', {}, [heading, timeLink, menuBtn]);
    const msg = makeNode('div', { 'data-ad-preview': 'message' }, [], 'Having lunch together!');
    const card = makeNode('div', { role: 'article' }, [header, msg]);

    const res = detector.detect(card);
    c.equals('friend post with card menu and timestamp is NOT flagged as suggested', res, null);
  }

  /* --- Negative 2 (Crucial): Friend reshares a post containing a Follow button in the nested quote --- */
  {
    // Outer post by friend Bob
    const bobHeading = makeNode('h2', {}, [makeNode('a', { role: 'link' }, [], 'Friend Bob')], 'Friend Bob');
    const bobHeader = makeNode('header', {}, [bobHeading], 'Friend Bob');
    const bobMessage = makeNode('div', { 'data-ad-preview': 'message' }, [], 'Look at this awesome photo:');

    // Inner attachment: reshared post from National Geographic
    const natGeoHeading = makeNode('h3', {}, [makeNode('a', { role: 'link' }, [], 'National Geographic')]);
    const natGeoFollow = makeNode('div', { role: 'button' }, [], '追蹤');
    const natGeoHeader = makeNode('div', {}, [natGeoHeading, natGeoFollow]);
    const nestedReshare = makeNode('div', { role: 'article' }, [natGeoHeader], 'National Geographic 追蹤');
    const attachmentWrapper = makeNode('div', { 'data-ad-preview': 'message_container' }, [nestedReshare]);

    const card = makeNode('div', { role: 'article' }, [bobHeader, bobMessage, attachmentWrapper]);

    const res = detector.detect(card);
    c.equals('friend reshare with follow button in nested quote is NOT flagged as suggested', res, null);
  }

  /* --- Negative 3: Friend comment story (contextual header) --- */
  {
    const heading = makeNode('h2', {}, [makeNode('a', { role: 'link' }, [], 'Bob')], 'Bob');
    const commentHeader = makeNode('header', {}, [
      makeNode('span', {}, [], 'Alice 留言回應了為你推薦貼文'),
      heading
    ], 'Alice 留言回應了為你推薦貼文 Bob');
    const card = makeNode('div', { role: 'article' }, [commentHeader]);

    const res = detector.detect(card);
    c.equals('friend comment context is excluded from suggestion match', res, null);
  }

  /* --- Negative 4: Verified account (Meta Verified badge with empty buttons) is NOT flagged as suggested --- */
  {
    const authorLink = makeNode('a', { role: 'link' }, [], 'ETtoday新聞雲');
    const verifiedBadge = makeNode('span', { role: 'button', 'aria-label': '已驗證帳號' }, [
      makeNode('svg', { 'aria-label': '已驗證帳號' }, [])
    ]);
    const heading = makeNode('h4', { role: 'heading' }, [authorLink, verifiedBadge], 'ETtoday新聞雲 已驗證帳號');
    const threeDotMenu = makeNode('div', { role: 'button', 'aria-label': '對ETtoday新聞雲的這則貼文採取的動作' }, []);
    const emptyLayoutBtn = makeNode('div', { role: 'button' }, []);
    const header = makeNode('header', {}, [heading, threeDotMenu, emptyLayoutBtn]);
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.equals('verified account with blue badge is NOT flagged as suggested', res, null);
  }

  /* --- Integration: Full mode wraps regular units with display: contents, Lite mode stays untouched --- */
  {
    const React = createFakeReact();
    const winTest = createWindow();
    winTest.FB_DIET_DEFAULTS = loadDefaults();
    const comet = createFakeComet(winTest, React);

    loadInject(winTest, 'proxy.js');
    loadInject(winTest, 'metadata.js');
    loadInject(winTest, 'classify.js');
    loadInject(winTest, 'bridge.js');
    loadInject(winTest, 'dom-suggested.js');
    loadInject(winTest, 'ui.js');
    loadInject(winTest, 'probe.js');
    loadInject(winTest, 'fold.js');

    function SourceCmp() {
      return { type: 'div', props: { children: 'post body' }, __source: true };
    }
    winTest.__d(SourceCmp, FEED_MODULE, [], null, null, null, { default: SourceCmp });
    comet.require(FEED_MODULE);
    const wrapper = comet.getExport(FEED_MODULE).default;

    function renderUnit(payload) {
      React.resetHooks();
      const element = wrapper(payload);
      if (element && typeof element.type === 'function') {
        element.type(element.props);
        React.resetHooks();
        return element.type(element.props);
      }
      return element;
    }

    // 1. Lite Mode: unclassified unit returns raw element untouched without fb-diet-full-container
    winTest.FBDietBridge.setSettings({ dietMode: 'lite', enabled: true, alwaysShowFoldBar: false });
    const liteResult = renderUnit({ feedUnit: { id: 'u-lite', __typename: 'Story' } });
    c.ok('lite mode returns raw element without full-container wrapper', liteResult && liteResult.__source === true);

    // 2. Full Mode: unclassified unit is wrapped in fb-diet-full-container with display: contents
    winTest.FBDietBridge.setSettings({ dietMode: 'full', enabled: true, foldSuggested: true, alwaysShowFoldBar: false });
    const fullResult = renderUnit({ feedUnit: { id: 'u-full', __typename: 'Story' } });
    c.ok('full mode wraps unclassified unit in fb-diet-full-container', Boolean(fullResult) && fullResult.props && fullResult.props.className === 'fb-diet-full-container');
    c.equals('full-container uses display: contents for zero layout disruption', fullResult.props.style && fullResult.props.style.display, 'contents');

    // 3. Probe report reflects dom suggested evidence and the final verdict
    const mockContainer = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [
        makeNode('h4', { role: 'heading' }, [makeNode('a', {}, [], 'Heaven Raven')]),
        makeNode('div', { role: 'button' }, [], '· 追蹤')
      ])
    ]);
    const probeResult = winTest.FBDietProbe.buildProbeReport(
      { payload: { feedUnit: { id: 'u-probe' } } },
      { category: 'suggested', signal: 'Follow', unitId: 'u-probe', reason: 'dom:follow_button', domEvidence: { isSuggested: true, signal: 'Follow', reason: 'dom:follow_button', text: '· 追蹤', debug: { author: 'Heaven Raven' } }, evidence: { ownTypename: 'Story' } },
      null,
      mockContainer
    );
    const probeReport = probeResult && probeResult.report;
    c.ok('probe report includes dom.extracted.suggested', Boolean(probeReport && probeReport.dom && probeReport.dom.extracted && probeReport.dom.extracted.suggested));
    c.equals('probe report dom suggested reason matches', probeReport.dom.extracted.suggested.reason, 'dom:follow_button');
    c.equals('probe report verdict category is suggested', probeReport.verdict.category, 'suggested');
    c.equals('probe report initialClassify signal is Follow', probeReport.proxy.initialClassify.signal, 'Follow');
    c.equals('probe report verdict reason is dom:follow_button', probeReport.verdict.reason, 'dom:follow_button');
    c.equals('probe report evidence includes domSignal', probeReport.proxy.initialClassify.evidence.domSignal, '· 追蹤');
    c.ok('probe report includes suggested debug', Boolean(probeReport.dom.extracted.suggested.debug));
    // 4. Full Mode wraps unclassified unit even when foldSuggested is false
    winTest.FBDietBridge.setSettings({ dietMode: 'full', enabled: true, foldSuggested: false, alwaysShowFoldBar: false });
    const fullResultFoldOff = renderUnit({ feedUnit: { id: 'u-full-off', __typename: 'Story' } });
    c.ok('full mode wraps unclassified unit even when foldSuggested is false', Boolean(fullResultFoldOff) && fullResultFoldOff.props && fullResultFoldOff.props.className === 'fb-diet-full-container');

    // 5. Probe report classifies unclassified relay unit as suggested when DOM has follow button
    const unclassifiedRelay = { category: null, unitId: 'u-unclass', reason: 'no-match' };
    const liveProbeResult = winTest.FBDietProbe.buildProbeReport(
      { payload: { feedUnit: { id: 'u-unclass' } } },
      unclassifiedRelay,
      null,
      mockContainer
    );
    c.equals('unclassified relay unit becomes suggested via DOM', liveProbeResult.report.verdict.category, 'suggested');
    c.equals('unclassified relay unit keeps null initial category in proxy phase', liveProbeResult.report.proxy.initialClassify.category, undefined);
    c.equals('unclassified relay unit verdict foldMode is off when foldSuggested is false', liveProbeResult.report.verdict.foldMode, 'off');

    // 6. Classified unit (stories) is NOT overridden by DOM suggested in probe report
    const storiesRelay = { category: 'stories', unitId: 'u-stories', unitTypename: 'DiscoverFeedUnit', reason: 'unitTypename:DiscoverFeedUnit' };
    const storiesProbeResult = winTest.FBDietProbe.buildProbeReport(
      { payload: { feedUnit: { id: 'u-stories', unitTypename: 'DiscoverFeedUnit' } } },
      storiesRelay,
      null,
      mockContainer
    );
    c.equals('stories unit retains stories category despite DOM buttons', storiesProbeResult.report.verdict.category, 'stories');
    c.equals('stories unit verdict category matches proxy initial', storiesProbeResult.report.proxy.initialClassify.category, 'stories');

    // 7. Carousel navigation buttons (上一個項目, 下一個項目) are excluded from being matched as suggested buttons
    const carouselContainer = makeNode('div', { role: 'article' }, [
      makeNode('div', { role: 'button', 'aria-label': '上一個項目' }, [makeNode('svg')]),
      makeNode('div', { role: 'button', 'aria-label': '下一個項目' }, [makeNode('svg')])
    ]);
    const carouselDetection = winTest.FBDietDOMSuggested.detect(carouselContainer);
    c.equals('carousel navigation buttons are not detected as suggested', carouselDetection, null);
  }
}

module.exports = { run };
