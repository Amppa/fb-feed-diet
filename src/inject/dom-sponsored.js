/**
 * DOM sponsorship detector (MAIN world): second opinion from rendered page.
 * Stateless: detect(container) -> verdict | null. // per STRATEGY.md §3.1
 */
window.FBDietDOMSponsored = (() => {
  'use strict';

  const defaults = window.FB_DIET_DEFAULTS || globalThis.FB_DIET_DEFAULTS || {};
  const KEYWORDS = defaults.KEYWORDS || {};
  const SPONSORED_TEXTS = KEYWORDS.SPONSORED || ['sponsored'];

  // Strip Cf/Mn/Co invisibles + PUA glyphs so concatenated text matches.
  const INVISIBLE_CHARS_RE = /[\p{Cf}\p{Mn}\p{Co}]/gu;
  // Honeypot decoys differ by class count; try both directions.
  const HONEYPOT_LEAF_CLASS_COUNT = 10;
  const MIN_SCRAMBLED_LABEL_CHILDREN = 4;
  const MAX_SCRAMBLED_LABEL_CHILDREN = 120;
  // Cap label depth to avoid recursing into unrelated content.
  const MAX_LABEL_DEPTH = 4;
  const MAX_TEXT_LEN = 300;

  // Accessible name is a short label: Latin word-anchored, CJK literal, short keyword whole-token.
  const MAX_ARIA_LEN = 40;
  const MAX_ARIA_TOKENS_FOR_SHORT_KEYWORD = 2;
  // Explainer link counts only on facebook.com hosts.
  const ADS_ABOUT_RE = /(^|https?:\/\/([a-z0-9-]+\.)*facebook\.com)\/ads\/about(\/|\?|$)/i;
  // UI words that legitimately touch an ad keyword; keyword must stand clear of them.
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

  /** Non-Latin keyword counts only when clear of UI words on both sides. */
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

  // Label-carrying elements only; `text` covers inline SVG text.
  const LABEL_SELECTOR = 'span, a, use, div, svg, symbol, text';

  function cleanText(value) {
    if (typeof value !== 'string' || !value) return '';
    return value.replace(INVISIBLE_CHARS_RE, '').trim();
  }

  /** Exact match only: "Ad" inside "Brad" must not fold. */
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

  /** Children in visual order; DOM order is not reading order. */
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

  /** O(1) gate: row of leaf spans each holding exactly one visible character. */
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

  /** Three scrambled-label readings; whichever matches wins. */
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

    // Vector sprite: <symbol> holds screen-reader text where post holds none.
    if (String(el.tagName).toLowerCase() === 'use') {
      const text = spriteText(el);
      if (text) {
        const hit = matchSponsoredText(text);
        if (hit) return { signal: 'svg_sprite', text: hit };
      }
    }

    // Byline explainer link; host pinned by ADS_ABOUT_RE.
    if (String(el.tagName).toUpperCase() === 'A') {
      const href = el.getAttribute('href') || '';
      if (ADS_ABOUT_RE.test(href)) return { signal: 'ads_about_link', text: href };
    }

    const aria = ariaNameText(el);
    if (aria) return { signal: 'aria_label', text: aria };

    return null;
  }

  /** Scan one feed unit's DOM alone; stateless, same markup same verdict. */
  function detectSponsoredFromDom(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return null;

    try {
      const candidates = container.querySelectorAll(LABEL_SELECTOR);
      for (let i = 0; i < candidates.length; i += 1) {
        const hit = classifyElement(candidates[i]);
        if (!hit) continue;

        // Stateless by design: same markup always produces the same answer.
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

  /** Why the detector answered: counts walked plus shortest label-shaped texts. */
  function explainSponsoredFromDom(container) {
    const base = {
      scanned: false,
      outcome: 'not_scanned',
      outcomeReason: null,
      candidatesScanned: 0,
      // Shortest label-shaped texts first; the real label is a one-word pill.
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
