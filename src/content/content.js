/**
 * FB Diet - Content Script
 * Observes Facebook feed/page elements, folds ads & suggestions into clean placeholders,
 * allows one-click expand/collapse, and sends throttled stats to storage.
 */

(() => {
  // Runtime configuration state
  let currentSettings = {
    enabled: true,
    removeSponsored: true,
    removeSuggested: true,
    removeSuggestedGroup: true,
    removeMarketAds: true,
    removeSearchingAds: true
  };

  // Buffer for throttled stats updates (transferred every 3 seconds)
  let countBuffer = {
    total: 0,
    sponsored: 0,
    suggested: 0,
    suggestedGroup: 0,
    marketAds: 0,
    searchingAds: 0
  };
  let flushTimer = null;

  // Initialize settings
  chrome.storage.local.get('settings', (data) => {
    if (data.settings) {
      currentSettings = { ...currentSettings, ...data.settings };
    }
    startObservation();
  });

  // Listen for real-time toggle changes from Popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      const oldEnabled = currentSettings.enabled;
      currentSettings = { ...currentSettings, ...changes.settings.newValue };

      // If master switch was toggled off, restore all folded items
      if (oldEnabled && !currentSettings.enabled) {
        restoreAllElements();
      } else if (!oldEnabled && currentSettings.enabled) {
        scanPage();
      }
    }
  });

  /**
   * Schedules a flush of accumulated block counts to chrome.storage.local
   */
  function scheduleCountFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      if (countBuffer.total === 0) return;

      const delta = { ...countBuffer };
      // Reset buffer
      countBuffer = { total: 0, sponsored: 0, suggested: 0, suggestedGroup: 0, marketAds: 0, searchingAds: 0 };

      try {
        const data = await chrome.storage.local.get('counts');
        const counts = data.counts || { total: 0, sponsored: 0, suggested: 0, suggestedGroup: 0, marketAds: 0, searchingAds: 0 };

        counts.total += delta.total;
        counts.sponsored += delta.sponsored;
        counts.suggested += delta.suggested;
        counts.suggestedGroup = (counts.suggestedGroup || 0) + (delta.suggestedGroup || 0);
        counts.marketAds += delta.marketAds;
        counts.searchingAds += delta.searchingAds;

        await chrome.storage.local.set({ counts });
      } catch (err) {
        console.warn('[FB Diet] Error saving counts to storage:', err);
      }
    }, 3000);
  }

  /**
   * Tracks a blocked item and queues stats
   */
  function recordBlock(category) {
    countBuffer.total += 1;
    if (countBuffer[category] !== undefined) {
      countBuffer[category] += 1;
    }
    scheduleCountFlush();
  }

  /**
   * Builds the folding placeholder element
   */
  function createPlaceholder(type, originalElement) {
    const config = {
      sponsored: {
        badgeClass: 'fb-diet-badge-sponsored',
        badgeText: '🛡️ Sponsored Ad',
        label: 'Sponsored Post folded by FB Diet'
      },
      suggested: {
        badgeClass: 'fb-diet-badge-suggested',
        badgeText: '💡 Suggested',
        label: 'Suggested Content folded by FB Diet'
      },
      suggestedGroup: {
        badgeClass: 'fb-diet-badge-group',
        badgeText: '👥 Suggested Group',
        label: 'Suggested Group folded by FB Diet'
      },
      marketAds: {
        badgeClass: 'fb-diet-badge-market',
        badgeText: '🛒 Market Ad',
        label: 'Marketplace Ad folded by FB Diet'
      },
      searchingAds: {
        badgeClass: 'fb-diet-badge-search',
        badgeText: '🔍 Search Ad',
        label: 'Search Result Ad folded by FB Diet'
      }
    }[type] || {
      badgeClass: 'fb-diet-badge-sponsored',
      badgeText: '🚫 Ad Folded',
      label: 'Content folded by FB Diet'
    };

    const bar = document.createElement('div');
    bar.className = 'fb-diet-placeholder';
    bar.setAttribute('data-fb-diet-type', type);

    bar.innerHTML = `
      <div class="fb-diet-placeholder-left">
        <span class="fb-diet-badge ${config.badgeClass}">${config.badgeText}</span>
        <span class="fb-diet-label">${config.label}</span>
      </div>
      <button class="fb-diet-toggle-btn" type="button">
        <span>Expand</span> ▾
      </button>
    `;

    const toggleBtn = bar.querySelector('.fb-diet-toggle-btn');
    let isExpanded = false;

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isExpanded = !isExpanded;

      if (isExpanded) {
        originalElement.classList.add('fb-diet-is-expanded');
        bar.classList.add('fb-diet-state-expanded');
        toggleBtn.innerHTML = '<span>Collapse</span> ▴';
      } else {
        originalElement.classList.remove('fb-diet-is-expanded');
        bar.classList.remove('fb-diet-state-expanded');
        toggleBtn.innerHTML = '<span>Expand</span> ▾';
      }
    });

    return bar;
  }

  /**
   * Folds a target element and injects the interactive placeholder
   */
  function foldElement(element, type) {
    if (!element || element.dataset.fbDietFolded === 'true') return;

    element.dataset.fbDietFolded = 'true';
    element.classList.add('fb-diet-folded-original');

    const placeholder = createPlaceholder(type, element);
    element.parentNode.insertBefore(placeholder, element);

    recordBlock(type);
  }

  /**
   * Restores all folded items back to normal
   */
  function restoreAllElements() {
    document.querySelectorAll('.fb-diet-placeholder').forEach((p) => p.remove());
    document.querySelectorAll('.fb-diet-folded-original').forEach((el) => {
      el.classList.remove('fb-diet-folded-original', 'fb-diet-is-expanded');
      delete el.dataset.fbDietFolded;
      delete el.dataset.fbDietChecked;
    });
  }

  /**
   * Evaluates a single DOM node against active filters
   */
  function evaluateElement(el) {
    if (!currentSettings.enabled || !el || el.dataset.fbDietFolded === 'true') return;

    // Check Marketplace Ads
    if (currentSettings.removeMarketAds && window.FBDietDetector.isMarketAd(el)) {
      foldElement(el, 'marketAds');
      return;
    }

    // Check Search Result Ads
    if (currentSettings.removeSearchingAds && window.FBDietDetector.isSearchAd(el)) {
      foldElement(el, 'searchingAds');
      return;
    }

    // Check Sponsored Feed posts
    if (currentSettings.removeSponsored && window.FBDietDetector.isSponsored(el)) {
      foldElement(el, 'sponsored');
      return;
    }

    // Check Suggested Groups
    if (currentSettings.removeSuggestedGroup && window.FBDietDetector.isSuggestedGroup(el)) {
      foldElement(el, 'suggestedGroup');
      return;
    }

    // Check Suggested Feed posts
    if (currentSettings.removeSuggested && window.FBDietDetector.isSuggested(el)) {
      foldElement(el, 'suggested');
      return;
    }
  }

  /**
   * Scans all relevant feed and card elements on the page
   */
  function scanPage() {
    if (!currentSettings.enabled) return;

    // Standard feed items, articles, and cards
    const selectors = [
      '[role="feed"] > div',
      '[role="article"]',
      'div[data-pagelet^="FeedUnit"]',
      'div[data-virtualized="false"]',
      // Marketplace item cards
      'div[aria-label="Collection of Marketplace items"] > div',
      'div[role="main"] a[href*="/marketplace/item/"]'
    ];

    const elements = document.querySelectorAll(selectors.join(', '));
    elements.forEach((el) => {
      // Find suitable top-level wrapper if inspecting an article
      let target = el;
      if (el.getAttribute('role') === 'article') {
        const container = el.closest('[role="feed"] > div') || el.closest('[data-pagelet]') || el;
        target = container;
      }

      if (!target.dataset.fbDietChecked) {
        target.dataset.fbDietChecked = 'true';
        evaluateElement(target);
      }
    });
  }

  // Throttle scanPage calls during DOM mutations
  let scanScheduled = false;
  function triggerThrottledScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanPage();
      scanScheduled = false;
    });
  }

  /**
   * Sets up MutationObserver to handle dynamic infinite scroll feeds
   */
  function startObservation() {
    // Initial scan
    scanPage();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          triggerThrottledScan();
          break;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
})();
