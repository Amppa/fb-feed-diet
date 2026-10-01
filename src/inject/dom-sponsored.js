/**
 * FB Diet - DOM sponsorship detector (MAIN world)
 *
 * Second opinion on `sponsored`, from the rendered page rather than the Relay store. It exists
 * because the two sources fail differently: Relay dies if Facebook renames a GraphQL field, the
 * DOM dies if Facebook changes how the label is drawn. Running both keeps a redesign from
 * silently turning ads back on (STRATEGY.md decision #39).
 *
 * The algorithm follows `F.B. Sponsored/Ad Post Blocker` v1.1.76 and the teardown in
 * docs/research/fb-sponsored.md, which reverse-engineered it. Facebook draws the byline label
 * in five ways, and which one is in use has changed repeatedly:
 *   1. plain leaf text          <span>Sponsored</span>
 *   2. text beside an icon      an element that has children but owns its text
 *   3. character-split          one <span> per glyph, decoys interleaved, visual order carried
 *                               only by flexbox `order`
 *   4. vector sprite            <svg><use xlink:href="#SvgT31">, text only inside the <symbol>
 *   5. accessible name only     no text at all; an aria-label, or an aria-labelledby pointing at
 *                               a portal <span> parked under <body>
 *
 * DELIBERATELY NOT USED — `data-ad-rendering-role`, `data-ad-preview`, `data-ad-comet-preview`.
 * Their names and values ("profile_name", "story_message", …) make them look like a reliable ad
 * marker and they are present on every part of a sponsored post. They are equally present on
 * ordinary posts from pages you follow, because Facebook renders both through the same story
 * template. Keying off them classifies the entire feed as sponsored. Verified the hard way by
 * the reference author, twice, most recently 2026-09-11 against a local buy-and-sell group post.
 *
 * Public API (window.FBDietDOMSponsored):
 *   detect(container) -> verdict | null
 *
 * STATELESS BY CONTRACT: detect() takes only the container and holds no cross-call state, so the
 * same markup always yields the same verdict regardless of what was scanned before it. A circuit
 * breaker (three consecutive Relay disagreements) was removed for exactly this reason — it made
 * the answer for a post depend on how many ads preceded it in the feed.
 */
