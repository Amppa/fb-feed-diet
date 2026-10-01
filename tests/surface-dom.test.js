'use strict';
/**
 * Tests for the positive half of src/inject/dom-surface.js
 *
 * The DOM-only pipeline decides `reels`, `stories` and `suggestedGroup` from mounted markup, so
 * every one of these cases is a rule that could fold a real post. The negatives are therefore the
 * load-bearing tests: each one is a misclassification STRATEGY.md already records, re-stated as
 * "and the DOM must not make this mistake either".
 *
 * The last section is the lifecycle contract: the surface scanner is armed only in the mode that
 * consults it, so the daily modes pay for a DOM scan they do not spend.
 */
const {
  Checker,
  createWindow,
  createFakeReact,
  createFakeComet,
  loadInject,
  loadDefaults,
  makeNode,
  flushTimers
} = require('./harness');

const FEED_MODULE = 'CometFeedUnitErrorBoundary.react';

function run(c) {
  const win = createWindow();
  win.FB_DIET_DEFAULTS = loadDefaults();
  loadInject(win, 'dom-surface.js');
  const detector = win.FBDietDOMSurface;

  c.ok('surface module exposed on window', Boolean(detector) && typeof detector.detect === 'function');
  c.ok('surface module explains itself', detector && typeof detector.explain === 'function');

  /* --- Edge cases --- */
  c.equals('null container returns null', detector.detect(null), null);
  c.equals('object without querySelector returns null', detector.detect({}), null);
  c.equals('explain names the missing container', detector.explain(null).outcomeReason, 'no_container');

  /* --- The unit from the first DOM-only field report: a Reels tray tile whose H3 says "Reel" --- */
  {
    const pill = makeNode('h3', {}, [], 'Reel');
    const tile = makeNode('div', { 'data-type': 'hscroll-child' }, [pill]);
    const card = makeNode('div', { role: 'article' }, [tile]);
    const res = detector.detect(card);
    c.ok('a Reels tray tile is decided as reels', Boolean(res) && res.category === 'reels');
    c.equals('reason is the tray + label rule', res && res.reason, 'dom:reels_tray_label');
    c.equals('the hit is flagged for the scanner contract', res && res.isSurface, true);
    c.equals('the tray marker is recorded', res && res.debug.tray, 'hscroll_child');
  }

  /* --- Tray + href, no rendered label (a renamed or icon-only tray still decides) --- */
  {
    const tile = makeNode('div', { 'data-type': 'hscroll-child' }, [
      makeNode('a', { role: 'link', href: 'https://www.facebook.com/reel/9876543/' }, [], '')
    ]);
    const card = makeNode('div', { role: 'article' }, [tile]);
    const res = detector.detect(card);
    c.ok('tray plus reel href decides reels without any label', Boolean(res) && res.category === 'reels');
    c.equals('reason is the tray + link rule', res && res.reason, 'dom:reels_tray_link');
  }

  /* --- Stories tray, from the real capture (region label + /stories/ links) --- */
  {
    const region = makeNode('div', { role: 'region', 'aria-label': '動態消息中的限時動態' }, [
      makeNode('a', { role: 'link', href: 'https://www.facebook.com/stories/123/456' }, [], '')
    ]);
    const card = makeNode('div', { role: 'article' }, [region]);
    const res = detector.detect(card);
    c.ok('the stories tray is decided as stories', Boolean(res) && res.category === 'stories');
    c.equals('tray marker is the region', res && res.debug.tray, 'tray_region');
    c.equals('reason is the tray + link rule', res && res.reason, 'dom:stories_tray_link');
  }

  /* --- Stories named only by a per-tile pill, inside a horizontal tray --- */
  {
    const tile = makeNode('div', { 'data-type': 'hscroll-child' }, [makeNode('h3', {}, [], '限時動態')]);
    const card = makeNode('div', { role: 'article' }, [tile]);
    const res = detector.detect(card);
    c.ok('a stories label on the unit surface decides stories', Boolean(res) && res.category === 'stories');
    c.equals('reason is the tray + label rule', res && res.reason, 'dom:stories_tray_label');
  }

  /* --- The author's story ring: one /stories/ link in the header is not a tray (2026-09-28) --- */
  //
  // What the two wrong field reports actually were: a poster with a live story wears a coloured ring
  // on the avatar, and the ring's href is `/stories/<author id>/…`. It sits in the unit's own header,
  // so it passes every own-surface test — which is how a post the store called `regular` and one it
  // called `suggested` both came back as `dom:stories_tray_link` and got folded.
  {
    const ring = makeNode('a', { href: 'https://www.facebook.com/stories/900000000000003/' }, [
      makeNode('img', { src: 'avatar.jpg' }, [], '')
    ], '');
    const header = makeNode('div', {}, [ring]);
    const body = makeNode('div', { dir: 'auto' }, [], '專業維修，30 分鐘取件');
    const card = makeNode('div', { role: 'article' }, [header, body]);
    c.equals('a story ring alone decides nothing', detector.detect(card), null);
    const exp = detector.explain(card);
    c.equals('…and says it found no surface evidence', exp.outcomeReason, 'no_surface_evidence');
    c.equals('…naming no tray', exp.tray, null);
    c.equals('…with the ring counted out of the link total', exp.links.stories, 0);
  }

  /* --- The same ring on a unit that IS a Reels tray --- */
  {
    // Excluding the ring from the tray alone would not be enough: read as Stories *evidence* it would
    // collide with the Reels label, `ambiguous_surface` would decline the unit, and the tile would go
    // unfolded — a different mistake from the user's, from the same cause.
    const ring = makeNode('a', { href: 'https://www.facebook.com/stories/900000000000003/' }, [], '');
    const tile = makeNode('div', { 'data-type': 'hscroll-child' }, [
      makeNode('h3', {}, [], 'Reel'),
      makeNode('a', { role: 'link', href: 'https://www.facebook.com/reel/9876543/' }, [], '')
    ]);
    const card = makeNode('div', { role: 'article' }, [ring, tile]);
    const res = detector.detect(card);
    c.ok('a Reels tray wearing a ring is still reels', Boolean(res) && res.category === 'reels');
    c.equals('…decided by the tray label', res && res.reason, 'dom:reels_tray_label');
    c.equals('…and the ring adds no Stories link', res && res.debug.links.stories, 0);
    c.equals('…so no second surface claims the unit', res && res.debug.labels.stories, null);
  }

  /* --- The scope is a scope, not a ban: a real tray keeps its own tile links --- */
  {
    const ring = makeNode('a', { href: 'https://www.facebook.com/stories/900000000000003/' }, [], '');
    const region = makeNode('div', { role: 'region', 'aria-label': '動態消息中的限時動態' }, [
      makeNode('a', { role: 'link', href: 'https://www.facebook.com/stories/123/456' }, [], ''),
      makeNode('a', { role: 'link', href: 'https://www.facebook.com/stories/123/789' }, [], '')
    ]);
    const card = makeNode('div', { role: 'article' }, [ring, region]);
    const res = detector.detect(card);
    c.ok('the stories tray is still decided as stories', Boolean(res) && res.category === 'stories');
    c.equals('…counting only the links inside it', res && res.debug.links.stories, 2);
  }

  /* --- Groups-you-might-like tray: the surface the data engine calls suggestedGroup --- */
  {
    const region = makeNode('div', { role: 'region', 'aria-label': 'Groups you might like' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [
        makeNode('span', { role: 'button' }, [], '加入')
      ])
    ]);
    const card = makeNode('div', { role: 'article' }, [region]);
    const res = detector.detect(card);
    c.ok('the group tray is decided as suggestedGroup', Boolean(res) && res.category === 'suggestedGroup');
    c.equals('reason is the group tray rule', res && res.reason, 'dom:group_tray');
  }

  /* --- A single Reel outside any tray needs BOTH its pill and its link --- */
  {
    const card = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [
        makeNode('h3', {}, [], 'Reel'),
        makeNode('a', { role: 'link', href: 'https://www.facebook.com/reels/42/' }, [], '')
      ])
    ]);
    const res = detector.detect(card);
    c.ok('standalone reel with pill and link decides reels', Boolean(res) && res.category === 'reels');
    c.equals('reason is the standalone rule', res && res.reason, 'dom:reels_pill_link');
  }

  /* --- pitfall 9 regression: a carousel buried in the post body is not a tray --- */
  {
    const carousel = makeNode('div', { 'data-type': 'hscroll-child' }, [
      makeNode('a', { role: 'link', href: 'https://www.facebook.com/reel/1/' }, [], '')
    ]);
    const card = makeNode('div', { role: 'article' }, [
      makeNode('div', { 'data-ad-preview': 'message' }, [
        makeNode('span', {}, [], 'Check this reel'),
        carousel
      ])
    ]);
    c.equals('a deep carousel does not decide anything', detector.detect(card), null);
    c.equals('…and the report says why', detector.explain(card).outcomeReason, 'no_surface_evidence');
  }

  /* --- misclassification 3, DOM form: a friend's share of a reel stays a regular post --- */
  {
    const quoted = makeNode('div', { 'data-ad-preview': 'attachment' }, [
      makeNode('h3', {}, [], 'Reel'),
      makeNode('a', { role: 'link', href: 'https://www.facebook.com/reel/77/' }, [], '')
    ]);
    const card = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [makeNode('h2', {}, [], 'A Friend')]),
      quoted
    ]);
    c.equals('a quoted reel inside an attachment decides nothing', detector.detect(card), null);
    c.equals('…and is not even read as a tray', detector.explain(card).tray, null);
  }

  /* --- One signal alone is never enough --- */
  {
    const labelOnly = makeNode('div', { role: 'article' }, [makeNode('h3', {}, [], 'Reel')]);
    c.equals('a pill with no tray and no link decides nothing', detector.detect(labelOnly), null);
    c.equals('…naming the missing half', detector.explain(labelOnly).outcomeReason, 'standalone_needs_label_and_link');

    const linkOnly = makeNode('div', { role: 'article' }, [
      makeNode('a', { role: 'link', href: 'https://www.facebook.com/reel/5/' }, [], '')
    ]);
    c.equals('a link with no tray and no label decides nothing', detector.detect(linkOnly), null);
  }

  /* --- Two surfaces claiming one unit is an ambiguity, not a tie to break --- */
  {
    const card = makeNode('div', { role: 'article' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [
        makeNode('h3', {}, [], 'Reel'),
        makeNode('a', { role: 'link', href: 'https://www.facebook.com/stories/9/9' }, [], '')
      ])
    ]);
    c.equals('reels and stories evidence together decides nothing', detector.detect(card), null);
    c.equals('…and says it was ambiguous', detector.explain(card).outcomeReason, 'ambiguous_surface');
  }

  /* --- Field report 2026-09-29: the real "你的社團建議" tray, which no existing marker sees ---
   *
   * The tray above is the shape the rule was written against and not the shape Facebook ships.
   * The real one has NEITHER `data-type="hscroll-child"` NOR a `role="region"`: its tiles are
   * plain `<li>` in a `<ul>`, and the carousel is a bare `<div aria-label="為你推薦">`. The arrows
   * are absolutely-positioned divs. So `findStructuralTray` returned null, the surface rules
   * declined, and the suggested detector — which can only veto a tray it can see — fell through to
   * its own `aria_keyword` on that same `為你推薦` and classified the unit `suggested`. The store
   * called it `suggestedGroup`. A group-suggestion tray folding as a recommendation is wrong in the
   * one direction that hides a tray the user can see whole.
   */
  {
    const GROUP_TRAY = [
      ['samplegroup1', '示範社團一號'],
      ['9000000000000101', '示範社團二號'],
      ['9000000000000102', '示範社團三號'],
      ['9000000000000103', '示範社團四號']
    ];

    const groupCard = (id, name) => makeNode('div', {}, [
      makeNode('a', { role: 'link', href: 'https://www.facebook.com/groups/' + id + '/' }, [], ''),
      makeNode('a', { role: 'link', href: 'https://www.facebook.com/groups/' + id + '/' }, [], name),
      makeNode('div', { role: 'button', 'aria-label': '加入社團' }, [], '加入社團'),
      // The live markup carries the tray's own wording in this control's accessible name, and the
      // narrow LABEL_SELECTOR reaches it. The header `<span>` that says the same thing does not
      // carry a role, so the chrome is the route the group wording is actually read from.
      makeNode('div', { role: 'button', 'aria-label': '移除' + name + '的社團建議' }, [], '移除')
    ]);

    const carousel = makeNode('div', { 'aria-label': '為你推薦' }, [
      makeNode('div', { role: 'button', 'aria-label': '向左箭頭' }, []),
      makeNode('div', { role: 'button', 'aria-label': '向右箭頭' }, []),
      makeNode('ul', {}, GROUP_TRAY.map(([id, name]) => makeNode('li', {}, [groupCard(id, name)]))),
      makeNode('a', { role: 'link', href: '/groups/?category=create' }, [], '建立社團'),
      makeNode('a', { role: 'link', href: '/groups/discover/' }, [], '查看更多社團')
    ]);

    const card = makeNode('div', { role: 'article' }, [
      makeNode('div', {}, [makeNode('span', {}, [], '你的社團建議')]),
      carousel
    ]);

    const res = detector.detect(card);
    c.ok('the real group-suggestion tray is decided as suggestedGroup', Boolean(res) && res.category === 'suggestedGroup', 'got ' + JSON.stringify(res));
    c.equals('…by the group tray rule', res && res.reason, 'dom:group_tray');
    c.equals('…and the tray marker names the new shape', res && res.debug.tray, 'groups_carousel');
    c.equals('…counting distinct group profiles, not raw links', res && res.debug.links.groups, GROUP_TRAY.length);
    c.ok('…reading the wording the page actually shows', Boolean(res) && res.text.indexOf('社團建議') !== -1, 'got ' + JSON.stringify(res && res.text));

    // The same structural answer has to reach the suggested detector, which can only veto a tray
    // it can see. Otherwise the surface rule is load-bearing alone: one of the two stops recognising
    // the tray and the other folds it as a recommendation, which is the report this is fixing.
    c.ok(
      'the suggested detector sees the same tray and can decline it',
      Boolean(detector.isHorizontalTray(card)) === true
    );
    // The marker here carries the naming half the veto requires, so the pair holds and the real tray
    // is still declined. This is the half of decision #49 that must not move: the fix is a pairing,
    // not a weaker rule.
    c.equals('…and the veto accepts it, wording and all', detector.trayVetoFor(card), 'groups_carousel');
  }

  /* --- A group suggestion that is not a tray stays undecided (text alone is too weak) --- */
  {
    const card = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [makeNode('h3', {}, [], 'Groups you might like')])
    ]);
    c.equals('group wording without a tray decides nothing', detector.detect(card), null);
    c.equals('…naming the missing structure', detector.explain(card).outcomeReason, 'group_without_tray');
  }

  /* --- FALSE POSITIVE GUARD: a post inside a group is not a group tray --- *
   * Every ordinary post in a group links to that group: the byline, the header, sometimes a
   * "shared to" footer. A tray is a ROW of them. Counting distinct group profile links is what
   * separates the two, and a threshold is the only thing that can: a single `/groups/` link is the
   * author's own group and says nothing about this unit. This is the guard the new rule needs most,
   * because a wrong answer here folds or unfolds a unit a user actually reads.
   */
  {
    const postInGroup = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [makeNode('h2', {}, [], 'Someone')]),
      makeNode('a', { role: 'link', href: 'https://www.facebook.com/groups/samplegroup/' }, [], '示範社團'),
      makeNode('div', { 'data-ad-preview': 'message' }, [makeNode('div', {}, [], 'Look at this')])
    ]);
    c.equals('a post inside a group is not a group tray', detector.detect(postInGroup), null);
    c.equals('…and is not even seen as a tray', detector.isHorizontalTray(postInGroup), null);

    // A run of group links inside a message body is content the post displays, not its own
    // surface — the same correction pitfall 9 forced on the hscroll marker, in group form.
    const linksInBody = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [makeNode('h2', {}, [], 'Someone')]),
      makeNode('div', { 'data-ad-preview': 'message' }, [
        makeNode('a', { role: 'link', href: 'https://www.facebook.com/groups/a/' }, [], 'a'),
        makeNode('a', { role: 'link', href: 'https://www.facebook.com/groups/b/' }, [], 'b'),
        makeNode('a', { role: 'link', href: 'https://www.facebook.com/groups/c/' }, [], 'c'),
        makeNode('a', { role: 'link', href: 'https://www.facebook.com/groups/d/' }, [], 'd')
      ])
    ]);
    c.equals('group links in a message body are not a group tray', detector.detect(linksInBody), null);
    c.equals('…and are not counted as one', detector.isHorizontalTray(linksInBody), null);

    // Four group links on the unit's OWN surface: the hole between the two guards above. One link is
    // the author's own group, four inside a message body are content the post displays, and four on
    // the surface itself are group chips the post wears — and the count is 4 either way, against the
    // 15 of a real tray. Found 2026-09-30 on a post in a joinable group: the store called it
    // `suggested` on `to.viewer_forum_join_state: CAN_JOIN`, the surface rules declined it for want of
    // the group wording, and the suggested detector vetoed the unit on the marker they had just
    // rejected, so both engines read the same structure and disagreed about it.
    const chipsOnSurface = makeNode('div', { role: 'article' }, [
      makeNode('header', {}, [makeNode('h2', {}, [], 'Someone')]),
      makeNode('div', {}, ['a', 'b', 'c', 'd'].map((id) => (
        makeNode('a', { role: 'link', href: 'https://www.facebook.com/groups/' + id + '/' }, [], '社團 ' + id)
      )))
    ]);
    c.equals('a post wearing group chips is not decided as a tray', detector.detect(chipsOnSurface), null);
    c.equals('…and the surface rules say why', detector.explain(chipsOnSurface).outcomeReason, 'no_surface_evidence');
    c.equals('the structure is still what it is', detector.isHorizontalTray(chipsOnSurface), 'groups_carousel');
    c.equals('…but a count alone may not veto a unit', detector.trayVetoFor(chipsOnSurface), null);
  }

  /* --- The extension must not read its own UI as page evidence ---
   * A probe button is a real `button` element and a probe popup row carries both the surface name
   * and the post permalink — the exact shape this detector hunts for. With a tray present, an
   * unguarded scan would find "Reel" plus a /reel/ link inside our own report and fold the unit on
   * the strength of its own output.
   */
  {
    const card = makeNode('div', { role: 'article' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [makeNode('span', {}, [], 'byline')]),
      makeNode('div', { 'class': 'fb-diet-probe-holder' }, [
        makeNode('button', { 'class': 'fb-diet-probe-btn', type: 'button' }, [], 'Reel'),
        makeNode('div', { 'class': 'fb-diet-probe-popup-row' }, [
          makeNode('a', { role: 'link', href: 'https://www.facebook.com/reel/123/' }, [], 'permalink')
        ])
      ])
    ]);
    c.equals('our own probe UI is never surface evidence', detector.detect(card), null);
    c.equals('…and the report shows nothing was read', detector.explain(card).outcomeReason, 'no_surface_evidence');
  }

  /* --- A label buried in the unit's content is not the unit's name (pitfall 9, label form) --- */
  {
    const card = makeNode('div', { role: 'article' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [
        makeNode('div', { 'data-ad-preview': 'attachment' }, [
          makeNode('a', { role: 'link', href: 'https://www.facebook.com/reel/9/' }, [], 'Reel')
        ])
      ])
    ]);
    c.equals('a reel link inside the displayed content decides nothing', detector.detect(card), null);
    c.equals('…and the tray alone is not a category', detector.explain(card).outcomeReason, 'no_surface_evidence');
  }

  /* --- The scanned container is itself ours, and that must not count as our own output ---
   * `fold.js` hands the scanner the wrapper it mounted (`fb-diet-full-container`, or
   * `fb-diet-fold-hidden fb-diet-foldsquash` / `fb-diet-expand-body`). A check that treats the
   * container's own class as evidence would mark every node in the tree as extension UI and the
   * detector would report nothing on every real page — while still passing every test written
   * against a bare card node.
   */
  {
    const pill = makeNode('h3', {}, [], 'Reel');
    const tile = makeNode('div', { 'data-type': 'hscroll-child' }, [pill]);
    const scanned = makeNode('div', { class: 'fb-diet-full-container' }, [tile]);
    const res = detector.detect(scanned);
    c.ok('a real fold wrapper is scanned as the unit, not skipped as our own UI', Boolean(res) && res.category === 'reels');
    const inside = makeNode('div', { class: 'fb-diet-full-container' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [
        makeNode('div', { 'class': 'fb-diet-probe-holder' }, [
          makeNode('button', { 'class': 'fb-diet-probe-btn' }, [], 'Reel')
        ])
      ])
    ]);
    c.equals('…while a node nested under our own UI inside it is still skipped', detector.detect(inside), null);
  }

  /* --- Substring safety: the word list is exact-match for labels, phrase-substring for groups --- */  {
    const titled = makeNode('div', { role: 'article' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [makeNode('h3', {}, [], 'Reels of my week')])
    ]);
    c.equals('a post titled like a surface is not that surface', detector.detect(titled), null);
    const storytime = makeNode('div', { role: 'article' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [makeNode('h3', {}, [], 'storytime')])
    ]);
    c.equals('story inside storytime does not make a Stories tray', detector.detect(storytime), null);
  }

  /* --- Multilingual labels come from KEYWORDS, not from hard-coded strings --- */
  {
    const zh = makeNode('div', { role: 'article' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [makeNode('h3', {}, [], '連續短片')])
    ]);
    c.ok('zh-Hant reels label decides reels', (detector.detect(zh) || {}).category === 'reels');
    const aria = makeNode('div', { role: 'article' }, [
      makeNode('div', { 'data-type': 'hscroll-child' }, [
        makeNode('div', { role: 'button', 'aria-label': '릴스' }, [], '')
      ])
    ]);
    c.ok('a Korean reels pill carried by aria-label decides reels', (detector.detect(aria) || {}).category === 'reels');
  }

  /* --- A throwing container is reported, not propagated --- */
  {
    const bomb = { querySelectorAll: () => { throw new Error('boom'); }, querySelector: () => { throw new Error('boom'); } };
    c.equals('detect fails open on a throwing scan', detector.detect(bomb), null);
    c.equals('explain names the error instead of throwing', detector.explain(bomb).outcome, 'scan_error');
  }

  /* --- Lifecycle: the surface scanner arms only where its answer is used --- */
  {
    const domArmed = mountUnit('dom', null);
    c.ok('the DOM path arms the surface scanner', domArmed.calls.surface > 0);
    c.equals('…and the other two detectors stay armed as before', domArmed.calls.suggested > 0, true);
    c.equals('…with one observer per detector', domArmed.win.__observers.mutation.length, 3);

    // `relay` is the mode that consults no DOM evidence, so it mounts no DOM engine at all —
    // a mounted-DOM scan is not free and the store answer is the one it uses. The probe reads
    // the surface at report time instead.
    const daily = mountUnit('relay', null);
    c.equals('the relay pipeline never runs the surface scanner', daily.calls.surface, 0);
    c.equals('…nor the suggested scanner', daily.calls.suggested, 0);
    c.equals('…so it attaches no observer', daily.win.__observers.mutation.length, 0);

    const relayOnly = mountUnit('relay', null);
    c.equals('relay mode mounts no DOM scanner at all', relayOnly.calls.surface, 0);
    c.equals('…and attaches no observer', relayOnly.win.__observers.mutation.length, 0);

    // A hit is stored and stops that scanner; the scanner must not keep watching a decided unit.
    const hit = mountUnit('dom', { isSurface: true, category: 'reels', reason: 'dom:reels_tray_label', text: 'Reel' });
    c.equals('a surface hit is read once and needs no observer', hit.calls.surface, 1);
    c.equals('…and the unit is folded as media, not left as regular', flushFold(hit), 'reels');
  }
}

