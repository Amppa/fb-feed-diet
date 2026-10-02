/**
 * FB Diet - Probe Popup UI Module (MAIN world)
 *
 * Owns the unified lifecycle probe popup: clipboard copy with prompt fallback,
 * popup open/close lifecycle, and the unified report renderer. Split out of
 * probe.js (combination A): the report data layer (buildProbeReport,
 * collectProbeContext, compaction) stays in probe.js; this file owns
 * presentation only.
 *
 * Public API: window.FBDietProbePopup
 * probe.js keeps thin same-named wrappers that delegate here, so the public
 * window.FBDietProbe surface is unchanged.
 */
window.FBDietProbePopup = (() => {
  'use strict';

  let activeProbePopup = null;

  function promptFallbackCopy(payload) {
    try {
      window.prompt('FB Diet diagnostics - select all & copy (Ctrl+C / Cmd+C):', payload);
    } catch (e) {
      // Last resort: the console already carries the same report
    }
  }

  function copyProbeReport(text) {
    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        const request = navigator.clipboard.writeText(text);
        if (request && typeof request.then === 'function') {
          request.then(
            () => console.info('[FB Diet][Probe] Diagnostics copied to clipboard.'),
            () => promptFallbackCopy(text)
          );
          copied = true;
        }
      }
    } catch (e) {
      // Fall through to the prompt
    }
    if (!copied) promptFallbackCopy(text);
  }

  function closeActiveProbePopup() {
    if (!activeProbePopup) return;
    const popup = activeProbePopup;
    activeProbePopup = null;
    try {
      const doc = (typeof document !== 'undefined' ? document : null) || (typeof window !== 'undefined' && window.document ? window.document : null);
      if (doc && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('click', onOutsideProbeClick, true);
      }
      if (popup.classList && typeof popup.classList.add === 'function') {
        popup.classList.add('fb-diet-probe-popup-fadeout');
      }
      setTimeout(() => {
        try { popup.remove(); } catch (e) {}
      }, 200);
    } catch (e) {}
  }

  function onOutsideProbeClick(e) {
    if (!activeProbePopup) return;
    if (e && e.target && activeProbePopup.contains(e.target)) {
      return;
    }
    closeActiveProbePopup();
  }

  function popupRow(doc, text) {
    const row = doc.createElement('div');
    row.className = 'fb-diet-probe-popup-row';
    row.textContent = text;
    return row;
  }

  function popupCopiedFooter(doc, label) {
    const spacer = doc.createElement('div');
    spacer.className = 'fb-diet-probe-popup-spacer';
    return [spacer, popupRow(doc, '已複製 ' + label + ' 診斷 JSON 到剪貼簿 (Copied)')];
  }

  function renderUnifiedPopup(doc, popup, report, classifyResult, props) {
    const modeStr = (report && report.env && report.env.dietMode ? report.env.dietMode : 'relay').toUpperCase();
    const verdict = (report && report.verdict) || {};
    const category = verdict.category
      || (classifyResult && classifyResult.category)
      || (props && props.entryCategory)
      || 'regular';
    const reason = verdict.reason
      || (classifyResult && classifyResult.reason)
      || (props && props.moduleName ? 'component:' + props.moduleName : 'no-match');

    const evidence = classifyResult && classifyResult.evidence;
    const source = evidence && evidence.source && evidence.source !== 'none' ? evidence.source : null;
    const mod = (classifyResult && classifyResult.moduleName) || (report && report.unit && report.unit.moduleName) || null;
    let evidenceText = source || '';
    if (mod) {
      evidenceText = evidenceText ? evidenceText + ' (' + mod + ')' : mod;
    }
    if (!evidenceText) evidenceText = 'none';

    const ui = window.FBDietUI;
    const userFacingGroup = ui && typeof ui.groupOf === 'function' ? ui.groupOf(category) : 'regular';
    const groupMeta = (ui && ui.GROUP_META && ui.GROUP_META[userFacingGroup]) || { badgeText: 'Other' };

    const foldMode = verdict.foldMode || 'off';
    const statusText = foldMode !== 'off' ? 'ON (' + foldMode + ')' : 'OFF';

    popup.appendChild(popupRow(doc, 'Mode: ' + modeStr + ' · Filter: ' + statusText));
    const uiTagSuffix = verdict.displayedTag && verdict.displayedTag !== groupMeta.badgeText ? ' [UI: ' + verdict.displayedTag + ']' : '';
    popup.appendChild(popupRow(doc, 'Category: ' + groupMeta.badgeText + ' (' + category + ')' + uiTagSuffix));
    popup.appendChild(popupRow(doc, 'Signal: ' + reason));
    const sourceText = verdict.detectionSource ? evidenceText + ' · Detection: ' + verdict.detectionSource : evidenceText;
    popup.appendChild(popupRow(doc, 'Source: ' + sourceText));

    const scope = verdict.scope;
    if (scope) {
      popup.appendChild(popupRow(doc, 'Scope: ' + (scope.allowed ? 'home/search/marketplace' : 'groups/profile')));
    }

    const dom = (report && report.dom) || {};
    const ext = dom.extracted || {};
    const urls = dom.urls || {};

    if (ext.actor || ext.group) {
      popup.appendChild(popupRow(doc, 'Author: ' + (ext.actor || '-') + (ext.group ? ' · Group: ' + ext.group : '')));
    }
    if (ext.title && ext.title.text) {
      popup.appendChild(popupRow(doc, 'Title: ' + (ext.title.text.length > 40 ? ext.title.text.slice(0, 40) + '…' : ext.title.text)));
    }
    if (ext.snippet) {
      popup.appendChild(popupRow(doc, 'Snippet: ' + (ext.snippet.length > 40 ? ext.snippet.slice(0, 40) + '…' : ext.snippet)));
    }
    if (ext.media) {
      popup.appendChild(popupRow(doc, 'Media: ' + ext.media));
    }

    const targetUrl = urls.synthesized || urls.primary || urls.ad;
    if (targetUrl) {
      const linkRow = doc.createElement('div');
      linkRow.className = 'fb-diet-probe-popup-row';
      const linkPrefix = doc.createElement('span');
      linkPrefix.textContent = 'Link: ';
      linkRow.appendChild(linkPrefix);
      const anchor = doc.createElement('a');
      anchor.href = targetUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = targetUrl.length > 50 ? targetUrl.slice(0, 50) + '…' : targetUrl;
      if (anchor.style) {
        anchor.style.color = '#60a5fa';
        anchor.style.textDecoration = 'underline';
        anchor.style.cursor = 'pointer';
      }
      anchor.title = targetUrl;
      if (typeof anchor.addEventListener === 'function') {
        anchor.addEventListener('click', (e) => {
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        });
      }
      linkRow.appendChild(anchor);
      popup.appendChild(linkRow);
    }

    const footer = popupCopiedFooter(doc, '生命週期');
    footer.forEach((node) => popup.appendChild(node));
  }

  function showProbePopup(holder, classifyResult, props, report) {
    try {
      const doc = (typeof document !== 'undefined' ? document : null)
        || (typeof window !== 'undefined' && window.document ? window.document : null)
        || (holder && holder.ownerDocument ? holder.ownerDocument : null);
      if (!holder || !doc || typeof doc.createElement !== 'function') return;

      closeActiveProbePopup();

      const popup = doc.createElement('div');
      popup.className = 'fb-diet-probe-popup';
      popup.title = '點擊外部可關閉提示 (Click outside to dismiss)';

      renderUnifiedPopup(doc, popup, report, classifyResult, props);

      holder.appendChild(popup);
      activeProbePopup = popup;

      // Close on subsequent outside click
      setTimeout(() => {
        if (activeProbePopup === popup && doc && typeof doc.addEventListener === 'function') {
          doc.addEventListener('click', onOutsideProbeClick, true);
        }
      }, 0);
    } catch (e) {
      // Non-fatal
    }
  }

  return {
    promptFallbackCopy,
    copyProbeReport,
    closeActiveProbePopup,
    showProbePopup
  };
})();
