'use strict';
/**
 * Tests for src/inject/dom-sponsored.js
 *
 * The fixtures in tests/fixtures/dom-sponsored/ are the 30 card cases from
 * `F.B. Sponsored/Ad Post Blocker` v1.1.76 (tests/fixtures/), which reverse-engineered
 * Facebook's byline obfuscation in the field. 18 expect the card hidden, 12 expect it left
 * alone — and those 12 are the valuable half: they are the false-positive guards the reference
 * author had to add one at a time after each real-world mistake.
 *
 * They are run here against real HTML rather than hand-built node objects, because the
 * character-split cases encode the exact flexbox `order` values and decoy class counts that make
 * the algorithm work or not.
 *
 * SCOPE — not every fixture applies to us. Our primary ad signal is the Relay field
 * `sponsored_data.ad_id`, so the reference's heuristics for ads that carry NO label at all
 * (outbound-link shape, CTA geometry) exist to serve a project with no store access. We have no
 * use for them: adopting them would add the highest-false-positive rules in the set to a detector
 * that is allowed to overrule Relay. The unapplied list in the test is recorded rather than
 * silently dropped, so nobody re-derives this analysis.
 */
const fs = require('fs');
const path = require('path');
const { createWindow, loadInject, loadDefaults } = require('./harness');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'dom-sponsored');
const VOID_TAGS = { br: 1, img: 1, input: 1, hr: 1, meta: 1, link: 1 };

/* ------------------------------------------------------------------ *
 * Minimal HTML -> node tree, enough for the detector's contract.
 * ------------------------------------------------------------------ */

function decodeEntities(text) {
  return text
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function makeElement(tagName, attributes) {
  const node = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    attributes: attributes || {},
    children: [],
    childNodes: []
  };
  Object.defineProperty(node, 'className', {
    get() {
      return node.attributes.class || '';
    }
  });
  Object.defineProperty(node, 'textContent', {
    get() {
      return node.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join('');
    }
  });
  node.getAttribute = (name) => {
    const key = String(name).toLowerCase();
    return Object.prototype.hasOwnProperty.call(node.attributes, key) ? node.attributes[key] : null;
  };
  // The detector only ever passes a comma-separated list of bare tag names, so that is all this
  // supports. Anything else would silently return nothing, which a test would catch.
  node.querySelectorAll = (selector) => {
    const wanted = selector.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const out = [];
    (function walk(el) {
      for (const child of el.children) {
        if (wanted.indexOf(child.tagName) !== -1) out.push(child);
        walk(child);
      }
    })(node);
    return out;
  };
  return node;
}

function parseHtml(html) {
  const root = makeElement('root', {});
  const stack = [root];
  // Attribute names may contain a colon (xlink:href), so the character class includes it.
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z:_-]+(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>/g;
  const attrRe = /([a-zA-Z:_-]+)(?:\s*=\s*"([^"]*)")?/g;
  let cursor = 0;
  let match;

  function pushText(chunk) {
    if (!chunk) return;
    const data = decodeEntities(chunk);
    if (!data) return;
    stack[stack.length - 1].childNodes.push({ nodeType: 3, data: data, textContent: data });
  }

  while ((match = tagRe.exec(html)) !== null) {
    pushText(html.slice(cursor, match.index));
    cursor = tagRe.lastIndex;
    const tag = match[1];
    const isClose = match[0].charAt(1) === '/';
    if (isClose) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tagName === tag.toUpperCase()) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attributes = {};
    let attrMatch;
    attrRe.lastIndex = 0;
    while ((attrMatch = attrRe.exec(match[2] || '')) !== null) {
      attributes[attrMatch[1].toLowerCase()] = decodeEntities(attrMatch[2] === undefined ? '' : attrMatch[2]);
    }
    const el = makeElement(tag, attributes);
    const parent = stack[stack.length - 1];
    parent.children.push(el);
    parent.childNodes.push(el);

    // A real <template> keeps its parsed content in a separate DocumentFragment that is NOT part
    // of its child nodes, and a declarative shadow root (shadowrootmode="closed") hands that
    // fragment to a closed shadow root that script cannot reach. The element itself stays in the
    // tree as a leaf. Modelling this is load-bearing rather than pedantic: a harness that put the
    // text in childNodes would make a label that no text route can see look perfectly readable,
    // and every closed-shadow fixture would pass for the wrong reason.
    if (tag.toLowerCase() === 'template') {
      stack.push(makeElement(tag, attributes));
      continue;
    }

    if (!match[3] && !VOID_TAGS[tag.toLowerCase()]) stack.push(el);
  }
  pushText(html.slice(cursor));
  return root;
}