/**
 * Mount one feed unit through the real fold wrapper with the surface detector stubbed, so the
 * arming rule can be observed per mode. The harness has no React commit, so the container ref is
 * wired by hand the way the other scanner suites do it.
 */
function mountUnit(dietMode, surfaceVerdict) {
  const React = createFakeReact();
  const win = createWindow();
  const comet = createFakeComet(win, React);
  win.FB_DIET_DEFAULTS = loadDefaults();
  ['comet.js', 'relay-metadata.js', 'relay-classify.js', 'bridge.js', 'dom-surface.js', 'dom-suggested.js', 'dom-sponsored.js', 'ui.js', 'probe.js', 'fold.js']
    .forEach((file) => loadInject(win, file));

  const calls = { surface: 0, suggested: 0 };
  win.FBDietDOMSurface.detect = () => { calls.surface += 1; return surfaceVerdict; };
  win.FBDietDOMSuggested.detect = () => { calls.suggested += 1; return null; };
  win.FBDietDOMSponsored.detect = () => null;

  win.FBDietBridge.setSettings({ dietMode, enabled: true, alwaysShowFoldBar: true, foldMedia: true });

  const SourceCmp = () => ({ type: 'div', props: { children: 'original post' }, __source: true });
  win.__d(SourceCmp, FEED_MODULE, [], null, null, null, { default: SourceCmp });
  comet.require(FEED_MODULE);
  const wrapper = comet.getExport(FEED_MODULE).default;
  const container = makeNode('div', { className: 'fb-diet-full-container' });
  const payload = { feedUnit: { id: 'reel-1', __typename: 'Story' } };

  React.resetHooks();
  const element = wrapper(payload);
  element.type(element.props);
  React.resetHooks();
  React.setRef(0, container);
  const mounted = element.type(element.props);

  return { win, calls, container, React, wrapper, payload, element: mounted };
}

/** Re-render after the scanner stored its hit, and read back the category the wrapper decided. */
function flushFold(unit) {
  flushTimers(unit.win);
  unit.React.resetHooks();
  unit.React.setRef(0, unit.container);
  const next = unit.wrapper(unit.payload);
  unit.React.resetHooks();
  unit.React.setRef(0, unit.container);
  next.type(next.props);
  const reports = unit.win.__messages.filter((m) => m && m.source === 'fb-diet/main' && m.type === 'blocked');
  return reports.length ? (reports[reports.length - 1].payload || {}).category : null;
}

module.exports = { run };
