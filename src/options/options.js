/**
 * FB Diet - Options Page Controller
 * Manages all feature switches, stat counters, and reset action.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const resetBtn = document.getElementById('resetBtn');
  const featuresList = document.getElementById('featuresList');
  const masterToggle = document.getElementById('enabled');
  const masterStatus = document.getElementById('masterStatus');
  const modeProxy = document.getElementById('modeProxy');
  const modeDom = document.getElementById('modeDom');

  const i18n = window.FBDietI18N;
  const langSegments = document.querySelectorAll('.lang-segment');

  const SHARED_DEFAULTS = globalThis.FB_DIET_DEFAULTS?.SETTINGS || {};
  const normalizeFoldMode = globalThis.FB_DIET_DEFAULTS?.normalizeFoldMode || ((v, fb = 'off') => {
    if (v === true) return 'mini';
    if (v === false) return 'off';
    if (v === 'title' || v === 'mini' || v === 'off') return v;
    return fb;
  });

  const DEFAULTS_MAP = globalThis.FB_DIET_DEFAULTS || {};
  const SETTING_KEYS_BY_GROUP = DEFAULTS_MAP.SETTING_KEYS_BY_GROUP || {};
  const GROUP_BY_CATEGORY = DEFAULTS_MAP.GROUP_BY_CATEGORY || {};

  let currentSettings = {};

  function getGroupFoldMode(settings, group) {
    const keys = SETTING_KEYS_BY_GROUP[group] || [];
    if (keys.length === 0) return 'off';
    const firstKey = keys[0];
    const defaultVal = SHARED_DEFAULTS[firstKey] || 'off';
    const rawVal = settings[firstKey] !== undefined ? settings[firstKey] : defaultVal;
    return normalizeFoldMode(rawVal, defaultVal);
  }

  function updateSegmentedControlUI(group, mode) {
    const container = document.querySelector(`.segmented-control[data-group="${group}"]`);
    if (!container) return;
    container.querySelectorAll('.segment-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.mode === mode);
    });
  }

  const counters = {
    total: document.getElementById('totalCount'),
    filtered: document.getElementById('filteredCount'),
    ads: document.getElementById('adsCount'),
    suggested: document.getElementById('suggestedCount'),
    media: document.getElementById('mediaCount'),
    other: document.getElementById('otherCount'),
    regular: document.getElementById('regularCount')
  };

  function updateHighlighting() {
    const isMasterActive = masterToggle ? masterToggle.checked : true;
    for (const [group, el] of Object.entries(counters)) {
      if (!el || group === 'total' || group === 'filtered') continue;
      const mode = getGroupFoldMode(currentSettings, group);
      const isFolded = isMasterActive && mode !== 'off';
      el.classList.toggle('active-folded', Boolean(isFolded));
    }
  }

  function renderCounts(counts) {
    if (!counts) return;
    if (counters.total) counters.total.textContent = (counts.total || 0).toLocaleString();
    if (counters.filtered) counters.filtered.textContent = (counts.filtered || 0).toLocaleString();
    // Counts are stored per category; the breakdown shows user-facing groups.
    if (counters.ads) counters.ads.textContent = ((counts.sponsored || 0) + (counts.marketAds || 0) + (counts.searchingAds || 0)).toLocaleString();
    if (counters.suggested) counters.suggested.textContent = (counts.suggested || 0).toLocaleString();
    if (counters.media) counters.media.textContent = ((counts.stories || 0) + (counts.reels || 0)).toLocaleString();
    if (counters.other) counters.other.textContent = (counts.suggestedGroup || 0).toLocaleString();
    if (counters.regular) counters.regular.textContent = (counts.regular || 0).toLocaleString();
    updateHighlighting();
  }

  function updateMasterUI(isEnabled) {
    if (masterToggle) masterToggle.checked = isEnabled;
    if (masterStatus) masterStatus.textContent = i18n ? i18n.t(isEnabled ? 'masterStatusActive' : 'masterStatusDisabled') : (isEnabled ? 'Active' : 'Disabled');
    if (isEnabled) {
      featuresList.classList.remove('disabled');
    } else {
      featuresList.classList.add('disabled');
    }
    updateHighlighting();
  }

  function updateModeUI(mode) {
    if (mode === 'dom') {
      if (modeDom) modeDom.checked = true;
    } else {
      if (modeProxy) modeProxy.checked = true;
    }
  }

  // Applies all data-i18n / data-i18n-title translations for the active language.
  function applyTranslations() {
    if (!i18n) return;
    const lang = i18n.getLang();
    document.documentElement.lang = lang;
    document.title = i18n.t('optionsTitle');
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = i18n.t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = i18n.t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = i18n.t(el.dataset.i18nPlaceholder);
    });
    langSegments.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.lang === lang);
    });
    // Dynamic statuses depend on the language too.
    updateMasterUI(masterToggle ? masterToggle.checked : true);
  }

  // Load initial settings and counts
  const data = await chrome.storage.local.get(['settings', 'counts']);
  const settings = data.settings || {};
  const counts = data.counts || {};

  // Resolve language: stored setting wins, otherwise detect from the browser UI.
  const lang = settings.lang || (i18n ? i18n.detect() : 'en');
  if (i18n) i18n.setLang(lang);
  if (!settings.lang && i18n) {
    chrome.storage.local.set({ settings: { ...settings, lang } });
  }

  currentSettings = { ...SHARED_DEFAULTS, ...settings };

  // Initialize master switch, mode & feature segmented controls
  updateMasterUI(currentSettings.enabled !== false);
  updateModeUI(currentSettings.mode || 'proxy');

  const groups = ['regular', 'ads', 'suggested', 'media', 'other'];
  groups.forEach(group => {
    const mode = getGroupFoldMode(currentSettings, group);
    updateSegmentedControlUI(group, mode);
  });

  const debugProbe = document.getElementById('debugProbe');
  if (debugProbe) {
    debugProbe.checked = Boolean(currentSettings.debugProbe);
  }

  // Initialize counts
  renderCounts(counts);

  // Apply the resolved language to the whole page
  applyTranslations();

  // Language switch: the whole block is one click target that toggles en <-> zh-TW.
  const langSwitch = document.getElementById('langSwitch');
  async function toggleLanguage() {
    if (!i18n) return;
    const next = i18n.getLang() === 'en' ? 'zh-TW' : 'en';
    i18n.setLang(next);
    const { settings: current } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...current, lang: next } });
    applyTranslations();
  }
  if (langSwitch) {
    langSwitch.addEventListener('click', toggleLanguage);
    langSwitch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleLanguage();
      }
    });
  }

  // Handle Master toggle
  if (masterToggle) {
    masterToggle.addEventListener('change', async () => {
      const active = masterToggle.checked;
      updateMasterUI(active);
      const { settings: current } = await chrome.storage.local.get('settings');
      const updated = { ...current, enabled: active };
      currentSettings = updated;
      await chrome.storage.local.set({ settings: updated });
    });
  }

  // Handle Engine Mode toggle
  async function handleModeSelect(selectedMode) {
    const { settings: current } = await chrome.storage.local.get('settings');
    const updated = { ...current, mode: selectedMode };
    currentSettings = updated;
    await chrome.storage.local.set({ settings: updated });
  }

  if (modeProxy) {
    modeProxy.addEventListener('change', () => {
      if (modeProxy.checked) handleModeSelect('proxy');
    });
  }
  if (modeDom) {
    modeDom.addEventListener('change', () => {
      if (modeDom.checked) handleModeSelect('dom');
    });
  }

  // Handle Segmented controls changes
  document.querySelectorAll('.segmented-control[data-group]').forEach(container => {
    const group = container.dataset.group;
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('.segment-btn');
      if (!btn || !btn.dataset.mode) return;
      const mode = btn.dataset.mode;
      updateSegmentedControlUI(group, mode);
      const { settings: current } = await chrome.storage.local.get('settings');
      const updated = { ...current };
      for (const key of SETTING_KEYS_BY_GROUP[group] || []) {
        updated[key] = mode;
      }
      currentSettings = updated;
      await chrome.storage.local.set({ settings: updated });
      updateHighlighting();
    });
  });

  // Handle debug probe toggle
  if (debugProbe) {
    debugProbe.addEventListener('change', async () => {
      const { settings: current } = await chrome.storage.local.get('settings');
      const updated = { ...current, debugProbe: debugProbe.checked };
      currentSettings = updated;
      await chrome.storage.local.set({ settings: updated });
    });
  }

  // Handle Reset button
  resetBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_COUNTS' }, (res) => {
      if (res && res.counts) {
        renderCounts(res.counts);
      } else {
        renderCounts({ date: '', total: 0, filtered: 0, sponsored: 0, suggested: 0, suggestedGroup: 0, marketAds: 0, searchingAds: 0, stories: 0, reels: 0, regular: 0 });
      }
    });
  });

  /* ------------------------------------------------------------------ *
   * Debug card: probe report analyzer
   *
   * All classification logic lives in classify.js (classifyProbeReport, pure
   * & Node-tested). This block only translates the result object into DOM.
   * ------------------------------------------------------------------ */
  const probeInput = document.getElementById('probeInput');
  const probeRun = document.getElementById('probeRun');
  const probeResult = document.getElementById('probeResult');
  const CLASSIFY = window.FBDietClassify || null;

  const CATEGORY_I18N = {
    sponsored: 'labelSponsored',
    suggested: 'labelSuggested',
    suggestedGroup: 'labelGroups',
    marketAds: 'labelMarket',
    searchingAds: 'labelSearch',
    stories: 'labelStories',
    reels: 'labelReels',
    regular: 'labelRegular'
  };

  function tt(key) {
    return i18n ? i18n.t(key) : key;
  }

  function makeProbeEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function categoryLabel(category) {
    const key = CATEGORY_I18N[category];
    return key ? tt(key) : String(category);
  }

  // The analyzer reports both layers: the fine-grained feed type plus the
  // user-facing group it belongs to (STRATEGY.md, decision #8).
  const GROUP_I18N = {
    ads: 'groupAdsTitle',
    regular: 'groupRegularTitle',
    suggested: 'groupSuggestedTitle',
    media: 'groupMediaTitle',
    other: 'groupOtherTitle'
  };

  function groupLabel(category) {
    const group = GROUP_BY_CATEGORY[category] || 'regular';
    return tt(GROUP_I18N[group] || 'groupRegularTitle');
  }

  function appendVerdictRow(container, label, result) {
    const row = makeProbeEl('div', 'probe-row');
    row.appendChild(makeProbeEl('span', 'probe-row-label', label));
    const value = makeProbeEl('span', 'probe-row-value');
    if (!result || !result.category) {
      // No category means "no rule matched", which for the reader is a normal post:
      // reuse the stats wording so both surfaces name it identically.
      value.appendChild(makeProbeEl('span', 'probe-badge probe-badge-none', tt('labelRegular')));
    } else {
      value.appendChild(makeProbeEl('span', 'probe-badge probe-badge-' + result.category, categoryLabel(result.category)));
    }
    if (result && result.reason) {
      value.appendChild(makeProbeEl('span', 'probe-reason', String(result.reason)));
    }
    value.appendChild(makeProbeEl('span', 'probe-group', tt('probeGroupLabel') + ': ' + groupLabel(result && result.category)));
    row.appendChild(value);
    container.appendChild(row);
  }

  function appendDetailLink(container, url, text) {
    if (!url || typeof url !== 'string') return;
    const a = document.createElement('a');
    a.className = 'probe-link';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = text || '🔗';
    container.appendChild(a);
  }

  function renderProbeResult(analysis, report) {
    probeResult.replaceChildren();
    probeResult.classList.add('has-result');

    if (!analysis.ok) {
      const keyByError = {
        'not-an-object': 'probeErrorNotJson',
        'missing-classify': 'probeErrorMissingClassify',
        'missing-payload': 'probeErrorMissingPayload'
      };
      const key = keyByError[analysis.error] || 'probeErrorGeneric';
      probeResult.appendChild(makeProbeEl('div', 'probe-error', tt(key)));
      return;
    }

    appendVerdictRow(probeResult, tt('probeCapturedLabel'), analysis.captured);
    appendVerdictRow(probeResult, tt('probeCurrentLabel'), analysis.current);

    const capturedCategory = analysis.captured.category || null;
    const currentCategory = analysis.current ? analysis.current.category : null;
    if (capturedCategory && !currentCategory && !analysis.relayAvailable) {
      probeResult.appendChild(makeProbeEl('div', 'probe-note', tt('probeNoteSnapshotLimited')));
    }

    if (report && report.moduleName) {
      const row = makeProbeEl('div', 'probe-row');
      row.appendChild(makeProbeEl('span', 'probe-row-label', tt('probeModuleLabel')));
      row.appendChild(makeProbeEl('span', 'probe-module', String(report.moduleName)));
      probeResult.appendChild(row);
    }

    if (report && report.href) {
      const row = makeProbeEl('div', 'probe-row');
      row.appendChild(makeProbeEl('span', 'probe-row-label', tt('probeUrlLabel')));
      const val = makeProbeEl('span', 'probe-module');
      appendDetailLink(val, report.href, report.href);
      row.appendChild(val);
      probeResult.appendChild(row);
    }

    const relayStatus = (report && report.memory && report.memory.relayStatus) || (report && report.relayStatus);
    if (relayStatus) {
      const row = makeProbeEl('div', 'probe-row');
      row.appendChild(makeProbeEl('span', 'probe-row-label', tt('probeRelayStatus')));
      const statText = (relayStatus.isReady ? 'Ready' : 'Not ready') + ' (sources: ' + relayStatus.sourceCount + ')';
      row.appendChild(makeProbeEl('span', 'probe-module', statText));
      probeResult.appendChild(row);
    }

    // Enrichment collapsible card (Memory)
    const enrich = (report && report.memory && report.memory.enrichment) || (report && report.enrichment);
    if (enrich && typeof enrich === 'object') {
      const details = document.createElement('details');
      details.className = 'probe-section';
      details.open = true;

      const summary = document.createElement('summary');
      summary.className = 'probe-section-title';
      summary.textContent = '📦 ' + tt('probeEnrichmentTitle');
      details.appendChild(summary);

      const contentBox = makeProbeEl('div', 'probe-section-body');

      // Actor
      if (enrich.actor) {
        const actorRow = makeProbeEl('div', 'probe-sub-row');
        actorRow.appendChild(makeProbeEl('span', 'probe-sub-label', tt('probeActorLabel') + ': '));
        const txt = (enrich.actor.name || '?') +
          (enrich.actor.typename ? ' (' + enrich.actor.typename + ')' : '') +
          ' | sub: ' + (enrich.actor.subscribeStatus || 'NULL') +
          (enrich.actor.id ? ' | id: ' + enrich.actor.id : '');
        actorRow.appendChild(makeProbeEl('span', 'probe-sub-val', txt));
        contentBox.appendChild(actorRow);
      }

      // Group
      if (enrich.group && (enrich.group.name || enrich.group.joinState || enrich.group.permalink)) {
        const groupRow = makeProbeEl('div', 'probe-sub-row');
        groupRow.appendChild(makeProbeEl('span', 'probe-sub-label', tt('probeGroupName') + ': '));
        const txt = (enrich.group.name || '?') +
          ' | join: ' + (enrich.group.joinState || 'NULL') +
          (enrich.group.id ? ' | id: ' + enrich.group.id : '');
        groupRow.appendChild(makeProbeEl('span', 'probe-sub-val', txt));
        if (enrich.group.permalink) {
          appendDetailLink(groupRow, enrich.group.permalink, ' ↗');
        }
        contentBox.appendChild(groupRow);
      }

      // Content (Message, Title, Permalinks, Timestamps, CTA, Feed Context)
      if (enrich.content) {
        const cRow = makeProbeEl('div', 'probe-sub-row');
        cRow.appendChild(makeProbeEl('span', 'probe-sub-label', tt('probeContentLabel') + ': '));
        const timeTxt = enrich.content.createdAt ? enrich.content.createdAt : (enrich.content.createdTime ? String(enrich.content.createdTime) : '');
        const metaTxt = (timeTxt ? ' 🕒 ' + timeTxt : '') +
          (enrich.content.callToAction ? ' | CTA: ' + enrich.content.callToAction : '') +
          (enrich.content.feedContext ? ' | context: ' + enrich.content.feedContext : '') +
          (enrich.content.isReshare ? ' | [Reshare]' : '');
        cRow.appendChild(makeProbeEl('span', 'probe-sub-val', metaTxt));
        if (enrich.content.permalink) {
          appendDetailLink(cRow, enrich.content.permalink, ' ↗');
        }
        contentBox.appendChild(cRow);

        if (enrich.content.title) {
          const titleRow = makeProbeEl('div', 'probe-sub-row probe-sub-indent');
          titleRow.appendChild(makeProbeEl('span', 'probe-sub-label', '↳ ' + tt('probeTitleLabel') + ': '));
          titleRow.appendChild(makeProbeEl('span', 'probe-sub-val', enrich.content.title));
          contentBox.appendChild(titleRow);
        }

        if (enrich.content.message) {
          const msgRow = makeProbeEl('div', 'probe-sub-row probe-sub-indent');
          msgRow.appendChild(makeProbeEl('span', 'probe-sub-val probe-msg-snippet', enrich.content.message));
          contentBox.appendChild(msgRow);
        }
      }

      // Media
      if (enrich.media) {
        const mRow = makeProbeEl('div', 'probe-sub-row');
        mRow.appendChild(makeProbeEl('span', 'probe-sub-label', tt('probeMediaLabel') + ': '));
        const txt = 'count: ' + (enrich.media.count !== null ? enrich.media.count : 'NULL') +
          (Array.isArray(enrich.media.types) ? ' [' + enrich.media.types.join(', ') + ']' : '') +
          (enrich.media.hasVideo ? ' (Video)' : '');
        mRow.appendChild(makeProbeEl('span', 'probe-sub-val', txt));
        contentBox.appendChild(mRow);
      }

      // Viewer
      if (enrich.viewer) {
        const vRow = makeProbeEl('div', 'probe-sub-row');
        vRow.appendChild(makeProbeEl('span', 'probe-sub-label', tt('probeViewerLabel') + ': '));
        vRow.appendChild(makeProbeEl('span', 'probe-sub-val', 'isSelf: ' + String(enrich.viewer.isSelf)));
        contentBox.appendChild(vRow);
      }

      details.appendChild(contentBox);
      probeResult.appendChild(details);
    }

    // Relay Reads collapsible card (壓行顯示：path → value)
    if (report && Array.isArray(report.relayReads) && report.relayReads.length) {
      const details = document.createElement('details');
      details.className = 'probe-section';
      const summary = document.createElement('summary');
      summary.className = 'probe-section-title';
      summary.textContent = '⚡ ' + tt('probeRelayReadsTitle') + ' (' + report.relayReads.length + ')';
      details.appendChild(summary);

      const list = makeProbeEl('div', 'probe-section-body probe-relay-list');
      for (const item of report.relayReads) {
        const row = makeProbeEl('div', 'probe-relay-row');
        row.appendChild(makeProbeEl('span', 'probe-relay-path', item.path));
        row.appendChild(makeProbeEl('span', 'probe-relay-arrow', ' → '));
        if (item.value === null || item.value === undefined) {
          row.appendChild(makeProbeEl('span', 'probe-null', 'NULL'));
        } else {
          row.appendChild(makeProbeEl('span', 'probe-relay-val', String(item.value)));
        }
        list.appendChild(row);
      }
      details.appendChild(list);
      probeResult.appendChild(details);
    }

    // Record Keys collapsible card
    if (report && Array.isArray(report.recordKeys) && report.recordKeys.length) {
      const details = document.createElement('details');
      details.className = 'probe-section';
      const summary = document.createElement('summary');
      summary.className = 'probe-section-title';
      summary.textContent = '🔑 ' + tt('probeRecordKeysTitle') + ' (' + report.recordKeys.length + ')';
      details.appendChild(summary);

      const keysBox = makeProbeEl('div', 'probe-section-body probe-keys-box');
      for (const k of report.recordKeys) {
        keysBox.appendChild(makeProbeEl('span', 'probe-key-tag', k));
      }
      details.appendChild(keysBox);
      probeResult.appendChild(details);
    }

    // Diagnostic Signals collapsible card
    if (report && Array.isArray(report.signals) && report.signals.length) {
      const details = document.createElement('details');
      details.className = 'probe-section';
      details.open = true;
      const summary = document.createElement('summary');
      summary.className = 'probe-section-title';
      summary.textContent = '🎯 ' + tt('probeSignalsTitle') + ' (' + report.signals.length + ')';
      details.appendChild(summary);

      const list = makeProbeEl('div', 'probe-section-body probe-relay-list');
      for (const item of report.signals) {
        const row = makeProbeEl('div', 'probe-relay-row');
        row.appendChild(makeProbeEl('span', 'probe-relay-path', item.path));
        row.appendChild(makeProbeEl('span', 'probe-relay-arrow', ' → '));
        row.appendChild(makeProbeEl('span', 'probe-relay-val', String(item.value)));
        list.appendChild(row);
      }
      details.appendChild(list);
      probeResult.appendChild(details);
    }
  }

  if (probeRun && probeInput && probeResult) {
    probeRun.addEventListener('click', () => {
      if (!CLASSIFY || typeof CLASSIFY.classifyProbeReport !== 'function') {
        probeResult.replaceChildren();
        probeResult.classList.add('has-result');
        probeResult.appendChild(makeProbeEl('div', 'probe-error', tt('probeErrorNoClassifier')));
        return;
      }
      let report = null;
      try {
        report = JSON.parse(probeInput.value);
      } catch (e) {
        probeResult.replaceChildren();
        probeResult.classList.add('has-result');
        probeResult.appendChild(makeProbeEl('div', 'probe-error', tt('probeErrorNotJson')));
        return;
      }
      renderProbeResult(CLASSIFY.classifyProbeReport(report), report);
    });
  }

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.counts) {
        renderCounts(changes.counts.newValue);
      }
      if (changes.settings) {
        const s = changes.settings.newValue;
        if (s) {
          if (s.enabled !== undefined) updateMasterUI(s.enabled !== false);
          if (s.mode) updateModeUI(s.mode);
          for (const [key, checkbox] of Object.entries(switches)) {
            if (!checkbox) continue;
            const group = GROUP_BY_SWITCH[key];
            if (group) checkbox.checked = isGroupOn(s, group);
            else if (s[key] !== undefined) checkbox.checked = s[key];
          }
          updateHighlighting();
          if (s.lang && i18n && s.lang !== i18n.getLang()) {
            i18n.setLang(s.lang);
            applyTranslations();
          }
        }
      }
    }
  });
});
