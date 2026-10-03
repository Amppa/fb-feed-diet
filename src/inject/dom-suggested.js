/**
 * FB Diet - DOM suggested detector (MAIN world)
 *
 * Suggested-post detector for rendered feed units, armed in `dom` mode. The rules and selector
 * order intentionally match the historical UI implementation.
 */
window.FBDietDOMSuggested = (() => {
  'use strict';

  const defaults = window.FB_DIET_DEFAULTS || globalThis.FB_DIET_DEFAULTS || {};
  const keywords = defaults.KEYWORDS || {};
  const SUGGESTED_TEXT_KEYWORDS = Array.isArray(keywords.SUGGESTED_DOM) ? keywords.SUGGESTED_DOM : [];
  const FOLLOW_EXACT_WORDS = Array.isArray(keywords.FOLLOW_ACTIONS) ? keywords.FOLLOW_ACTIONS : [];
  const JOIN_EXACT_WORDS = Array.isArray(keywords.JOIN_ACTIONS) ? keywords.JOIN_ACTIONS : [];
  const NEGATIVE_FOLLOW_WORDS = Array.isArray(keywords.NEGATIVE_ACTIONS) ? keywords.NEGATIVE_ACTIONS : [];

  // Surface vocabulary and the ancestry walks live in `dom-surface.js`, shared with the media
  // detector so the two of them cannot disagree about what a tray is.
  //
  // When that module is absent the detector declines to answer at all rather than carrying on:
  // without the tray walk every tile of a Reels tray satisfies the "this button looks like a cue"
  // heuristics, so the failure mode of guessing is a false positive on the feed. No suggestion
  // found is the cheaper lie. // per STRATEGY.md §3.3
  function surface() {
    return window.FBDietDOMSurface || globalThis.FBDietDOMSurface || null;
  }

  // Local names for the shared surface module, so the scan steps below read the way they did
  // before the extraction and only one line per rule changed.
  function isContentSurfaceLabel(value) {
    const s = surface();
    return s ? s.isContentSurfaceLabel(value) : false;
  }

  // Not `isHorizontalTray`: the veto asks whether the shape is enough to suppress every cue below, and
  // on 2026-09-30 those two questions came apart — a group post wearing four group links on its own
  // surface has the shape of a tray and is not one, and the surface rules had already declined it as
  // such. `trayVetoFor` is the shape plus the naming half that a count cannot supply.
  function trayVeto(container) {
    const s = surface();
    return s ? s.trayVetoFor(container) : null;
  }

  function isInsideNestedReshare(el, root) {
    const s = surface();
    return s ? s.isInsideNestedReshare(el, root) : false;
  }

  const MENU_OR_DISMISS_LABELS = [
    '操作', '動作', '採取的動作', '更多', '貼文選項', 'actions', 'more', 'post options',
    '關閉', '隱藏', 'hide', 'close', 'dismiss', 'edit or delete'
  ];

  const PRIVACY_OR_TIME_LABELS = [
    '公開', '朋友', '只限本人', '自訂', 'public', 'friends', 'only me', 'custom', 'shared with'
  ];

  const CAROUSEL_OR_NAV_LABELS = [
    '上一個項目', '下一個項目', '上一個', '下一個',
    'previous', 'next', 'previous item', 'next item'
  ];

  function matchFollowOrJoin(str) {
    if (!str || typeof str !== 'string') return null;
    const clean = str.replace(/^[·•\s+]+/, '').trim().toLowerCase();
    if (!clean) return null;
    for (const neg of NEGATIVE_FOLLOW_WORDS) {
      if (clean.indexOf(neg) !== -1) return null;
    }
    for (const target of FOLLOW_EXACT_WORDS) {
      if (clean === target) {
        return { signal: 'Follow', reason: 'dom:follow_button', text: str };
      }
    }
    for (const target of JOIN_EXACT_WORDS) {
      if (clean === target) {
        return { signal: 'Join', reason: 'dom:join_button', text: str };
      }
    }
    return null;
  }

  const VERIFIED_LABELS = [
    '已驗證帳號', '已驗證', 'verified account', 'verified', 'meta verified', '確認身分'
  ];

  function isVerifiedBadge(el) {
    if (!el) return false;
    const aria = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
    for (const v of VERIFIED_LABELS) {
      if (aria.indexOf(v) !== -1) return true;
    }
    const title = (el.getAttribute && el.getAttribute('title') || '').toLowerCase();
    for (const v of VERIFIED_LABELS) {
      if (title.indexOf(v) !== -1) return true;
    }
    const text = (el.textContent || '').trim().toLowerCase();
    for (const v of VERIFIED_LABELS) {
      if (text.indexOf(v) !== -1) return true;
    }
    if (el.querySelector && el.querySelector('[aria-label*="已驗證"], [aria-label*="Verified"], [title*="已驗證"], [title*="Verified"]')) {
      return true;
    }
    return false;
  }

  function isCardMenuOrPrivacy(el) {
    if (!el) return false;
    if (isVerifiedBadge(el)) return true;
    const aria = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
    const hasPopup = el.getAttribute && el.getAttribute('aria-haspopup');
    if (hasPopup === 'menu' || hasPopup === 'true') return true;
    for (const label of MENU_OR_DISMISS_LABELS) {
      if (aria.indexOf(label) !== -1) return true;
    }
    for (const label of PRIVACY_OR_TIME_LABELS) {
      if (aria.indexOf(label) !== -1) return true;
    }
    for (const label of CAROUSEL_OR_NAV_LABELS) {
      if (aria.indexOf(label) !== -1) return true;
    }
    const href = (el.getAttribute && el.getAttribute('href')) || el.href || '';
    if (href && typeof href === 'string' && href.match(/\/(posts|videos|photos|permalink|story_fbid)/)) {
      return true;
    }
    if (el.querySelector && el.querySelector('abbr, time')) {
      return true;
    }
    if (aria.indexOf('大頭貼照') !== -1 || aria.indexOf('個人檔案') !== -1 || aria.indexOf('profile picture') !== -1) {
      return true;
    }
    if (el.querySelector && el.querySelector('image, img[src*="fbcdn"]')) {
      return true;
    }
    return false;
  }

  /**
   * DOM-based Suggested post detection for the modes that mount a visual engine.
   * Scopes strictly to author-level headers to prevent false positives on reshared content.
   * Returns: { isSuggested: true, signal: 'Follow' | 'Join' | 'Other', reason: string, text: string, debug: object } | null
   */
  /** Step 1: a suggestion keyword exposed directly through an aria-label. */
  function scanAriaKeywords(container) {
    for (const kw of SUGGESTED_TEXT_KEYWORDS) {
      const ariaMatch = container.querySelector(`[aria-label*="${kw}"]`);
      if (ariaMatch && !isInsideNestedReshare(ariaMatch, container)) {
        return {
          isSuggested: true,
          signal: 'Other',
          reason: 'dom:aria_suggested',
          text: kw,
          debug: { matchedAria: kw }
        };
      }
    }
    return null;
  }

  /** Step 2: the unit's own author header, excluding nested reshare subtrees. */
  function resolveHeaderScope(container, debugLog) {
    const headings = container.querySelectorAll('h2, h3, h4, h5, [role="heading"]');
    let primaryHeading = null;
    for (const h of headings) {
      if (!isInsideNestedReshare(h, container)) {
        primaryHeading = h;
        break;
      }
    }
    if (primaryHeading) {
      debugLog.primaryAuthor = (primaryHeading.textContent || '').trim();
    }

    let topHeader = container.querySelector('header, [data-ad-comet-preview="header"]');
    if (topHeader && isInsideNestedReshare(topHeader, container)) {
      topHeader = null;
    }
    if (!topHeader && primaryHeading) {
      topHeader = primaryHeading.closest('header, [data-ad-comet-preview="header"]') ||
                  primaryHeading.closest('div[class*="header"]') ||
                  (primaryHeading.parentElement && primaryHeading.parentElement.parentElement) ||
                  primaryHeading.parentElement;
    }

    const msgEl = container.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"]');
    return { primaryHeading, topHeader, msgEl };
  }

  /** Step 2b: keyword and follow/join candidates living inside the resolved header. */
  function scanHeaderScope(topHeader, debugLog) {
    const headerText = topHeader.textContent || '';
    for (const kw of SUGGESTED_TEXT_KEYWORDS) {
      if (headerText.indexOf(kw) !== -1) {
        // Guard against friend comments (e.g. "X 留言回應" or "X commented on this")
        if (headerText.indexOf('留言') === -1 && headerText.indexOf('回應') === -1 && headerText.indexOf('commented') === -1) {
          return {
            isSuggested: true,
            signal: 'Other',
            reason: 'dom:header_keyword',
            text: kw,
            debug: Object.assign({}, debugLog, { matchedKeyword: kw, headerSnippet: headerText.slice(0, 80) })
          };
        }
      }
    }

    const actionCandidates = topHeader.querySelectorAll('a[role="link"], div[role="button"], button, span[role="button"], span');
    for (const el of actionCandidates) {
      const text = (el.textContent || '').trim();
      const matchRes = matchFollowOrJoin(text);
      if (matchRes) {
        return {
          isSuggested: true,
          signal: matchRes.signal,
          reason: matchRes.reason,
          text,
          debug: Object.assign({}, debugLog, { matchedText: text, signal: matchRes.signal })
        };
      }
      const aria = (el.getAttribute('aria-label') || '').trim();
      const ariaMatchRes = matchFollowOrJoin(aria);
      if (ariaMatchRes) {
        return {
          isSuggested: true,
          signal: ariaMatchRes.signal,
          reason: ariaMatchRes.reason + '_aria',
          text: aria,
          debug: Object.assign({}, debugLog, { matchedAria: aria, signal: ariaMatchRes.signal })
        };
      }
    }
    return null;
  }

  /**
   * Step 3: sweep the author zone for follow/join wording and remember the first
   * unexplained action button. Returns the verdict hit (if any) plus that candidate.
   */
  function scanAuthorZone(container, scope, debugLog) {
    const { primaryHeading, topHeader, msgEl } = scope;
    const scanScope = topHeader || container;
    const actionElements = scanScope.querySelectorAll('div[role="button"], button, a[role="link"], span[role="button"]');
    let extraAuthorButtonCandidate = null;

    for (const el of actionElements) {
      if (isInsideNestedReshare(el, container)) continue;
      if (!topHeader && msgEl) {
        if (msgEl.contains(el) || msgEl === el) continue;
        if (typeof msgEl.compareDocumentPosition === 'function') {
          const pos = msgEl.compareDocumentPosition(el);
          if (pos & 4) continue; // DOCUMENT_POSITION_FOLLOWING: element is after message
        }
      }

      const text = (el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();

      // 3a. Explicit Follow or Join by text
      const matchRes = matchFollowOrJoin(text);
      if (matchRes) {
        return {
          hit: {
            isSuggested: true,
            signal: matchRes.signal,
            reason: matchRes.reason,
            text,
            debug: Object.assign({}, debugLog, { matchedText: text, signal: matchRes.signal })
          }
        };
      }

      // 3b. Explicit Follow or Join by aria-label
      const ariaMatchRes = matchFollowOrJoin(aria);
      if (ariaMatchRes) {
        return {
          hit: {
            isSuggested: true,
            signal: ariaMatchRes.signal,
            reason: ariaMatchRes.reason + '_aria',
            text: aria,
            debug: Object.assign({}, debugLog, { matchedAria: aria, signal: ariaMatchRes.signal })
          }
        };
      }

      // 3c. Track potential Extra Action button in author line
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const isButtonRole = role === 'button' || el.tagName === 'BUTTON';

      if (isButtonRole) {
        if (isCardMenuOrPrivacy(el)) {
          debugLog.excludedButtons.push({ type: 'menu_or_privacy', aria, text });
          continue;
        }
        if (isVerifiedBadge(el)) {
          debugLog.excludedButtons.push({ type: 'verified_badge', aria, text });
          continue;
        }
        if (primaryHeading && (primaryHeading.contains(el) || primaryHeading === el)) {
          debugLog.excludedButtons.push({ type: 'author_heading', aria, text });
          continue;
        }

        const hasSvg = Boolean(el.querySelector && el.querySelector('svg')) || el.tagName === 'SVG';
        // A button with NO text, NO aria-label, and NO SVG is an empty layout wrapper -> ignore
        if (!text && !aria && !hasSvg) {
          continue;
        }

        // If button contains an SVG that is a verified badge -> exclude
        if (hasSvg) {
          const svgEl = el.querySelector ? el.querySelector('svg') : el;
          if (isVerifiedBadge(svgEl)) {
            debugLog.excludedButtons.push({ type: 'verified_badge', aria, text });
            continue;
          }
        }

        // Extra action button found in author row!
        debugLog.buttonsFound.push({ role, aria, text });
        if (!extraAuthorButtonCandidate) {
          extraAuthorButtonCandidate = el;
        }
      }
    }
    return { hit: null, extraAuthorButtonCandidate };
  }

  /**
   * Step 4 (retired as a verdict): unexplained action buttons are logged, never folded.
   *
   * Only explicit Follow / Join semantics (text or aria-label, decided in steps 3a/3b) may
   * fold a unit. An "any button with text counts" fallback folded ordinary posts — any
   * localized action ("訂閱頻道"), any icon-only button — so both firing branches
   * (`other_extra_button`, `other_svg_icon`) are removed. The guard logging below stays:
   * it is what tells a probe report that a Reel pill or a verified badge was seen and
   * declined, rather than never seen at all.
   */
  function classifyExtraButton(candidate, debugLog) {
    if (!candidate) return null;
    const svgEl = candidate.querySelector('svg') || (candidate.tagName === 'SVG' ? candidate : null);
    const candText = (candidate.textContent || '').trim();
    const candAria = (candidate.getAttribute('aria-label') || '').trim();

    if (isVerifiedBadge(candidate) || (svgEl && isVerifiedBadge(svgEl))) {
      // Verified badge, ignore
      return null;
    }
    // A content-surface pill ("Reel", "限時動態") occupies the same slot as a follow button and is
    // not a recommendation cue. Excluded here rather than at the call site so no future caller of
    // this rule can reintroduce the fold.
    if (isContentSurfaceLabel(candAria) || isContentSurfaceLabel(candText)) {
      debugLog.excludedButtons.push({ type: 'content_surface', aria: candAria, text: candText });
      return null;
    }
    return null;
  }

  /** Step 5: suggestion labels rendered above the post message. */
  function scanPreMessageLabels(container, msgEl, debugLog) {
    const topSpans = container.querySelectorAll('div[dir="auto"] > span, span[dir="auto"]');
    for (const span of topSpans) {
      if (msgEl && (msgEl.contains(span) || msgEl === span)) continue;
      if (isInsideNestedReshare(span, container)) continue;
      const text = (span.textContent || '').trim();
      for (const kw of SUGGESTED_TEXT_KEYWORDS) {
        if (text === kw || (text.startsWith(kw) && text.length <= kw.length + 5)) {
          return {
            isSuggested: true,
            signal: 'Other',
            reason: 'dom:pre_message_label',
            text: kw,
            debug: Object.assign({}, debugLog, { preMessageLabel: kw })
          };
        }
      }
    }
    return null;
  }

  /**
   * Suggested-post detection over mounted DOM. Five ordered scans, each
   * returning a verdict or null; the first hit wins and the debug trail accumulated on
   * the shared log is attached to the verdict it produced.
   */
  function detectSuggestedFromDom(container) {
    if (!container || typeof container.querySelector !== 'function') return null;
    if (!surface()) return null;
    try {
      const debugLog = {
        primaryAuthor: null,
        buttonsFound: [],
        excludedButtons: []
      };

      // A tray is not a recommendation candidate at all, so the veto is at the top rather than in
      // any one rule. Every individual rule below is a "this button looks like a cue" heuristic, and
      // a tray satisfies all of them at once: it is a row of author tiles, each with a pill, each
      // with a menu button. Patching the rules one at a time is what let a Reels tile through.
      const tray = trayVeto(container);
      if (tray) {
        debugLog.excludedAsTray = tray;
        debugLog.primaryAuthor = null;
        return null;
      }

      const ariaHit = scanAriaKeywords(container);
      if (ariaHit) return ariaHit;

      const scope = resolveHeaderScope(container, debugLog);
      if (scope.topHeader) {
        const headerHit = scanHeaderScope(scope.topHeader, debugLog);
        if (headerHit) return headerHit;
      }

      const zone = scanAuthorZone(container, scope, debugLog);
      if (zone.hit) return zone.hit;

      const extraHit = classifyExtraButton(zone.extraAuthorButtonCandidate, debugLog);
      if (extraHit) return extraHit;

      return scanPreMessageLabels(container, scope.msgEl, debugLog);
    } catch (e) {
      // Fail open
    }
    return null;
  }


  /**
   * Why the detector answered the way it did. The same scans `detect` runs, but reporting the
   * evidence instead of collapsing it into null.
   *
   * A null verdict and a verdict that was never looked for look identical in a field report, and
   * that ambiguity is what makes a real page hard to debug: "regular" could mean the DOM saw
   * nothing, or that it saw plenty and every rule declined. This names the outcome.
   *
   * It deliberately reuses the existing scan helpers rather than re-deriving the rules, so it can
   * never drift from what `detect` actually decides — the only way to make this a second
   * implementation is to not make it a second implementation.
   */
  function explainSuggestedFromDom(container) {
    const base = {
      scanned: false,
      outcome: 'not_scanned',
      outcomeReason: null,
      surface: null,
      primaryAuthor: null,
      cues: []
    };
    if (!container || typeof container.querySelector !== 'function') {
      base.outcomeReason = 'no_container';
      return base;
    }
    // The tray veto and the reshare exclusion both come from `dom-surface.js`. Without it every
    // rule below is running unprotected, so this reports the gap instead of describing a scan that
    // would be unsafe to make.
    if (!surface()) {
      base.outcome = 'module_unavailable';
      base.outcomeReason = 'surface_module_missing';
      return base;
    }
    base.scanned = true;

    try {
      const debugLog = { primaryAuthor: null, buttonsFound: [], excludedButtons: [] };

      const tray = trayVeto(container);
      if (tray) {
        base.outcome = 'vetoed_as_tray';
        base.outcomeReason = tray;
        base.surface = 'tray';
        return base;
      }

      base.surface = 'standalone_post';

      // Each cue is recorded whether or not it fires, so the report shows what the detector read
      // off the page — the part a field report most needs and has never had.
      const ariaHit = scanAriaKeywords(container);
      const scope = resolveHeaderScope(container, debugLog);
      base.primaryAuthor = debugLog.primaryAuthor;

      const headerHit = scope.topHeader ? scanHeaderScope(scope.topHeader, debugLog) : null;
      const zone = scanAuthorZone(container, scope, debugLog);
      const extraHit = classifyExtraButton(zone.extraAuthorButtonCandidate, debugLog);
      const preHit = scanPreMessageLabels(container, scope.msgEl, debugLog);

      const cue = (name, hit, detail) => base.cues.push({ cue: name, fired: Boolean(hit), detail: detail || null });
      cue('aria_keyword', ariaHit, ariaHit ? ariaHit.reason : null);
      cue('header_keyword', headerHit, headerHit ? headerHit.reason : null);
      cue('follow_or_join', zone.hit, zone.hit ? zone.hit.reason : null);
      cue('extra_button', extraHit, extraHit ? extraHit.reason : null);
      cue('pre_message_label', preHit, preHit ? preHit.reason : null);

      const winner = ariaHit || headerHit || zone.hit || extraHit || preHit;
      base.outcome = winner ? 'detected' : 'no_cue_matched';
      base.outcomeReason = winner ? winner.reason : null;
      base.buttonsFound = debugLog.buttonsFound.slice(0, 8);
      base.excludedButtons = debugLog.excludedButtons.slice(0, 8);
      return base;
    } catch (e) {
      base.outcome = 'scan_error';
      base.outcomeReason = String(e && e.message ? e.message : e);
      return base;
    }
  }


  return { detect: detectSuggestedFromDom, explain: explainSuggestedFromDom };
})();