function buildWorld(fixture) {
  const win = createWindow();
  win.FB_DIET_DEFAULTS = loadDefaults();

  // The fixtures encode flexbox order as an inline `style="order:N"`, which is the only way the
  // character-split case can be exercised: without a style resolver the detector falls back to
  // DOM order and the shuffled label cannot be reassembled.
  win.getComputedStyle = (el) => {
    const style = (el && el.getAttribute && el.getAttribute('style')) || '';
    const order = /order\s*:\s*(-?\d+)/.exec(style);
    return { order: order ? order[1] : '0' };
  };

  const document = { getElementById: null };
  // The detector resolves `document.getElementById` for sprite symbols and portal spans, and
  // loadInject's sandbox has no `document` of its own, so the real one is installed below.
  const cardRoot = parseHtml(fixture.card);
  const portalRoot = fixture.portal ? parseHtml(fixture.portal) : null;
  const byId = new Map();
  [portalRoot, cardRoot].filter(Boolean).forEach((tree) => {
    (function walk(el) {
      const id = el.getAttribute('id');
      if (id && !byId.has(id)) byId.set(id, el);
      el.children.forEach(walk);
    })(tree);
  });
  document.getElementById = (id) => byId.get(id) || null;

  win.document = document;
  loadInject(win, 'dom-sponsored.js');

  // A container that yields both the card subtree and the portal, matching how the detector is
  // called with a unit's mounted DOM while getElementById reaches outside it.
  const container = makeElement('container', {});
  [portalRoot, cardRoot].filter(Boolean).forEach((tree) => {
    tree.children.forEach((child) => {
      container.children.push(child);
      container.childNodes.push(child);
    });
  });

  return { win: win, container: container };
}

