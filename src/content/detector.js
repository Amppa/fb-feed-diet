/**
 * FB Diet - Anti-Obfuscation Detector
 * Identifies Sponsored, Suggested, Marketplace Ads, and Search Ads on Facebook.
 */

window.FBDietDetector = (() => {
  const defaults = window.FB_DIET_DEFAULTS || globalThis.FB_DIET_DEFAULTS || {};
  const keywords = defaults.KEYWORDS || {};
  const SPONSORED_KEYWORDS = Array.isArray(keywords.SPONSORED) ? keywords.SPONSORED : [];
  const SUGGESTED_GROUP_KEYWORDS = Array.isArray(keywords.SUGGESTED_GROUP) ? keywords.SUGGESTED_GROUP : [];
  const SUGGESTED_KEYWORDS = Array.isArray(keywords.SUGGESTED_FALLBACK) ? keywords.SUGGESTED_FALLBACK : [];
  const STORIES_KEYWORDS = Array.isArray(keywords.STORIES) ? keywords.STORIES : [];
  const REELS_KEYWORDS = Array.isArray(keywords.REELS) ? keywords.REELS : [];

  /**
   * Cross-realm safe element check (instanceof HTMLElement fails across documents/iframes)
   */
  function isElement(node) {
    return Boolean(node) && node.nodeType === 1;
  }

  // Cap on how many text nodes we visit per element so a huge (virtualized) subtree
  // can never freeze the page.
  const MAX_WALK_NODES = 1500;

  // getCleanVisibleText() result cache. The same element is probed by up to 7 predicates
  // in a single scan pass, so a short TTL means one DOM walk instead of seven.
  const TEXT_CACHE_TTL = 500;
  const textCache = new WeakMap();

  // Combined fast-path keyword list (checked against element.innerText first)
  const FAST_KEYWORDS = [...SPONSORED_KEYWORDS, ...SUGGESTED_GROUP_KEYWORDS, ...SUGGESTED_KEYWORDS];

  /**
   * Extracts visible text from an element while ignoring hidden/offscreen decoy spans
   * which Facebook uses to evade simple text matching.
   * Never throws: Facebook re-renders nodes while we walk them.
   */
  function getCleanVisibleText(element) {
    if (!isElement(element)) return '';

    try {
      const now = Date.now();
      const cached = textCache.get(element);
      if (cached && now - cached.time < TEXT_CACHE_TTL) return cached.value;

      const value = computeVisibleText(element);
      textCache.set(element, { value, time: now });
      return value;
    } catch (e) {
      // Unreadable node (removed mid-walk): treat as empty instead of crashing
      return '';
    }
  }

  // Call this when a feed unit's DOM changed before re-evaluating it.  This
  // prevents a just-inserted Sponsored label from being hidden by the very
  // short-lived scan cache.
  function clearTextCache(element) {
    if (isElement(element)) textCache.delete(element);
  }

  /**
   * Does the innerText fast path, then the de-obfuscation walk when needed
   */
  function computeVisibleText(element) {
    // Fast path: check simple innerText if available and small
    const rawText = element.innerText || '';
    const lowerRaw = rawText.toLowerCase();

    // Check if any obvious keyword directly matches
    for (const kw of FAST_KEYWORDS) {
      if (lowerRaw.includes(kw)) return rawText;
    }

    // Deep check: De-obfuscation walker
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const style = window.getComputedStyle(parent);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0' ||
          parseFloat(style.fontSize) === 0
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let visibleChars = '';
    let node;
    let visited = 0;
    while (visited < MAX_WALK_NODES && (node = walker.nextNode())) {
      visited += 1;
      visibleChars += node.nodeValue;
    }

    return visibleChars.trim();
  }

  /**
   * Checks if an element represents a Sponsored post or unit.
   */
  function isSponsored(feedUnit) {
    if (!isElement(feedUnit)) return false;

    // 1. Structural check: Ads transparency / Why am I seeing this ad links
    const adLinks = feedUnit.querySelectorAll('a[href*="/ads/about"], a[href*="facebook.com/ads/"], a[href*="ad_id"]');
    if (adLinks.length > 0) return true;

    // `data-ad-rendering-role` is also used on ordinary Comet feed nodes, so
    // never use it as advertising evidence.  An actual ad id is specific.
    if (feedUnit.querySelector('[data-ad-id]')) {
      return true;
    }

    // 2. Aria labels on header or metadata
    const ariaElements = feedUnit.querySelectorAll('[aria-label]');
    for (const el of ariaElements) {
      const label = (el.getAttribute('aria-label') || '').toLowerCase().trim();
      for (const kw of SPONSORED_KEYWORDS) {
        if (label === kw || label.startsWith(kw + ' ') || label.endsWith(' ' + kw)) {
          return true;
        }
      }
    }

    // 3. Inspect header metadata area for de-obfuscated visible text
    // Usually the author / timestamp / sponsored line is in the first few sections of a post
    const article = feedUnit.matches('[role="article"]') ? feedUnit : feedUnit.querySelector('[role="article"]');
    const header = article?.querySelector('header') || article || feedUnit;

    const visibleText = getCleanVisibleText(header).toLowerCase();
    for (const kw of SPONSORED_KEYWORDS) {
      // Look for standalone sponsored word in header
      // CJK labels do not necessarily have whitespace around them.
      const regex = new RegExp(`(^|\\s|•|·|[|,，。])${kw}(\\s|•|·|[|,，。]|$)`, 'i');
      if (regex.test(visibleText)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks if an element represents a Suggested Group recommendation.
   */
  function isSuggestedGroup(feedUnit) {
    if (!isElement(feedUnit)) return false;

    // 1. Aria-label indicators
    const ariaElements = feedUnit.querySelectorAll('[aria-label]');
    for (const el of ariaElements) {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      for (const kw of SUGGESTED_GROUP_KEYWORDS) {
        if (label.includes(kw)) return true;
      }
    }

    // 2. Visible text headers
    const visibleText = getCleanVisibleText(feedUnit).toLowerCase();
    for (const kw of SUGGESTED_GROUP_KEYWORDS) {
      if (visibleText.includes(kw)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks if an element represents a Suggested post, page, or friend recommendation.
   */
  function isSuggested(feedUnit) {
    if (!isElement(feedUnit)) return false;

    // Skip if it's already identified as a suggested group
    if (isSuggestedGroup(feedUnit)) return false;

    // 1. Aria-label indicators
    const ariaElements = feedUnit.querySelectorAll('[aria-label]');
    for (const el of ariaElements) {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      for (const kw of SUGGESTED_KEYWORDS) {
        if (label.includes(kw)) return true;
      }
    }

    // 2. Visible text headers (Suggested for you, etc.)
    const visibleText = getCleanVisibleText(feedUnit).toLowerCase();
    for (const kw of SUGGESTED_KEYWORDS) {
      if (visibleText.includes(kw)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks if an element in Marketplace is a promoted/sponsored ad.
   */
  function isMarketAd(element) {
    if (!isElement(element) || !window.location.pathname.includes('/marketplace')) return false;

    // Check for "Sponsored" badge inside the marketplace card
    const visibleText = getCleanVisibleText(element).toLowerCase();
    for (const kw of SPONSORED_KEYWORDS) {
      if (visibleText.includes(kw)) return true;
    }

    // Ad indicator in attributes
    if (element.querySelector('[data-ad-id], a[href*="/ads/about"]')) {
      return true;
    }

    return false;
  }

  /**
   * Checks if an element in Search Results is an ad item.
   */
  function isSearchAd(element) {
    if (!isElement(element) || !window.location.pathname.includes('/search')) return false;

    // Search results ad card usually contains Sponsored tag or Ad label
    const visibleText = getCleanVisibleText(element).toLowerCase();
    for (const kw of SPONSORED_KEYWORDS) {
      if (visibleText.includes(kw)) return true;
    }

    if (element.querySelector('a[href*="/ads/about"]')) {
      return true;
    }

    return false;
  }

  /**
   * Checks if an element represents Stories tray or component.
   */
  function isStories(feedUnit) {
    if (!isElement(feedUnit)) return false;

    // A feed story can contain a link to somebody else's story.  That must
    // never turn the whole post into a Stories tray.
    if (feedUnit.matches('[role="article"]') || feedUnit.querySelector('[role="article"]')) return false;

    // 1. Data-pagelet check
    const pagelet = (feedUnit.getAttribute('data-pagelet') || '').toLowerCase();
    if (pagelet === 'stories' || pagelet.includes('storiestray') || pagelet.includes('stories_tray')) return true;

    // 2. Aria-label check on self or children
    const ariaLabel = (feedUnit.getAttribute('aria-label') || '').toLowerCase().trim();
    for (const kw of STORIES_KEYWORDS) {
      if (ariaLabel === kw || ariaLabel.startsWith(kw + ' ')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks if an element represents Reels section, player, or feed item.
   */
  function isReels(feedUnit) {
    if (!isElement(feedUnit)) return false;

    // 1. Data-pagelet check. Reels products live under pagelets like "Reels",
    //    "FBReelsRootWrapper" or "ReelPlayer". A pagelet containing "reel" that ALSO
    //    names a Story ("CometFeedStoryFBReelsAttachmentStyle") is a friend's share of
    //    a reel rendered with the Reels attachment style - that stays visible.
    const pagelet = (feedUnit.getAttribute('data-pagelet') || '').toLowerCase();
    if (pagelet.includes('reel') && !pagelet.includes('story')) return true;

    // 2. Aria-label check
    const ariaLabel = (feedUnit.getAttribute('aria-label') || '').toLowerCase().trim();
    for (const kw of REELS_KEYWORDS) {
      if (ariaLabel.includes(kw)) return true;
    }

    // 3. Check for reels links / attachment elements
    if (feedUnit.querySelector('a[href*="/reel/"], a[href*="/reels/"]')) {
      const visibleText = getCleanVisibleText(feedUnit).toLowerCase();
      for (const kw of REELS_KEYWORDS) {
        if (visibleText.includes(kw)) return true;
      }
      if (pagelet.includes('reel') && !pagelet.includes('story')) {
        return true;
      }
    }

    return false;
  }

  return {
    isSponsored,
    isSuggested,
    isSuggestedGroup,
    isMarketAd,
    isSearchAd,
    isStories,
    isReels,
    getCleanVisibleText,
    clearTextCache
  };
})();
