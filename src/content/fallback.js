/**
 * FB Diet - DOM Fallback Scanner (ISOLATED world)
 *
 * Emergency fallback for older browsers or if the MAIN world proxy fails to hook.
 * Conservative DOM observation, folding into a clean 18px placeholder with zero innerHTML.
 *
 * Public API: window.FBDietDOMFallback
 */
window.FBDietDOMFallback = (() => {
  'use strict';

  let observer = null;
  let scanScheduled = false;

  function getGroupMeta(type) {
    const DEFAULTS = globalThis.FB_DIET_DEFAULTS || {};
    const groupByCategory = DEFAULTS.GROUP_BY_CATEGORY || {};
    const groupMeta = DEFAULTS.GROUP_META || {};
    const group = groupByCategory[type] || 'ads';
    return groupMeta[group] || { badgeClass: 'fb-diet-badge-ads', badgeText: 'Ads' };
  }

  /**
   * Builds the folding placeholder element using safe DOM APIs (zero innerHTML).
   */
  function createPlaceholder(type, originalElement) {
    const meta = getGroupMeta(type);

    const bar = document.createElement('div');
    bar.className = 'fb-diet-placeholder';
    bar.setAttribute('data-fb-diet-type', type);
    bar.title = 'Show post';

    const left = document.createElement('div');
    left.className = 'fb-diet-placeholder-left';

    const badge = document.createElement('span');
    badge.className = 'fb-diet-badge ' + meta.badgeClass;
    badge.textContent = meta.badgeText;

    left.appendChild(badge);
    bar.appendChild(left);

    let isExpanded = false;
    bar.addEventListener('click', () => {
      isExpanded = !isExpanded;
      if (isExpanded) {
        originalElement.classList.add('fb-diet-is-expanded');
        bar.classList.add('fb-diet-state-expanded');
        bar.title = 'Re-fold';
      } else {
        originalElement.classList.remove('fb-diet-is-expanded');
        bar.classList.remove('fb-diet-state-expanded');
        bar.title = 'Show post';
      }
    });

    return bar;
  }

  function foldElement(element, type, onBlocked) {
    if (!element || element.dataset.fbDietFolded === 'true') return;
    if (!element.isConnected || !element.parentElement) return;

    element.dataset.fbDietFolded = 'true';
    element.classList.add('fb-diet-folded-original');

    try {
      const placeholder = createPlaceholder(type, element);
      element.parentElement.insertBefore(placeholder, element);
    } catch (e) {
      element.classList.remove('fb-diet-folded-original');
      delete element.dataset.fbDietFolded;
      return;
    }

    if (typeof onBlocked === 'function') onBlocked(type);
  }

  function restoreAllElements() {
    document.querySelectorAll('.fb-diet-placeholder').forEach((p) => p.remove());
    document.querySelectorAll('.fb-diet-folded-original').forEach((el) => {
      el.classList.remove('fb-diet-folded-original', 'fb-diet-is-expanded');
      delete el.dataset.fbDietFolded;
      delete el.dataset.fbDietChecked;
    });
  }

  function safeDetect(predicate, element) {
    try {
      return predicate(element) === true;
    } catch (e) {
      return false;
    }
  }

  function evaluateElement(el, settings, onBlocked) {
    if (!settings || !settings.enabled || !el || el.dataset.fbDietFolded === 'true') return;

    const detector = window.FBDietDetector;
    if (!detector || typeof detector.isSponsored !== 'function') return;

    if (settings.foldMedia && safeDetect(detector.isStories, el)) {
      foldElement(el, 'stories', onBlocked);
      return;
    }
    if (settings.foldMedia && safeDetect(detector.isReels, el)) {
      foldElement(el, 'reels', onBlocked);
      return;
    }
    if (settings.foldAds && safeDetect(detector.isMarketAd, el)) {
      foldElement(el, 'marketAds', onBlocked);
      return;
    }
    if (settings.foldAds && safeDetect(detector.isSearchAd, el)) {
      foldElement(el, 'searchingAds', onBlocked);
      return;
    }
    if (settings.foldAds && safeDetect(detector.isSponsored, el)) {
      foldElement(el, 'sponsored', onBlocked);
      return;
    }
    if (settings.foldOther && safeDetect(detector.isSuggestedGroup, el)) {
      foldElement(el, 'suggestedGroup', onBlocked);
      return;
    }
    if (settings.foldSuggested && safeDetect(detector.isSuggested, el)) {
      foldElement(el, 'suggested', onBlocked);
      return;
    }
  }

  // Fold scope (STRATEGY.md decision #26): classify only on the allowlisted surfaces.
  // Leaving the scope restores every folded element exactly once and clears stale
  // fingerprints (restoreAllElements keeps them, so recycled SPA nodes would never
  // re-fold). While out of scope each scan costs one pathname comparison; fail-open
  // when defaults or the pathname are unavailable.
  let wasInFoldScope = null;

  function isCurrentPathAllowed() {
    const defaults = globalThis.FB_DIET_DEFAULTS;
    if (!defaults || typeof defaults.isFoldScopeAllowed !== 'function') return true;
    return defaults.isFoldScopeAllowed(window.location ? window.location.pathname : undefined);
  }

  function scanPage(settings, onBlocked) {
    if (!settings || !settings.enabled) return;

    const inScope = settings.restrictFoldScope === false || isCurrentPathAllowed();
    if (wasInFoldScope === true && !inScope) {
      restoreAllElements();
      document.querySelectorAll('[data-fb-diet-fingerprint]').forEach((el) => {
        delete el.dataset.fbDietFingerprint;
      });
    }
    wasInFoldScope = inScope;
    if (!inScope) return;

    const scope = document.querySelector('div[role="main"]') ? 'div[role="main"]' : 'body';
    const selectors = [
      `${scope} [role="feed"] > div`,
      `${scope} [role="article"]`,
      `${scope} div[data-pagelet^="FeedUnit"]`,
      `${scope} div[data-virtualized="false"]`,
      `${scope} div[data-pagelet*="Stories"]`,
      `${scope} div[aria-label="Stories"]`,
      `${scope} div[aria-label="限時動態"]`,
      `${scope} div[data-pagelet*="Reel"]`,
      `${scope} div[aria-label*="Reels"]`,
      `${scope} div[aria-label*="連續短片"]`,
      `${scope} div[aria-label="Collection of Marketplace items"] > div`,
      `${scope} a[href*="/marketplace/item/"]`
    ];

    const elements = document.querySelectorAll(selectors.join(', '));
    elements.forEach((el) => {
      try {
        let target = el;
        if (el.getAttribute('role') === 'article') {
          target = el.closest('[role="feed"] > div') || el.closest('[data-pagelet]') || el;
        }
        if (!target || target.querySelectorAll('[role="article"]').length > 1) return;

        const fingerprint = `${target.textContent || ''}\u0000${target.querySelectorAll('[aria-label], [data-ad-rendering-role], [data-ad-preview], [data-ad-comet-preview], [data-ad-id]').length}`;
        if (target.dataset.fbDietFingerprint === fingerprint) return;
        target.dataset.fbDietFingerprint = fingerprint;

        window.FBDietDetector?.clearTextCache?.(target);
        target.querySelectorAll('[role="article"], header').forEach((node) => {
          window.FBDietDetector?.clearTextCache?.(node);
        });

        evaluateElement(target, settings, onBlocked);
      } catch (e) {}
    });
  }

  function triggerThrottledScan(settings, onBlocked) {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      try {
        scanPage(settings, onBlocked);
      } catch (e) {}
    });
  }

  function startObservation(getSettings, onBlocked) {
    if (observer) return;

    try {
      const settings = typeof getSettings === 'function' ? getSettings() : getSettings;
      scanPage(settings, onBlocked);
    } catch (e) {}

    const body = document.body;
    if (!body) return;

    observer = new MutationObserver((mutations) => {
      const settings = typeof getSettings === 'function' ? getSettings() : getSettings;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          triggerThrottledScan(settings, onBlocked);
          break;
        }
      }
    });

    observer.observe(body, {
      childList: true,
      subtree: true
    });
  }

  function stopObservation() {
    if (observer) {
      try { observer.disconnect(); } catch (e) {}
      observer = null;
    }
  }

  return {
    createPlaceholder,
    foldElement,
    restoreAllElements,
    evaluateElement,
    scanPage,
    startObservation,
    stopObservation
  };
})();