function run(c) {
  const names = fs.readdirSync(FIXTURE_DIR).filter((n) => n.endsWith('.json')).sort();
  c.ok('the reference fixtures are present', names.length >= 30, 'found ' + names.length);

  // Fixtures that describe heuristics we deliberately do not implement. Each is a case where the
  // ad carries no label at all and the reference guesses from structure — a problem only a
  // project with no Relay access has. Recorded, not silently dropped.
  const NOT_APPLIED = {
    'unlabeled-ad-direct-outbound.json': 'no-label ad, guessed from outbound link target',
    'unlabeled-ad-outbound-link.json': 'no-label ad, guessed from outbound link target',
    'unlabeled-ad-shape.json': 'no-label ad, guessed from wrapper geometry',
    'deeply-nested-ad-cta.json': 'needs the reference container/CTA layer',
    'ad-hidden-whole-not-just-media.json': 'needs the reference container/CTA layer',
    'goes-dangling-after-first-scan.json': 'needs the reference container/CTA layer',
    'label-deleted-before-read.json': 'needs the reference symbol-text cache',
    'no-landmark-unfollowed.json': 'unfollowed-author detection, a suggested-category concern'
  };

  let hiddenExpected = 0;
  let visibleExpected = 0;
  const failures = [];
  const unapplied = [];

  for (const name of names) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
    if (NOT_APPLIED[name]) {
      unapplied.push(name);
      continue;
    }
    const wantsHidden = fixture.expect === 'hidden';
    if (wantsHidden) hiddenExpected += 1;
    else visibleExpected += 1;

    // A fresh world per fixture: the module keeps a session-level circuit breaker, and one
    // tripping fixture must not decide the outcome of the next.
    const world = buildWorld(fixture);
    const detector = world.win.FBDietDOMSponsored;
    const verdict = detector.detect(world.container);
    const detected = Boolean(verdict && verdict.isSponsored);

    if (detected !== wantsHidden) {
      failures.push(name + ' (expected ' + fixture.expect + ', got ' + (verdict ? verdict.signal : 'null') + ')');
    }
  }

  c.ok('every applied reference fixture matches its expected verdict', failures.length === 0,
    failures.length + ' mismatched -> ' + failures.join(' | '));
  c.equals('the inapplicable fixtures are all accounted for', unapplied.length, Object.keys(NOT_APPLIED).length);
  c.ok('the suite covers both directions', hiddenExpected > 0 && visibleExpected > 0,
    'hidden=' + hiddenExpected + ' visible=' + visibleExpected);
  c.ok('every false-positive guard is applied', visibleExpected === 12, 'visible=' + visibleExpected);

  /* --- statelessness: the verdict must depend on the markup alone --- */
  {
    // The detector used to carry a circuit breaker that stopped it after three consecutive
    // Relay disagreements. That made the answer for a post a function of how many ads preceded
    // it in the feed, so two people scrolling the same feed could get different verdicts for the
    // same post. These assertions pin the replacement contract: no state, no order dependence.
    const world = buildWorld({ card: '<div><span>Sponsored</span></div>' });
    const detector = world.win.FBDietDOMSponsored;

    const first = detector.detect(world.container);
    c.equals('a DOM hit is reported', first && first.isSponsored, true);
    c.equals('the hit names the text it matched on', first && first.debug.matchedText, 'Sponsored');
    c.equals('no store verdict is needed or recorded', first && first.debug.overrodeRelay, undefined);

    // Twenty consecutive hits: the detector must never stop itself.
    let allHit = true;
    for (let i = 0; i < 20; i += 1) {
      if (!detector.detect(world.container)) allHit = false;
    }
    c.equals('twenty consecutive ads are all reported', allHit, true);

    // A miss after a long run of hits must not be tainted by them either.
    const clean = buildWorld({ card: '<div><span>Just a friend talking</span></div>' });
    clean.win.FBDietDOMSponsored.detect(world.container);
    c.equals('a miss after many hits is still a miss', clean.win.FBDietDOMSponsored.detect(clean.container), null);

    // Same markup, fresh module: identical answer, and no API left to ask about breaker state.
    c.equals('the detector exposes no breaker state', detector.getBreakerState, undefined);
    const replay = buildWorld({ card: '<div><span>Sponsored</span></div>' });
    c.equals('the same markup always gives the same verdict', replay.win.FBDietDOMSponsored.detect(replay.container).signal, first.signal);
  }

  /* --- the signals the reference proved are poison must never be consulted --- */
  {
    const world = buildWorld({
      card: '<div data-ad-rendering-role="profile_name,story_message,title" data-ad-preview><span>Another Friend</span><span>I saw an Ad yesterday</span></div>'
    });
    const detector = world.win.FBDietDOMSponsored;
    c.equals('data-ad-rendering-role and data-ad-preview are ignored', detector.detect(world.container), null);
  }

  /* --- a long run of hits never degrades into silence --- */
  {
    // The property the circuit breaker used to break: after three consecutive Relay disagreements
    // the detector went permanently quiet, so a run of legitimate ads stopped folding purely
    // because they were consecutive, and Facebook serves ten ads in a row as readily as three.
    const world = buildWorld({ card: '<div><span>Sponsored</span></div>' });
    const detector = world.win.FBDietDOMSponsored;

    const signals = [];
    for (let i = 0; i < 25; i += 1) {
      const verdict = detector.detect(world.container);
      signals.push(verdict && verdict.signal);
    }
    c.ok('twenty-five consecutive ads are all detected', signals.every(Boolean));
    c.equals('every detection reports the same signal', new Set(signals).size, 1);

    // An ordinary card interleaved with that run must still be a miss, on every turn.
    const friend = buildWorld({ card: '<div><span>Had a good coffee today</span></div>' });
    const misses = [];
    for (let i = 0; i < 5; i += 1) {
      detector.detect(world.container);
      misses.push(detector.detect(friend.container));
    }
    c.ok('ordinary posts interleaved with ads are still missed', misses.every((v) => v === null));
    c.equals('the detector exposes no breaker to disable', detector.getBreakerState, undefined);
  }

  /* --- robustness --- */
  {
    const world = buildWorld({ card: '<div><span>Sponsored</span></div>' });
    const detector = world.win.FBDietDOMSponsored;
    c.equals('a null container is survivable', detector.detect(null), null);
    c.equals('a container without querySelectorAll is survivable', detector.detect({}), null);
  }

  /* --- explain(): why the detector answered as it did --- */
  //
  // These exist because this detector is the only reader allowed to overrule Relay and, as of
  // 2026-09-28, had never been observed firing on a real page. `detect` returning null gave no way
  // to tell "Facebook is not showing a sponsored label here" from "the label is there and none of
  // the five renderings matched" — and those need opposite fixes: ignore the post, or fix the
  // vocabulary. The report now distinguishes them.
  {
    const detector = buildWorld({ card: '<div><span>Sponsored</span></div>' }).win.FBDietDOMSponsored;

    // A card with nothing in it at all: LABEL_SELECTOR is `span, a, use, div, svg, symbol, text`,
    // so almost any real card yields candidates and this outcome is the rare one. It is kept
    // because it is the floor the other outcome is measured against.
    const empty = buildWorld({ card: '' });
    const emptyEx = empty.win.FBDietDOMSponsored.explain(empty.container);
    c.equals('explain scans a real card', emptyEx.scanned, true);
    c.equals('a card with no label-shaped element reports no candidates', emptyEx.candidatesScanned, 0);
    c.equals('…and says so distinctly from a non-match', emptyEx.outcome, 'no_label_candidates');

    // Label-shaped elements present, none of them a sponsored rendering. This is the case that was
    // previously indistinguishable from the one above, and it is the one that means the label
    // vocabulary has gone stale. "Sponsorship pending review" contains "sponsored"-adjacent words
    // but matches no keyword exactly, which is exactly the near-miss worth seeing in a report.
    const labelled = buildWorld({ card: '<div><h3>Someone</h3><span>Sponsorship pending review</span></div>' });
    const labelEx = labelled.win.FBDietDOMSponsored.explain(labelled.container);
    c.ok('label-shaped text is found', labelEx.candidatesScanned > 0, 'found ' + labelEx.candidatesScanned);
    c.equals('…but not one of them is a sponsored rendering', labelEx.outcome, 'no_label_matched');
    c.equals('…and the text it actually read is reported', labelEx.sampleTexts.indexOf('Sponsorship pending review') >= 0, true);

    // A hit reports the match, and must agree with detect() — otherwise the diagnostic describes a
    // decision the scanner never made. "贊助" is the Traditional Chinese keyword, matched exactly.
    const ad = buildWorld({ card: '<div><h3>Somebrand</h3><span>贊助</span></div>' });
    const adEx = ad.win.FBDietDOMSponsored.explain(ad.container);
    c.equals('explain reports the match', adEx.outcome, 'detected');
    c.equals('…with the matched text', adEx.matchedText, '贊助');
    c.equals('…and detect agrees', ad.win.FBDietDOMSponsored.detect(ad.container).isSponsored, true);

    // A long byline must not flood the report: texts are capped, and because the cap is applied
    // shortest-first the entries it keeps are the informative ones — the real label is a one-word
    // pill. Both bounds are asserted as bounds; the exact cap sizes are implementation, not
    // contract.
    const noisy = buildWorld({
      card: '<div><span>xx</span><span>xxx</span><span>xxxx</span><span>xxxxx</span><span>xxxxxx</span><span>xxxxxxx</span><span>xxxxxxxx</span></div>'
    });
    const noisyEx = noisy.win.FBDietDOMSponsored.explain(noisy.container);
    c.ok('sampled texts are capped', noisyEx.sampleTexts.length <= 6, 'got ' + noisyEx.sampleTexts.length);
    c.ok('no sampled text exceeds the cap', noisyEx.sampleTexts.every((s) => s.length <= 41));

    c.equals('explain survives a null container', detector.explain(null).outcome, 'not_scanned');
    c.equals('…naming why', detector.explain(null).outcomeReason, 'no_container');
  }

  /* --- the accessible-name route in every locale, and the guards that keep it safe --- */
  //
  // This route exists for markup where NO text is readable at all, so it is the one that has to
  // work on the closed-shadow-root card pinned above. It was a hardcoded English
  // /sponsored content$/i, which left it dead in every locale except English - including the
  // locale it was captured in.
  {
    // A card whose only sponsorship evidence is an accessible name, in any locale.
    const ariaCard = (label) => {
      const world = buildWorld({ card: '<div><span aria-label="' + label + '"></span></div>' });
      return world.win.FBDietDOMSponsored.detect(world.container);
    };

    // Positives across locales, including the composed forms the route actually has to read: an
    // aria-label is a sentence, never the bare word. Every label here is drawn from
    // KEYWORDS.SPONSORED, the vocabulary the text routes already use.
    for (const label of ['Sponsored content', '贊助內容', '廣告內容', '広告', '스폰서 콘텐츠', 'Ad']) {
      const verdict = ariaCard(label);
      c.ok('aria label "' + label + '" names an ad', Boolean(verdict && verdict.isSponsored), 'got ' + (verdict && verdict.signal));
    }

    // FALSE POSITIVE GUARDS. Each is a real accessible name that occurs on a page, and each would
    // fold an ordinary unit if the route matched inside a sentence. The bare "ad" is what makes
    // this dangerous: unanchored it also matches Advertisement, Download and Read.
    const guards = [
      'Download',
      'Download the ad creative',
      'Advertisement settings',
      'Read more about this brand',
      'Taiwan Outdoor Show台灣戶外用品展的貼文',
      'This post from a friend is sponsored content that you may enjoy reading today'
    ];
    for (const label of guards) {
      c.equals('aria guard: "' + label + '" is not an ad', ariaCard(label), null);
    }
  }
}

module.exports = { run };
