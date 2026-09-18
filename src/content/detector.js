/**
 * FB Diet - Anti-Obfuscation Detector
 * Identifies Sponsored, Suggested, Marketplace Ads, and Search Ads on Facebook.
 */

window.FBDietDetector = (() => {
  // Multilingual keywords for Sponsored detection
  const SPONSORED_KEYWORDS = [
    'sponsored',
    '贊助',
    '赞助',
    '広告',
    '스폰서',
    'sponsorisé',
    'gesponsert',
    'patrocinado',
    'publicidad'
  ];

  // Multilingual keywords for Suggested Groups
  const SUGGESTED_GROUP_KEYWORDS = [
    'suggested group',
    'suggested groups',
    'groups you might like',
    'groups for you',
    '推薦社團',
    '推荐群组',
    'おすすめのグループ'
  ];

  // Multilingual keywords for Suggested content (posts, pages, people)
  const SUGGESTED_KEYWORDS = [
    'suggested for you',
    'suggested post',
    'suggested page',
    'people you may know',
    '為您推薦',
    '為你推薦',
    '推薦貼文',
    '你可能認識的朋友',
    '为你推荐',
    '推荐帖子',
    '可能认识的人',
    'おすすめ',
    '知り合いかも'
  ];

  /**
   * Extracts visible text from an element while ignoring hidden/offscreen decoy spans
   * which Facebook uses to evade simple text matching.
   */
  function getCleanVisibleText(element) {
    if (!element) return '';

    // Fast path: check simple innerText if available and small
    const rawText = element.innerText || '';
    const lowerRaw = rawText.toLowerCase();

    // Check if any obvious keyword directly matches
    for (const kw of SPONSORED_KEYWORDS) {
      if (lowerRaw.includes(kw)) return rawText;
    }
    for (const kw of SUGGESTED_GROUP_KEYWORDS) {
      if (lowerRaw.includes(kw)) return rawText;
    }
    for (const kw of SUGGESTED_KEYWORDS) {
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

        // Detect offscreen decoy nodes (e.g. top: -9999px or position: absolute offscreen)
        const rect = parent.getBoundingClientRect();
        if (rect.top < -1000 || rect.bottom < -1000 || rect.left < -1000) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let visibleChars = '';
    let node;
    while ((node = walker.nextNode())) {
      visibleChars += node.nodeValue;
    }

    return visibleChars.trim();
  }

  /**
   * Checks if an element represents a Sponsored post or unit.
   */
  function isSponsored(feedUnit) {
    if (!feedUnit || !(feedUnit instanceof HTMLElement)) return false;

    // 1. Structural check: Ads transparency / Why am I seeing this ad links
    const adLinks = feedUnit.querySelectorAll('a[href*="/ads/about"], a[href*="facebook.com/ads/"], a[href*="ad_id"]');
    if (adLinks.length > 0) return true;

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
    const header = feedUnit.querySelector('[role="article"] header') || 
                   feedUnit.querySelector('[data-ad-rendering-role]') ||
                   feedUnit;

    const visibleText = getCleanVisibleText(header).toLowerCase();
    for (const kw of SPONSORED_KEYWORDS) {
      // Look for standalone sponsored word in header
      const regex = new RegExp(`(^|\\s|•|·)${kw}(\\s|•|·|$)`, 'i');
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
    if (!feedUnit || !(feedUnit instanceof HTMLElement)) return false;

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
    if (!feedUnit || !(feedUnit instanceof HTMLElement)) return false;

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
    if (!element || !window.location.pathname.includes('/marketplace')) return false;

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
    if (!element || !window.location.pathname.includes('/search')) return false;

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

  return {
    isSponsored,
    isSuggested,
    isSuggestedGroup,
    isMarketAd,
    isSearchAd,
    getCleanVisibleText
  };
})();