window.FBDietDOMSponsored = (() => {
  'use strict';

  const defaults = window.FB_DIET_DEFAULTS || globalThis.FB_DIET_DEFAULTS || {};
  const KEYWORDS = defaults.KEYWORDS || {};
  const SPONSORED_TEXTS = KEYWORDS.SPONSORED || ['sponsored'];

  // Facebook pads every glyph with invisible formatting / combining / private-use characters, so
  // concatenated textContent never equals the target even once. Dropping all three undoes it.
  // Co is included because the mobile web layout packs PUA icon glyphs into the same span as
  // the label ("Ad<audience><chevron>"), and those are Co — stripping only Cf and Mn left that
  // string matching nothing, which is why mobile hid unfollowed posts but never ads.
  const INVISIBLE_CHARS_RE = /[\p{Cf}\p{Mn}\p{Co}]/gu;
  // Genuine character-spans carry a long class list; the decoys do not. Which side is which has
  // flipped between builds, so the caller tries both directions rather than betting on one.
  const HONEYPOT_LEAF_CLASS_COUNT = 10;
  const MIN_SCRAMBLED_LABEL_CHILDREN = 4;
  const MAX_SCRAMBLED_LABEL_CHILDREN = 120;
  // Every real character-split label found in the field is flat. Without this cap the walk
  // recurses into unrelated page content that slipped past the width check and resolves
  // computed style at every level — a real perf bug the reference implementation shipped.
  const MAX_LABEL_DEPTH = 4;
  const MAX_TEXT_LEN = 300;

  // An accessible name is a label, not prose, and it is the only route that may read less than an
  // exact match: it is a composed string ("Sponsored content", "贊助內容",
  // "Taiwan Outdoor Show的贊助貼文"), never the bare word. It was previously a hardcoded English
  // `/sponsored content$/i`, which left the route dead in every locale — the one language gap in
  // five renderings, on the rendering that exists precisely because no text is readable.
  //
  // Substring is only survivable under guards that follow the script, because the danger is
  // specifically the bare two-letter Latin "ad" — unanchored it also matches Advertisement,
  // Download and Read. So:
  //   - Latin keywords are word-anchored, since "ad" inside "Brad" is the documented hazard.
  //   - Scripts without word boundaries (CJK, Korean) are matched literally: 贊助 / 廣告
  //     appearing at all is already the signal, and a token split would miss "贊助內容" entirely
  //     because those characters never separate.
  //   - The bare Latin short keyword is admitted only as a whole token, and only in a name of at
  //     most two tokens, so "Ad" matches while "Download the ad creative" does not.
  //   - The name must be SHORT overall. A long one is a post title or a sentence, not a label.
  const MAX_ARIA_LEN = 40;
  const MAX_ARIA_TOKENS_FOR_SHORT_KEYWORD = 2;
  // The explainer link is only evidence where a byline would carry it. The host is pinned to
  // Facebook: an ads/about URL on any other host is somebody else's link, not the byline's.
  const ADS_ABOUT_RE = /(^|https?:\/\/([a-z0-9-]+\.)*facebook\.com)\/ads\/about(\/|\?|$)/i;
  // UI vocabulary that legitimately touches an ad keyword (廣告設定 is a settings label, not an
  // ad label). Only consulted by the accessible-name route, and only at the seam: the keyword
  // must stand clear of these words on both sides to count.
  const ARIA_UI_WORDS = ['設定', '設置', '管理', '選項', 'settings', 'manage'];
  const ARIA_UI_TAIL_RE = new RegExp('(' + ARIA_UI_WORDS.map(escapeRe).join('|') + ')$', 'i');
  const ARIA_UI_HEAD_RE = new RegExp('^(' + ARIA_UI_WORDS.map(escapeRe).join('|') + ')', 'i');

  const isLatinWord = (keyword) => /^[A-Za-z]+$/.test(String(keyword));
  const ARIA_LATIN_RE = new RegExp(
    '(' + SPONSORED_TEXTS.filter((k) => isLatinWord(k) && String(k).length > 2)
      .map((k) => '\\b' + escapeRe(k) + '\\b').join('|') + ')',
    'i'
  );
  const SHORT_ARIA_KEYWORDS = new Set(
    SPONSORED_TEXTS.filter((k) => isLatinWord(k) && String(k).length <= 2)
      .map((k) => String(k).toLowerCase())
  );

  function escapeRe(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** True when an accessible name is a short label that names an ad, in any locale. */
  function ariaNamesAnAd(value) {
    if (typeof value !== 'string' || !value) return false;
    const cleaned = cleanText(value);
    if (!cleaned || cleaned.length > MAX_ARIA_LEN) return false;
    if (ariaNonLatinHit(cleaned) || ARIA_LATIN_RE.test(cleaned)) return true;

    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.length > MAX_ARIA_TOKENS_FOR_SHORT_KEYWORD) return false;
    return tokens.some((token) => SHORT_ARIA_KEYWORDS.has(token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()));
  }

  /**
   * Non-Latin keywords have no word boundaries, so a bare substring test would also match UI
   * vocabulary built on the same characters (廣告設定). An occurrence counts only when it
   * stands clear of the UI words on both sides; a bare keyword (nothing around it) always
   * counts. Latin keywords keep their own anchored expression above.
   */
  function ariaNonLatinHit(cleaned) {
    const keywords = SPONSORED_TEXTS.filter((k) => !isLatinWord(k));
    for (const keyword of keywords) {
      const word = String(keyword);
      if (!word) continue;
      let from = 0;
      for (;;) {
        const at = cleaned.indexOf(word, from);
        if (at === -1) break;
        const before = cleaned.slice(Math.max(0, at - 12), at);
        const after = cleaned.slice(at + word.length, at + word.length + 12);
        if (!ARIA_UI_TAIL_RE.test(before) && !ARIA_UI_HEAD_RE.test(after)) return true;
        from = at + word.length;
      }
    }
    return false;
  }

  // Only these elements can carry a label worth reading. Anything else is a wrapper, and
  // reading textContent on a wrapper re-walks the same subtree at every nesting level.
  // `text` is included because Facebook also draws the label as inline SVG text.
  const LABEL_SELECTOR = 'span, a, use, div, svg, symbol, text';

  function cleanText(value) {
    if (typeof value !== 'string' || !value) return '';
    return value.replace(INVISIBLE_CHARS_RE, '').trim();
  }

  /**
   * Exact match, never substring: Facebook rolls "Sponsored" to "Ad", and "Ad" inside "Brad"
   * or "Address" would fold somebody's ordinary post.
   */
  function matchSponsoredText(text) {
    if (!text) return null;
    const cleaned = cleanText(text);
    if (!cleaned || cleaned.length > MAX_TEXT_LEN) return null;
    for (const keyword of SPONSORED_TEXTS) {
      if (cleaned.toLowerCase() === String(keyword).toLowerCase()) return cleaned;
    }
    return null;
  }

  /** Computed flexbox `order`, falling back to DOM position when style is unavailable. */
  function visualOrder(child, index) {
    try {
      const getter = window.getComputedStyle;
      if (typeof getter !== 'function') return index;
      const parsed = parseInt(getter.call(window, child).order, 10);
      return isNaN(parsed) ? index : parsed;
    } catch (e) {
      return index;
    }
  }

  /**
   * Children in the order a person sees them. Facebook places the glyph spans in arbitrary DOM
   * order and repositions them purely through CSS, so DOM order is not reading order.
   */
  function collectOrderedLeaves(node, depth) {
    const level = depth || 0;
    if (level > MAX_LABEL_DEPTH) return [];
    const children = node.children || [];
    const ordered = [];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      const nested = collectOrderedLeaves(child, level + 1);
      ordered.push({
        text: cleanText(child.textContent),
        order: visualOrder(child, i),
        classCount: (child.className || '').toString().trim().split(/\s+/).filter(Boolean).length
      });
      ordered.push.apply(ordered, nested);
    }
    ordered.sort(function (a, b) { return a.order - b.order; });
    return ordered;
  }

  /**
   * O(1) gate. Resolving computed style forces a layout flush, so this must reject almost
   * everything before any expensive work starts: a genuine scrambled label is a row of leaf
   * spans each holding exactly one visible character. Reading leaf text costs nothing.
   */
  function isCharacterSplit(el) {
    const children = el.children;
    if (!children) return false;
    const count = children.length;
    if (count < MIN_SCRAMBLED_LABEL_CHILDREN || count > MAX_SCRAMBLED_LABEL_CHILDREN) return false;
    for (let i = 0; i < count; i += 1) {
      const child = children[i];
      if (child.tagName !== 'SPAN' || child.children.length !== 0) return false;
      if (cleanText(child.textContent).length > 1) return false;
    }
    return true;
  }

  /** The text an element holds directly, ignoring what its children hold. Never recurses. */
  function ownText(el) {
    let out = '';
    const nodes = el.childNodes || [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node.nodeType !== 3) continue;
      out += node.textContent;
      if (out.length > MAX_TEXT_LEN) return '';
    }
    return out.trim() ? out : '';
  }

  /**
   * Three readings of the same scrambled label. The decoy direction is not knowable, so all
   * three are offered to the matcher and whichever produces a target string wins.
   */
  function labelVariants(el) {
    const leaves = collectOrderedLeaves(el, 0);
    const assemble = (keep) => leaves
      .filter((leaf) => keep(leaf.classCount))
      .map((leaf) => leaf.text)
      .join('')
      .trim();

    return [
      assemble(() => true),
      assemble((n) => n > HONEYPOT_LEAF_CLASS_COUNT),
      assemble((n) => n <= HONEYPOT_LEAF_CLASS_COUNT)
    ];
  }
  /** Accessible name of an element, whether inline or assembled from referenced nodes. */
  function ariaNameText(el) {
    if (!el || typeof el.getAttribute !== 'function') return null;
    const direct = el.getAttribute('aria-label');
    if (ariaNamesAnAd(direct)) return direct;
    // aria-labelledby is a space-separated LIST; the accessible name is the concatenation, so
    // passing the raw attribute to getElementById returns null the moment there is more than
    // one id. Every referenced node has to be checked.
    const labelledBy = el.getAttribute('aria-labelledby');
    if (!labelledBy) return null;
    const doc = typeof window !== 'undefined' ? window.document : null;
    if (!doc || typeof doc.getElementById !== 'function') return null;
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    for (const id of ids) {
      let target = null;
      try {
        target = doc.getElementById(id);
      } catch (e) {
        target = null;
      }
      const text = target ? cleanText(target.textContent) : null;
      if (text && (matchSponsoredText(text) || ariaNamesAnAd(text))) return text;
    }
    return null;
  }

  /** Symbol text for a <use xlink:href="#id">, or null. */
  function spriteText(el) {
    const ref = el.getAttribute('xlink:href') || el.getAttribute('href');
    if (!ref || ref.charAt(0) !== '#') return null;
    const doc = typeof window !== 'undefined' ? window.document : null;
    if (!doc || typeof doc.getElementById !== 'function') return null;
    let symbol = null;
    try {
      symbol = doc.getElementById(ref.slice(1));
    } catch (e) {
      symbol = null;
    }
    return symbol ? cleanText(symbol.textContent) : null;
  }

  /** One element, one verdict or null, cheapest route first. */
  function classifyElement(el) {
    if (!el || !el.tagName) return null;

    if (!el.children || el.children.length === 0) {
      const raw = typeof el.textContent === 'string' ? el.textContent : '';
      if (raw && raw.length <= MAX_TEXT_LEN) {
        const hit = matchSponsoredText(raw);
        if (hit) return { signal: 'plain_text', text: hit };
      }
    } else {
      const own = ownText(el);
      if (own) {
        const hit = matchSponsoredText(own);
        if (hit) return { signal: 'own_text', text: hit };
      }
      if (isCharacterSplit(el)) {
        for (const variant of labelVariants(el)) {
          const hit = matchSponsoredText(variant);
          if (hit) return { signal: 'scrambled', text: hit };
        }
      }
    }

    // Vector sprite: there is no text in the post at all, which is why every text route above
    // finds nothing. The <symbol> does hold real text because a screen reader must be able to
    // announce it (#SvgT31 reads "Sponsored", an organic byline reads "17 hours ago").
    // SVG elements report a lower-case tagName in the real DOM, so this compares case-insensitively.
    if (String(el.tagName).toLowerCase() === 'use') {
      const text = spriteText(el);
      if (text) {
        const hit = matchSponsoredText(text);
        if (hit) return { signal: 'svg_sprite', text: hit };
      }
    }

    // The byline label links to the "Why am I seeing this ad?" explainer. The host is pinned
    // to Facebook by ADS_ABOUT_RE: an ads/about URL anywhere else is somebody else's link.
    if (String(el.tagName).toUpperCase() === 'A') {
      const href = el.getAttribute('href') || '';
      if (ADS_ABOUT_RE.test(href)) return { signal: 'ads_about_link', text: href };
    }

    const aria = ariaNameText(el);
    if (aria) return { signal: 'aria_label', text: aria };

    return null;
  }

  /**
   * Scans one feed unit's mounted DOM and answers from that markup alone. Takes no store verdict
   * and keeps no state, so the same card always produces the same answer.
   */
  function detectSponsoredFromDom(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return null;

    try {
      const candidates = container.querySelectorAll(LABEL_SELECTOR);
      for (let i = 0; i < candidates.length; i += 1) {
        const hit = classifyElement(candidates[i]);
        if (!hit) continue;

        // Stateless by design: a hit is a hit, a miss is a miss, and the same markup always
        // produces the same answer. An earlier version kept a circuit breaker that counted
        // consecutive overrides and stopped the detector after three; it was removed because a
        // count is a function of feed *order*, not of any single post, so it made the verdict
        // for post N depend on posts 1..N-1. Facebook serves ten ads in a row as often as three,
        // and a user who scrolled differently would get a different answer for the same post.
        return {
          isSponsored: true,
          signal: hit.signal,
          reason: 'dom:' + hit.signal,
          text: hit.text,
          debug: {
            matchedText: hit.text,
            signal: hit.signal
          }
        };
      }
    } catch (e) {
      // Fail open: a broken scan must never fold a unit.
    }
    return null;
  }

  /**
   * Why the detector answered the way it did.
   *
   * The miss case is the one that matters and the one that used to be opaque: this detector is the
   * only reader allowed to overrule Relay, and as of 2026-09-28 it had never been observed firing on
   * a real page. A null verdict gives no way to tell "the label is not on the page" from "the label
   * is there and none of the five renderings matched it" — and those need opposite fixes. So the
   * scan reports what it read: how many label-shaped elements it walked, and the shortest few of
   * their texts, which is where a renamed or newly obfuscated label shows up.
   *
   * Texts are trimmed and capped, because a real byline can be long and a report that pastes a
   * whole post into the clipboard is a report nobody reads.
   */
  function explainSponsoredFromDom(container) {
    const base = {
      scanned: false,
      outcome: 'not_scanned',
      outcomeReason: null,
      candidatesScanned: 0,
      // The shortest few label-shaped texts, shortest first: the real label is a one-word pill, so
      // the shortest entries are the informative ones.
      sampleTexts: []
    };
    if (!container || typeof container.querySelectorAll !== 'function') {
      base.outcomeReason = 'no_container';
      return base;
    }
    base.scanned = true;

    try {
      const candidates = container.querySelectorAll(LABEL_SELECTOR);
      base.candidatesScanned = candidates.length;
      const texts = [];
      for (let i = 0; i < candidates.length; i += 1) {
        const raw = typeof candidates[i].textContent === 'string' ? candidates[i].textContent.trim() : '';
        if (raw) texts.push(raw.length > 40 ? raw.slice(0, 40) + '…' : raw);
      }
      texts.sort((a, b) => a.length - b.length);
      base.sampleTexts = texts.slice(0, 6);

      for (let i = 0; i < candidates.length; i += 1) {
        const hit = classifyElement(candidates[i]);
        if (!hit) continue;
        base.outcome = 'detected';
        base.outcomeReason = hit.signal;
        base.matchedText = hit.text;
        return base;
      }
      base.outcome = base.candidatesScanned ? 'no_label_matched' : 'no_label_candidates';
      return base;
    } catch (e) {
      base.outcome = 'scan_error';
      base.outcomeReason = String(e && e.message ? e.message : e);
      return base;
    }
  }

  return {
    detect: detectSponsoredFromDom,
    explain: explainSponsoredFromDom
  };
})();
