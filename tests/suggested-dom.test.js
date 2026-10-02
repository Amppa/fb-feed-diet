'use strict';
const { Checker, createFakeReact, createWindow, loadInject, loadDefaults, loadMainWorld, createFakeComet, countMessages, flushTimers } = require('./harness');

const FEED_MODULE = 'CometFeedUnitErrorBoundary.react';

/** Simple simulated DOM node builder for unit testing DOM extractors. */
/**
 * Local node double, deliberately NOT the harness `makeNode`: this one resolves
 * space-separated descendant chains ('div[role="button"] span'), which the shared
 * double does not. Merging the two requires upgrading the harness matcher first,
 * otherwise selectors here would silently stop matching.
 */
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
  loadMainWorld(win);
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

  /* --- Retired 7: Unrecognized extra Action button in author row no longer folds --- */
  {
    // The extra-button fallback is abolished: only explicit Follow / Join semantics fold.
    // A localized action button ("訂閱頻道") is logged in buttonsFound and declined.
    const authorLink = makeNode('a', { role: 'link' }, [], 'Some Creator');
    const heading = makeNode('h4', { role: 'heading' }, [authorLink]);
    const customActionBtn = makeNode('div', { role: 'button' }, [], '訂閱頻道');
    const header = makeNode('header', {}, [heading, customActionBtn]);
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.equals('an unrecognized action button is declined', res, null);
  }

  /* --- Retired 8: Extra button with SVG icon in author row no longer folds --- */
  {
    const authorLink = makeNode('a', { role: 'link' }, [], 'Brand Page');
    const heading = makeNode('h4', { role: 'heading' }, [authorLink]);
    const svgIcon = makeNode('svg', { 'aria-hidden': 'true' }, [makeNode('path', { d: 'M10 10...' }, [])]);
    const iconOnlyBtn = makeNode('div', { role: 'button' }, [svgIcon]);
    const header = makeNode('header', {}, [heading, iconOnlyBtn]);
    const card = makeNode('div', { role: 'article' }, [header]);

    const res = detector.detect(card);
    c.equals('an icon-only button is declined', res, null);
  }

  /* --- REGRESSION: a content-surface pill is not a recommendation cue --- */
  {
    // Field report (2026-09-28, DOM-only mode): a Reels tile was folded as `suggested` with
    // reason dom:other_extra_button. Facebook draws a "Reel" pill in the author row, exactly where
    // a follow button sits, and the extra-button rule had no notion of a content surface — any
    // button with text counted. The report showed media "[🎬 影片]".
    const cardFor = (btnText, aria) => {
      const btn = makeNode('div', { role: 'button', 'aria-label': aria || '' }, [makeNode('svg', { 'aria-hidden': 'true' })], btnText || '');
      const heading = makeNode('h4', { role: 'heading' }, [makeNode('a', { role: 'link' }, [], 'Some Creator')], 'Some Creator');
      return makeNode('div', { role: 'article' }, [makeNode('header', {}, [heading, btn])]);
    };

    c.equals('a "Reel" pill is not a suggestion', detector.detect(cardFor('Reel', '')), null);
    c.equals('a lowercase "reel" pill is not a suggestion', detector.detect(cardFor('reel', '')), null);
    c.equals('a "Stories" pill is not a suggestion', detector.detect(cardFor('Stories', '')), null);
    c.equals('a 限時動態 pill is not a suggestion', detector.detect(cardFor('限時動態', '')), null);
    // The surface label can also arrive as the accessible name.
    c.equals('a "Reels and short videos" aria is not a suggestion', detector.detect(cardFor('', 'Reels and short videos')), null);

    // Without the extra-button fallback, a non-Follow/Join label declines no matter how
    // specific it reads — explicit semantics are the only thing that folds.
    c.equals('a longer non-cue label is declined', detector.detect(cardFor('Reels of my week', '')), null);
    c.ok('a real follow button is still a suggestion', Boolean(detector.detect(cardFor('追蹤', ''))));
    c.ok('a Follow aria is still a suggestion', Boolean(detector.detect(cardFor('', 'Follow'))));
  }

  /* --- REGRESSION: a horizontal tray is vetoed structurally, not by label text --- */
  {
    // Real page capture, 2026-09-28. Facebook marks every tile of a Reels / Stories tray with
    // `data-type="hscroll-child"`; the region carries aria-label "動態消息中的限時動態" and each
    // tile links to /stories/. A tile satisfies EVERY "looks like a cue" heuristic at once — an
    // author heading, a pill, a menu button — which is why excluding one rule at a time let a
    // Reels tile through (field report: dom:other_extra_button, media "[🎬 影片]").
    const mk = (tag, attrs, children, text) => makeNode(tag, attrs, children, text);

    // A tray tile carrying every cue the individual rules look for, plus the structural marker.
    const trayTile = (marker) => {
      const pill = mk('div', { role: 'button' }, [mk('svg')], 'Reel');
      const heading = mk('h3', { role: 'heading' }, [mk('a', { href: '/stories/12345/', role: 'link' }, [], 'Some Creator')], 'Some Creator');
      const inner = mk('div', {}, [pill, heading, mk('div', { role: 'button', 'aria-label': '可對此貼文採取的動作' }, [])]);
      return marker ? mk('div', { 'data-type': marker }, [inner]) : inner;
    };

    // The primary marker, on its own, with no label text at all.
    c.equals('data-type=hscroll-child vetoes the unit', detector.detect(trayTile('hscroll-child')), null);
    // A tray that renames itself: no "Reel", no "限時動態" anywhere, and still vetoed. This is the
    // case the label rule alone cannot cover — the vocabulary would have to be re-derived on every
    // rename, and a missed one silently folds the whole tray as suggested.
    const renamed = mk('div', {}, [
      mk('div', { 'data-type': 'hscroll-child' }, [
        mk('div', { role: 'button' }, [mk('svg')], 'Clip'),
        mk('h3', { role: 'heading' }, [mk('a', { href: '/reels/999/', role: 'link' }, [], 'Creator')], 'Creator')
      ])
    ]);
    c.equals('a renamed tray label is still vetoed structurally', detector.detect(renamed), null);

    // The region aria-label, without the hscroll marker.
    const regionOnly = mk('div', {}, [
      mk('div', { role: 'region', 'aria-label': '動態消息中的限時動態' }, [trayTile(null)])
    ]);
    c.equals('a stories region aria-label vetoes the unit', detector.detect(regionOnly), null);

    // A single /stories/ link with a follow button beside it: this assertion FLIPPED on
    // 2026-09-29, and the card is the reason why. It was written to pin the weak route as
    // load-bearing on its own ("narrow on purpose, a[href] only") and it did so faithfully — but a
    // lone `a[href*="/stories/"]` beside an unsubscribed author IS the story ring, and two
    // `dom`-mode field reports an hour apart showed that ring vetoing the Follow button next to it
    // (`outcome: "vetoed_as_tray", outcomeReason: "stories_link", cues: []` beside
    // `dataEngine: { category: "suggested" }`). The veto now requires a row of story links, so the
    // follow button is read and the unit is a recommendation, which is what the store said it was.
    // Kept as a regression test because the card is the exact shape that was wrong.
    const linkOnly = mk('div', {}, [
      mk('div', { role: 'button' }, [mk('svg')], '追蹤'),
      mk('h3', { role: 'heading' }, [mk('a', { href: '/stories/777/', role: 'link' }, [], 'Creator')], 'Creator')
    ]);
    c.ok('a lone /stories/ link no longer vetoes the follow button beside it', Boolean(detector.detect(linkOnly)));

    // …while the row it was standing in for still is a tray. This is the half that must not move.
    const storyRow = mk('div', {}, [
      mk('div', { role: 'button' }, [mk('svg')], '追蹤'),
      mk('h3', { role: 'heading' }, [mk('a', { href: '/stories/777/', role: 'link' }, [], 'Creator')], 'Creator'),
      mk('div', {}, [1, 2, 3].map((n) => mk('a', { href: '/stories/' + n + '/', role: 'link' }, [], '限時動態')))
    ]);
    c.equals('a row of /stories/ links is still vetoed as a tray', detector.detect(storyRow), null);

    /* --- Field report 2026-09-30: group chips on the post's own surface vetoed a joinable group post --- */
    //
    // The third instance of the same shape, after the story ring above. A post in a joinable group
    // wore four group chips on its own surface, which cleared the tray threshold, and the veto
    // suppressed the 加入 button in the byline with `cues: []`. The store called the same unit
    // `suggested` on `to.viewer_forum_join_state: CAN_JOIN`; in `dom` mode there is no store verdict to
    // fall back to, so the unit rendered as `dom:no-verdict` -> regular and stayed unfolded.
    //
    // The structural fact was never in doubt — only whether it was enough to suppress the cues. The
    // surface rules had already read the same marker and declined it for want of the group wording.
    const groupChips = mk('div', {}, [
      mk('div', { role: 'button' }, [mk('svg')], '加入'),
      mk('h3', { role: 'heading' }, [mk('a', { href: '/somegroup', role: 'link' }, [], '京都自由行究極攻略')], 'Someone'),
      mk('div', {}, ['a', 'b', 'c', 'd'].map((id) => mk('a', { href: '/groups/' + id + '/', role: 'link' }, [], '社團')))
    ]);
    const chipsHit = detector.detect(groupChips);
    c.ok('a post wearing group chips is not vetoed as a tray', Boolean(chipsHit), 'got ' + JSON.stringify(chipsHit));
    c.equals('…and the 加入 button beside them is read', chipsHit && chipsHit.reason, 'dom:join_button');
    const chipsEx = detector.explain(groupChips);
    c.ok('…and no tray veto is reported', chipsEx.outcome !== 'vetoed_as_tray', 'got ' + chipsEx.outcome);
    c.equals('…while the cues are evaluated as normal', chipsEx.outcome, 'detected');

    // …and the row it was standing in for is still a tray. A count that cleared the threshold by
    // accident is the defect; a group carousel that names itself is the rule. The wording has to sit
    // where the surface reader looks for it — a label-shaped control, not a bare span.
    const groupRow = mk('div', {}, [
      mk('div', { role: 'button' }, [mk('svg')], '加入'),
      mk('h3', { role: 'heading' }, [mk('a', { href: '/somegroup', role: 'link' }, [], 'Someone')], 'Someone'),
      mk('div', { role: 'button', 'aria-label': '移除示範社團的社團建議' }, [], '移除'),
      mk('div', {}, ['a', 'b', 'c', 'd'].map((id) => (
        mk('a', { href: '/groups/' + id + '/', role: 'link' }, [], '社團')
      )))
    ]);
    c.equals('a named group carousel is still vetoed as a tray', detector.detect(groupRow), null);
    c.equals('…naming the marker that vetoed it', detector.explain(groupRow).outcomeReason, 'groups_carousel');

    // A normal post with a story link inside a COMMENT must not be swept up: the rule only reads
    // a[href], so text elsewhere cannot trigger it.
    const postWithStoryInComment = mk('div', { role: 'article' }, [
      mk('header', {}, [mk('h3', { role: 'heading' }, [mk('a', { href: '/someone', role: 'link' }, [], 'A Friend')], 'A Friend')]),
      mk('div', {}, [], 'I watched his story yesterday, it was great')
    ]);
    c.ok('a post mentioning a story in text is unaffected', detector.detect(postWithStoryInComment) === null);

    // And the real cue still works: a plain post with a follow button is still a recommendation.
    const followPost = mk('div', { role: 'article' }, [
      mk('header', {}, [mk('h3', { role: 'heading' }, [mk('a', { href: '/brand', role: 'link' }, [], 'Brand')], 'Brand'), mk('div', { role: 'button' }, [], '追蹤')])
    ]);
    c.ok('a real follow button is still detected', Boolean(detector.detect(followPost)));
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

  /* --- Integration: dom mode wraps regular units with display: contents, relay stays untouched --- */
  {
    const React = createFakeReact();
    const winTest = createWindow();
    winTest.FB_DIET_DEFAULTS = loadDefaults();
    const comet = createFakeComet(winTest, React);

    loadInject(winTest, 'comet.js');
    loadInject(winTest, 'relay-metadata.js');
    loadInject(winTest, 'relay-classify.js');
    loadInject(winTest, 'bridge.js');
    loadInject(winTest, 'dom-surface.js');
    loadInject(winTest, 'dom-suggested.js');
    loadInject(winTest, 'ui.js');
    loadInject(winTest, 'probe-popup.js');
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

    // 1. relay mode: unclassified unit returns raw element untouched without fb-diet-full-container
    winTest.FBDietBridge.setSettings({ dietMode: 'relay', enabled: true, alwaysShowFoldBar: false });
    const liteResult = renderUnit({ feedUnit: { id: 'u-lite', __typename: 'Story' } });
    c.ok('relay mode returns raw element without full-container wrapper', liteResult && liteResult.__source === true);

    // 2. dom mode: unclassified unit is wrapped in fb-diet-full-container with display: contents
    winTest.FBDietBridge.setSettings({ dietMode: 'dom', enabled: true, foldSuggested: true, alwaysShowFoldBar: false });
    const fullResult = renderUnit({ feedUnit: { id: 'u-full', __typename: 'Story' } });
    c.ok('dom mode wraps unclassified unit in fb-diet-full-container', Boolean(fullResult) && fullResult.props && fullResult.props.className === 'fb-diet-full-container');
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
      { category: 'suggested', signal: 'Follow', unitId: 'u-probe', reason: 'dom:follow_button', source: 'dom_scanner', domEvidence: { isSuggested: true, signal: 'Follow', reason: 'dom:follow_button', text: '· 追蹤', debug: { author: 'Heaven Raven' } }, evidence: { ownTypename: 'Story' } },
      null,
      mockContainer
    );
    const probeReport = probeResult && probeResult.report;
    c.ok('probe report includes dom.extracted.suggested', Boolean(probeReport && probeReport.dom && probeReport.dom.extracted && probeReport.dom.extracted.suggested));
    c.equals('probe report dom suggested reason matches', probeReport.dom.extracted.suggested.reason, 'dom:follow_button');
    c.equals('probe report verdict category is suggested', probeReport.verdict.category, 'suggested');
    c.equals('probe report initialClassify signal is Follow', probeReport.relay.initialClassify.signal, 'Follow');
    c.equals('probe report verdict reason is dom:follow_button', probeReport.verdict.reason, 'dom:follow_button');
    c.equals('probe report verdict detectionSource is dom_scanner', probeReport.verdict.detectionSource, 'dom_scanner');
    c.equals('probe report evidence includes domSignal', probeReport.relay.initialClassify.evidence.domSignal, '· 追蹤');
    c.ok('probe report includes suggested debug', Boolean(probeReport.dom.extracted.suggested.debug));
    // 4. dom mode wraps unclassified unit even when foldSuggested is false
    winTest.FBDietBridge.setSettings({ dietMode: 'dom', enabled: true, foldSuggested: false, alwaysShowFoldBar: false });
    const fullResultFoldOff = renderUnit({ feedUnit: { id: 'u-full-off', __typename: 'Story' } });
    c.ok('dom mode wraps unclassified unit even when foldSuggested is false', Boolean(fullResultFoldOff) && fullResultFoldOff.props && fullResultFoldOff.props.className === 'fb-diet-full-container');

    // 5. Probe report retains render-time verdict while reporting live DOM observation
    const unclassifiedRelay = { category: null, unitId: 'u-unclass', reason: 'dom:no-verdict', source: 'dom', display: { category: 'regular', substituted: true } };
    const liveProbeResult = winTest.FBDietProbe.buildProbeReport(
      { payload: { feedUnit: { id: 'u-unclass' } } },
      unclassifiedRelay,
      null,
      mockContainer
    );
    c.equals('unclassified unit keeps null initial category in relay phase', liveProbeResult.report.relay.initialClassify.category, undefined);
    c.equals('unclassified unit retains undecided verdict category as regular', liveProbeResult.report.verdict.category, 'regular');
    c.equals('unclassified unit retains render reason', liveProbeResult.report.verdict.reason, 'dom:no-verdict');
    c.equals('unclassified unit retains render detectionSource', liveProbeResult.report.verdict.detectionSource, 'dom');
    c.equals('unclassified unit verdict foldMode is off when foldSuggested is false', liveProbeResult.report.verdict.foldMode, 'off');
    c.ok('live follow button is still reported under dom.extracted', Boolean(liveProbeResult.report.dom && liveProbeResult.report.dom.extracted && liveProbeResult.report.dom.extracted.suggested && liveProbeResult.report.dom.extracted.suggested.isSuggested));

    // 6. Classified unit (stories) is NOT overridden by DOM suggested in probe report
    // A store verdict is what `relay` mode produces, so the mode is set before the report is
    // built — `skippedDataEngine` is read from the settings at build time.
    winTest.FBDietBridge.setSettings({ dietMode: 'relay', enabled: true });
    const storiesRelay = { category: 'stories', unitId: 'u-stories', unitTypename: 'DiscoverFeedUnit', reason: 'unitTypename:DiscoverFeedUnit', source: 'relay' };
    const storiesProbeResult = winTest.FBDietProbe.buildProbeReport(
      { payload: { feedUnit: { id: 'u-stories', unitTypename: 'DiscoverFeedUnit' } } },
      storiesRelay,
      null,
      mockContainer
    );
    c.equals('stories unit retains stories category despite DOM buttons', storiesProbeResult.report.verdict.category, 'stories');
    c.equals('stories unit verdict category matches relay initial', storiesProbeResult.report.relay.initialClassify.category, 'stories');
    // The DOM buttons in that fixture must not be credited with the verdict: the classifier
    // already settled the category, so the report says so instead of claiming a fallback.
    c.equals('a classifier-decided category is attributed to the store', storiesProbeResult.report.verdict.detectionSource, 'relay');

    // 7. Carousel navigation buttons (上一個項目, 下一個項目) are excluded from being matched as suggested buttons
    const carouselContainer = makeNode('div', { role: 'article' }, [
      makeNode('div', { role: 'button', 'aria-label': '上一個項目' }, [makeNode('svg')]),
      makeNode('div', { role: 'button', 'aria-label': '下一個項目' }, [makeNode('svg')])
    ]);
    const carouselDetection = winTest.FBDietDOMSuggested.detect(carouselContainer);
    c.equals('carousel navigation buttons are not detected as suggested', carouselDetection, null);

    // 8. TitleBar scan invokes onSuggestedDetected callback when regular unit contains suggestion in DOM
    let detectedSignal = null;
    let notifyCount = 0;
    const barNode = makeNode('div', { className: 'fb-diet-title-bar' });
    const postNode = makeNode('div', { className: 'fb-diet-expand-body' }, [
      makeNode('header', {}, [
        makeNode('h4', { role: 'heading' }, [makeNode('a', {}, [], '國立臺灣大學昆蟲學系')]),
        makeNode('div', { role: 'button' }, [], '· Follow')
      ])
    ]);
    barNode.nextElementSibling = postNode;

    const origDetect = winTest.FBDietDOMSuggested.detect;
    let detectCalls = 0;
    winTest.FBDietDOMSuggested.detect = (el) => {
      detectCalls += 1;
      return origDetect(el);
    };
    const timersBefore = winTest.__timers.length;

    React.resetHooks();
    const origUseRef = React.useRef;
    React.useRef = () => ({ current: barNode });
    winTest.FBDietUI.TitleBar({
      category: 'regular',
      unitId: 'u-titlebar-suggested',
      showTitle: true,
      onSuggestedDetected: (det) => {
        notifyCount += 1;
        detectedSignal = det && det.signal;
      }
    });
    React.useRef = origUseRef;
    c.equals('title bar scan invokes onSuggestedDetected for regular unit with follow button', detectedSignal, 'Follow');
    c.equals('the first scan notifies exactly once', notifyCount, 1);

    // The streaming-post retry ladder keeps scanning after that; the notification, and the
    // detector sweep behind it, must stay one-shot.
    const titleTimers = winTest.__timers.slice(timersBefore);
    c.ok('title bar armed its scan ladder and observer timeout', titleTimers.length >= 6);
    c.equals(
      'the retry ladder ran all of its scans',
      flushTimers(winTest, (timer) => titleTimers.indexOf(timer) !== -1),
      titleTimers.length
    );
    c.equals('later scans do not notify onSuggestedDetected again', notifyCount, 1);
    c.equals('later scans do not sweep the DOM detector again', detectCalls, 1);
    winTest.FBDietDOMSuggested.detect = origDetect;

    // 8b. Lite passes allowDomScan=false (STRATEGY.md decision #36): the title is rendered from
    // Relay data, so the bar must not sweep the subtree, notify the detector, or arm its ladder.
    const liteDetectCallsBefore = detectCalls;
    let liteNotify = 0;
    const liteBarNode = makeNode('div', { className: 'fb-diet-title-bar' });
    const litePostNode = makeNode('div', { className: 'fb-diet-expand-body' }, [
      makeNode('header', {}, [
        makeNode('h4', { role: 'heading' }, [makeNode('a', {}, [], '國立臺灣大學昆蟲學系')]),
        makeNode('div', { role: 'button' }, [], '· Follow')
      ])
    ]);
    liteBarNode.nextElementSibling = litePostNode;

    winTest.FBDietDOMSuggested.detect = (el) => {
      detectCalls += 1;
      return origDetect(el);
    };
    const timersBeforeLite = winTest.__timers.length;
    React.resetHooks();
    const origUseRefLite = React.useRef;
    React.useRef = () => ({ current: liteBarNode });
    const liteBar = winTest.FBDietUI.TitleBar({
      category: 'regular',
      unitId: 'u-titlebar-lite',
      showTitle: true,
      allowDomScan: false,
      onSuggestedDetected: () => { liteNotify += 1; }
    });
    React.useRef = origUseRefLite;
    winTest.FBDietDOMSuggested.detect = origDetect;

    c.ok('allowDomScan false still renders the title bar', Boolean(liteBar));
    c.equals('allowDomScan false never sweeps the DOM suggested detector', detectCalls, liteDetectCallsBefore);
    c.equals('allowDomScan false never notifies onSuggestedDetected', liteNotify, 0);
    c.equals('allowDomScan false arms no scan ladder or observer timeout', winTest.__timers.length, timersBeforeLite);

    // 9. A module-table category is not credited to the probe-time DOM fallback
    const entryProbeResult = winTest.FBDietProbe.buildProbeReport(
      { entryCategory: 'stories', payload: { feedUnit: { id: 'u-entry' } } },
      null,
      null,
      mockContainer
    );
    c.equals('module-table unit keeps its category', entryProbeResult.report.verdict.category, 'stories');
    c.equals('module-table unit reports no verdict source', entryProbeResult.report.verdict.detectionSource, undefined);
    c.ok(
      'the live DOM hit is still reported as evidence',
      Boolean(entryProbeResult.report.dom.extracted.suggested) && entryProbeResult.report.dom.extracted.suggested.isSuggested === true
    );
  }

  /* --- a tray marker buried inside a post is not the post's own surface --- */
  //
  // A real field report on 2026-09-28 showed a friend's 26-photo post being vetoed as a Reels tray.
  // `data-type="hscroll-child"` means "this thing scrolls sideways", and Facebook uses it for
  // carousels inside ordinary posts as well as for feed trays. querySelector matches at any depth,
  // so the first version of the veto read a comment's carousel as the unit being a tray — trading
  // a false positive for a false negative, which is the same bug with the sign flipped.
  {
    // The unit is an ordinary post. Deep inside its message sits a sideways-scrolling widget.
    const innerCarousel = makeNode('div', { 'data-type': 'hscroll-child' }, [
      makeNode('div', { role: 'button' }, [makeNode('svg')], '限時動態')
    ]);
    const photoPost = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [
        makeNode('h3', { role: 'heading' }, [makeNode('a', { href: '/user/', role: 'link' }, [], 'Someone')], 'Someone')
      ]),
      makeNode('div', { 'data-ad-preview': 'message' }, [innerCarousel])
    ]);

    c.equals('a carousel inside a post message is not the post being a tray', detector.detect(photoPost), null);
    const ex = detector.explain(photoPost);
    c.equals('…and is reported as a standalone post', ex.surface, 'standalone_post');
    c.equals('…not vetoed', ex.outcome, 'no_cue_matched');

    // The same widget in a quoted post is equally not the unit's own surface.
    const quoted = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [
        makeNode('h3', { role: 'heading' }, [makeNode('a', { href: '/user/', role: 'link' }, [], 'Someone')], 'Someone'),
        makeNode('div', { 'data-ad-preview': 'message_container' }, [
          makeNode('div', { role: 'article' }, [innerCarousel])
        ])
      ])
    ]);
    c.equals('a carousel inside a quoted post is not a tray either', detector.detect(quoted), null);

    // The genuine case still works: the marker on the unit's own surface, above the message.
    const realTray = makeNode('div', { role: 'article' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [
        makeNode('header', {}, [
          makeNode('h3', { role: 'heading' }, [makeNode('a', { href: '/stories/1/', role: 'link' }, [], 'Author')], 'Author'),
          makeNode('div', { role: 'button' }, [makeNode('svg')], '限時動態')
        ])
      ])
    ]);
    c.equals('a marker on the unit own surface still vetoes', detector.explain(realTray).outcome, 'vetoed_as_tray');
  }

  /* --- Field report 2026-09-29: a story RING vetoed the post it sits on ---
   *
   * Two independent captures an hour apart, both `dom` mode, both a plain Story the store called
   * `suggested` (`actors[0].subscribe_status: CAN_SUBSCRIBE`) and both rendered `regular` with
   * `dom:no-verdict`. Both reported the same thing:
   *
   *   suggested: { outcome: "vetoed_as_tray", outcomeReason: "stories_link", surface: "tray",
   *                cues: [] }
   *
   * The `cues: []` is the whole story. The veto runs before the cues, so the Follow button in
   * the header was never even read — and there IS one: the author is unsubscribed, and the byline
   * carries 追蹤. What the veto actually saw was the story ring drawn around the avatar:
   *
   *   <a aria-label="左岸咖啡誌，查看限時動態" href="/stories/900000000000000011/…"
   *      role="link"><svg aria-label="左岸咖啡誌，查看限時動態" …></a>
   *
   * One `a[href*="/stories/"]`, on the unit's own surface, passing every own-surface test — which
   * is pitfall 11 exactly, reached from the other side. Decision #41 narrowed the *decision* path
   * for this and deliberately left the *veto* path on the weak signal, reasoning that a false
   * tray there costs one missed fold rather than a wrong fold.
   *
   * That cost model was right about the direction — the Golden Rule prefers a missed fold — and
   * it is why this was never a crash. But it was not a rare edge: a story ring is drawn on *any*
   * post by an author with a live story, which is most posts in an active feed, and the veto does
   * not merely decline the unit, it suppresses the very cue that would have classified it. Two
   * reports in one session is the sample that says the trade is no longer worth its price.
   *
   * The discriminator was already written down, in the same function, for the decision path:
   * "A ring is one link; a tray is a row of tiles." The veto now applies it too.
   */
  {
    const storyRing = (author, id) => makeNode(
      'a',
      { role: 'link', 'aria-label': author + '，查看限時動態', href: '/stories/' + id + '/UzpfSVNDOjkwMDAwMDAwMDAwMDAwMDA=/?view_single=false' },
      [makeNode('svg', { role: 'img', 'aria-label': author + '，查看限時動態' }, [])]
    );

    // The captured unit: the ring on the avatar, then the author heading carrying an unsubscribed
    // author and a 追蹤 button. The ring is a sibling of the byline, not inside it.
    const ringed = makeNode('div', { role: 'article' }, [
      makeNode('div', {}, [makeNode('span', {}, [storyRing('左岸咖啡誌', '900000000000000011')])]),
      makeNode('header', {}, [
        makeNode('div', { 'data-ad-rendering-role': 'profile_name' }, [
          makeNode('h4', {}, [
            makeNode('span', {}, [makeNode('a', { role: 'link', href: 'https://www.facebook.com/profile.php?id=90000000000002' }, [], '左岸咖啡誌')]),
            makeNode('span', {}, [
              makeNode('span', {}, [makeNode('span', { 'aria-hidden': 'true' }, [], ' · ')]),
              makeNode('div', { role: 'button', tabindex: '0' }, [makeNode('span', {}, [], '追蹤')])
            ])
          ])
        ])
      ]),
      makeNode('div', { 'data-ad-preview': 'message' }, [makeNode('div', {}, [], 'Arnault 家族簡化 LVMH 股權架構')])
    ]);

    c.equals('a lone story ring is not what stopped the unit', detector.explain(ringed).surface, 'standalone_post');
    const ex = detector.explain(ringed);
    c.equals('…and the veto is not what stopped it', ex.outcomeReason !== 'stories_link', true);
    c.ok('…so the header cues actually ran', ex.cues.length > 0, 'cues: ' + JSON.stringify(ex.cues));
    // The byline's 追蹤 button is the cue, and it is what the veto used to suppress.
    const ringedHit = detector.detect(ringed);
    c.ok('…and the Follow button in the byline is read', Boolean(ringedHit));
    c.equals('…naming the cue that decided it', ringedHit && ringedHit.reason, 'dom:follow_button');

    // The genuine case the veto exists for still works, and it no longer needs the structural
    // marker to reach it: three tiles, each linking to its own story, is a row.
    const trayWithoutMarker = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [
        makeNode('h3', { role: 'heading' }, [makeNode('a', { href: '/stories/1/', role: 'link' }, [], 'Author')], 'Author'),
        makeNode('div', { role: 'button' }, [makeNode('svg')], '限時動態')
      ]),
      makeNode('div', {}, [1, 2, 3].map((n) => makeNode('div', { 'data-type': 'tile' }, [
        makeNode('a', { role: 'link', href: '/stories/' + n + '/' }, [], '限時動態'),
        makeNode('div', { role: 'button' }, [makeNode('span', {}, [], '追蹤')])
      ])))
    ]);
    c.equals('a row of story tiles is still vetoed as a tray', detector.explain(trayWithoutMarker).outcomeReason, 'stories_link');

    // One ring plus a story link the poster typed in the message is still one link, not a row.
    // The own-surface guard is what makes that true, and it is the same guard pitfall 9 forced on
    // the hscroll marker.
    const ringPlusBodyLink = makeNode('div', { role: 'article' }, [
      makeNode('div', {}, [storyRing('Kevin West', '9000000000000002')]),
      makeNode('header', {}, [makeNode('h4', {}, [makeNode('a', { role: 'link', href: '/kevin.west.779' }, [], 'Kevin West')])]),
      makeNode('div', { 'data-ad-preview': 'message' }, [
        makeNode('div', {}, [], 'see my'),
        makeNode('a', { role: 'link', href: '/stories/999/abc/' }, [], 'story'),
        makeNode('div', {}, [makeNode('div', { role: 'button' }, [], '查看更多')])
      ])
    ]);
    c.equals('a ring plus a story link in the body is still not a tray', detector.explain(ringPlusBodyLink).surface, 'standalone_post');
  }

  /* --- explain(): the diagnostics a real page needs --- */
  // A null verdict and a detector that was never asked look identical in a field report, and that
  // ambiguity is the whole reason the real-page sessions stalled: "regular" could mean the DOM saw
  // nothing, or that it saw plenty and every rule declined. `explain` names the outcome, and
  // reuses the scan helpers rather than re-deriving the rules so it cannot drift from `detect`.
  {
    const trayCard = makeNode('div', { role: 'article' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [
        makeNode('header', {}, [
          makeNode('h3', { role: 'heading' }, [makeNode('a', { href: '/stories/123/', role: 'link' }, [], 'Author')], 'Author'),
          // A pill exactly like a follow button's — the reason the tray was being misread at all.
          makeNode('div', { role: 'button' }, [makeNode('svg')], '限時動態')
        ])
      ])
    ]);
    const trayEx = detector.explain(trayCard);
    c.equals('a Stories tray is reported as a tray', trayEx.surface, 'tray');
    c.equals('…and vetoed as one', trayEx.outcome, 'vetoed_as_tray');
    c.equals('…naming the marker that vetoed it', trayEx.outcomeReason, 'hscroll_child');
    // The veto runs before the cues, so none may be reported as evaluated.
    c.equals('…with no cue evaluated', trayEx.cues.length, 0);

    // The plain-post case, which is what a report shows for almost every unit: scanned, author
    // read, every cue accounted for and declined. Before this, all a report could say was "regular".
    // The action row (Like / Comment / Share) is deliberately outside the header scope, because
    // Facebook draws it as a sibling of the byline rather than inside it.
    const plainCard = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [
        makeNode('h3', { role: 'heading' }, [makeNode('a', { href: '/user/', role: 'link' }, [], 'Someone')], 'Someone')
      ]),
      makeNode('div', {}, [makeNode('span', {}, [], 'Just an ordinary post.')]),
      makeNode('div', {}, [makeNode('div', { role: 'button' }, [], 'Like')])
    ]);
    const plainEx = detector.explain(plainCard);
    c.equals('a plain post is scanned', plainEx.scanned, true);
    c.equals('…as a standalone post, not a tray', plainEx.surface, 'standalone_post');
    c.equals('…with every cue declined', plainEx.outcome, 'no_cue_matched');
    c.equals('…and the author it read', plainEx.primaryAuthor, 'Someone');
    c.equals('…listing every cue it checked', plainEx.cues.map((x) => x.cue).join(','), 'aria_keyword,header_keyword,follow_or_join,extra_button,pre_message_label');

    // The diagnostic must describe the decision the scanner actually made. If these ever diverge,
    // the report is lying about the verdict it claims to explain.
    const followCard = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [
        makeNode('h3', { role: 'heading' }, [makeNode('a', { href: '/user/', role: 'link' }, [], 'Someone')], 'Someone'),
        makeNode('div', { role: 'button' }, [makeNode('svg')], '追蹤')
      ])
    ]);
    c.equals('explain and detect agree on a real follow button', detector.detect(followCard).reason, 'dom:follow_button');
    c.equals('…and explain names that same reason', detector.explain(followCard).outcomeReason, 'dom:follow_button');

    c.equals('explain survives a null container', detector.explain(null).outcome, 'not_scanned');
    c.equals('…naming why', detector.explain(null).outcomeReason, 'no_container');

    // A container whose querySelector throws is the realistic breakage: a detached node on a real
    // page, a half-mocked double in a test. It must be reported, not propagated into the report.
    const brokenEx = detector.explain({ querySelector: () => { throw new Error('detached'); } });
    c.equals('a throwing container is reported, not propagated', brokenEx.outcome, 'scan_error');
  }

  /* --- The shared surface module is a hard dependency, and its absence is a named decline ---
   * The tray veto and the reshare exclusion now live in dom-surface.js. Without them every tile of a
   * Reels tray satisfies the cue heuristics, so a detector that carried on would fold a Reel as a
   * suggestion (STRATEGY.md, misclassification 8) — the exact bug the veto exists to prevent.
   * Declining is therefore the safe answer, and the report must name the missing dependency rather
   * than look like a clean scan.
   */
  {
    const trayCard = makeNode('div', { role: 'article' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [
        makeNode('h3', {}, [], 'A Page'),
        makeNode('div', { role: 'button' }, [], '追蹤')
      ])
    ]);

    const savedSurface = win.FBDietDOMSurface;
    delete win.FBDietDOMSurface;
    c.equals('the detector refuses to guess without the tray walk', detector.detect(trayCard), null);
    const declined = detector.explain(trayCard);
    c.equals('…naming the missing dependency', declined.outcomeReason, 'surface_module_missing');
    c.equals('…and reporting that it never scanned', declined.scanned, false);

    win.FBDietDOMSurface = savedSurface;
    const vetoed = detector.explain(trayCard);
    c.equals('the same card is vetoed as a tray once the module is back', vetoed.outcome, 'vetoed_as_tray');
    c.equals('…and still produces no suggested hit', detector.detect(trayCard), null);
  }
}

module.exports = { run };
