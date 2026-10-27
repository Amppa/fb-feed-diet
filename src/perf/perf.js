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
  const CLASS_DIALOG_EXITING = 'fb-diet-dialog-exiting';

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
  let modalGraceTimer = null;
  let exitListenersAttached = false;

  function getActiveDialog() {
    if (typeof document === 'undefined') return null;
    if (typeof document.querySelectorAll !== 'function') {
      return typeof document.querySelector === 'function' ? document.querySelector('div[role="dialog"]') : null;
    }
    const dialogs = document.querySelectorAll('div[role="dialog"], div[aria-modal="true"]');
    // Traverse backwards to target the top-most/latest mounted dialog (e.g. Photo Theater)
    for (let i = dialogs.length - 1; i >= 0; i--) {
      const d = dialogs[i];
      if (!d) continue;
      const hasAttr = typeof d.getAttribute === 'function';
      const isAriaModal = hasAttr && d.getAttribute('aria-modal') === 'true';
      // Skip background hidden zero-size elements like unmounted notification popups
      const isVisible = isAriaModal ||
                        (typeof d.offsetWidth === 'number' && d.offsetWidth > 0) ||
                        (typeof d.offsetHeight === 'number' && d.offsetHeight > 0) ||
                        (typeof d.getClientRects === 'function' && d.getClientRects().length > 0) ||
                        (typeof d.offsetWidth === 'undefined' && typeof d.offsetHeight === 'undefined');
      if (isVisible) {
        return d;
      }
    }
    return null;
  }

  function hasSubmenuOrUnsavedInput() {
    if (typeof document === 'undefined') return false;
    // 1. If an inner popup / menu is open (e.g. emoji picker, reaction list, more menu)
    if (document.querySelector('div[role="menu"], div[role="listbox"], [data-surface*="menu"]')) {
      return true;
    }
    // 2. If user is actively typing in an input with text (avoid eating confirmation modal)
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      const text = active.value || active.textContent || '';
      if (text.trim().length > 0) return true;
    }
    return false;
  }

  function triggerInstantExit() {
    const dialog = getActiveDialog();
    if (!dialog) return;
    // Do not hide if nested menu or unsaved comment is active
    if (hasSubmenuOrUnsavedInput()) return;
    if (!dialog.classList.contains(CLASS_DIALOG_EXITING)) {
      dialog.classList.add(CLASS_DIALOG_EXITING);
    }
  }

  function handleExitKey(e) {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      triggerInstantExit();
    }
  }

  function handleExitClick(e) {
    if (!e.target || typeof e.target.closest !== 'function') return;
    const closeBtn = e.target.closest(
      'div[aria-label="Close"], div[aria-label="關閉"], div[aria-label="Cerrar"], [aria-label*="Close" i], [aria-label*="關閉"]'
    );
    if (closeBtn) {
      triggerInstantExit();
    }
  }

  function attachExitListeners() {
    if (exitListenersAttached || typeof document === 'undefined') return;
    document.addEventListener('keydown', handleExitKey, true);
    document.addEventListener('click', handleExitClick, true);
    exitListenersAttached = true;
  }

  function detachExitListeners() {
    if (!exitListenersAttached || typeof document === 'undefined') return;
    document.removeEventListener('keydown', handleExitKey, true);
    document.removeEventListener('click', handleExitClick, true);
    exitListenersAttached = false;
  }

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
      detachExitListeners();
      if (modalObserver) {
        modalObserver.disconnect();
        modalObserver = null;
      }
    } else {
      attachExitListeners();
      checkAndObserveModals();
    }
  }

  function checkDialogPresence() {
    if (typeof document === 'undefined') return false;
    // Check for Facebook photo theater or modal dialog
    return Boolean(getActiveDialog());
  }

  function syncModalState() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const hasModal = checkDialogPresence();
    if (hasModal) {
      if (modalGraceTimer) {
        clearTimeout(modalGraceTimer);
        modalGraceTimer = null;
      }
      const active = getActiveDialog();
      if (active && active.classList && active.classList.contains(CLASS_DIALOG_EXITING)) {
        active.classList.remove(CLASS_DIALOG_EXITING);
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
