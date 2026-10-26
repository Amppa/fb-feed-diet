/**
 * FB Feed Diet — Performance Diet Module (perf.js)
 *
 * Standalone performance controller for Facebook:
 * 1. Manages the CSS containment token (fb-diet-perf-cv) on <html>.
 * 2. Monitors photo lightbox / modal dialogs and applies 'fb-diet-perf-modal-active'
 *    (contain: layout paint) to prevent massive global reflows when dialogs are closed.
 * 3. Listens to storage changes to dynamically apply/remove optimizations in real-time.
 */

(() => {
  'use strict';

  // CSS token classes
  const CLASS_CONTENT_VISIBILITY = 'fb-diet-perf-cv';
  const CLASS_MODAL_ACTIVE = 'fb-diet-perf-modal-active';

  // How long the containment shield outlives the dialog it was armed for. Facebook restores
  // `body { overflow }` on teardown, and dropping the shield in that same tick left the feed
  // exposed to the reflow it exists to absorb (Decision #63).
  const MODAL_GRACE_MS = 350;

  let currentSettings = {
    perfMode: true,
    perfContentVisibility: true,
    perfModalIsolation: true
  };

  let modalObserver = null;

  function updateRootTokens() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const docEl = document.documentElement;
    const isMasterOn = currentSettings.perfMode !== false;

    // 1. Content Visibility
    const enableCv = isMasterOn && currentSettings.perfContentVisibility !== false;
    docEl.classList.toggle(CLASS_CONTENT_VISIBILITY, enableCv);

    // 2. Modal Isolation state
    if (!isMasterOn || currentSettings.perfModalIsolation === false) {
      docEl.classList.remove(CLASS_MODAL_ACTIVE);
      if (modalObserver) {
        modalObserver.disconnect();
        modalObserver = null;
      }
    } else {
      checkAndObserveModals();
    }
  }

  function checkDialogPresence() {
    if (typeof document === 'undefined') return false;
    // Check for Facebook photo theater or modal dialog
    return Boolean(
      document.querySelector('div[role="dialog"]') ||
      document.querySelector('div[aria-modal="true"]')
    );
  }

  let modalGraceTimer = null;

  function syncModalState() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const hasModal = checkDialogPresence();
    if (hasModal) {
      if (modalGraceTimer) {
        clearTimeout(modalGraceTimer);
        modalGraceTimer = null;
      }
      document.documentElement.classList.add(CLASS_MODAL_ACTIVE);
    } else {
      // If modal was active, keep containment shield active for the grace period
      // to absorb the global reflow caused by body overflow:hidden removal
      if (document.documentElement.classList.contains(CLASS_MODAL_ACTIVE) && !modalGraceTimer) {
        modalGraceTimer = setTimeout(() => {
          document.documentElement.classList.remove(CLASS_MODAL_ACTIVE);
          modalGraceTimer = null;
        }, MODAL_GRACE_MS);
      }
    }
  }

  function checkAndObserveModals() {
    syncModalState();
    if (modalObserver || typeof MutationObserver === 'undefined') return;

    try {
      modalObserver = new MutationObserver(() => {
        syncModalState();
      });

      const target = document.body || document.documentElement;
      if (target) {
        modalObserver.observe(target, {
          childList: true,
          subtree: false // Top-level dialogs are mounted directly on body
        });
      }
    } catch (e) {
      // Degrade gracefully if observer fails
    }
  }

  // Load initial settings from chrome.storage if available
  function init() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('settings', (res) => {
        if (res && res.settings) {
          currentSettings = Object.assign({}, currentSettings, res.settings);
        }
        updateRootTokens();
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.settings && changes.settings.newValue) {
          currentSettings = Object.assign({}, currentSettings, changes.settings.newValue);
          updateRootTokens();
        }
      });
    } else {
      updateRootTokens();
    }

    // Ensure DOM is ready for body observation
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', updateRootTokens, { once: true });
    } else {
      updateRootTokens();
    }
  }

  init();
})();
