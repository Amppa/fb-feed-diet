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
  const DEFAULTS = {
    foldSponsored: SHARED_DEFAULTS.foldSponsored !== false,
    foldSuggested: SHARED_DEFAULTS.foldSuggested !== false,
    foldSuggestedGroup: SHARED_DEFAULTS.foldSuggestedGroup !== false,
    foldStories: SHARED_DEFAULTS.foldStories !== false,
    foldReels: SHARED_DEFAULTS.foldReels !== false,
    foldMarketAds: SHARED_DEFAULTS.foldMarketAds !== false,
    foldSearchingAds: SHARED_DEFAULTS.foldSearchingAds !== false,
    debugProbe: Boolean(SHARED_DEFAULTS.debugProbe)
  };

  const switches = {};
  document.querySelectorAll('#featuresList input[type="checkbox"], #debugCard input[type="checkbox"]').forEach(input => {
    if (input.id) switches[input.id] = input;
  });

  // Options exposes one switch per user-facing group (STRATEGY.md, decision #8).
  // Storage stays per-category: a group switch batch-writes its mapped keys.
  const DEFAULTS_MAP = globalThis.FB_DIET_DEFAULTS || {};
  const SETTING_KEYS_BY_GROUP = DEFAULTS_MAP.SETTING_KEYS_BY_GROUP || {};
  const GROUP_BY_CATEGORY = DEFAULTS_MAP.GROUP_BY_CATEGORY || {};

  const GROUP_BY_SWITCH = {
    groupAds: 'ads',
    groupSuggested: 'suggested',
    groupMedia: 'media',
    groupOther: 'other'
  };
  const SWITCH_BY_GROUP = {
    ads: 'groupAds',
    suggested: 'groupSuggested',
    media: 'groupMedia',
    other: 'groupOther'
  };

  // A group reads "on" only when every mapped category key is on.
  function isGroupOn(settings, group) {
    const keys = SETTING_KEYS_BY_GROUP[group] || [];
    return keys.length > 0 && keys.every((key) => settings[key] !== false);
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
      if (!el || group === 'total' || group === 'filtered' || group === 'regular') continue;
      const switchId = SWITCH_BY_GROUP[group];
      const isFolded = isMasterActive && switchId && switches[switchId] ? switches[switchId].checked : false;
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
      const active = btn.dataset.lang === lang;
      btn.classList.toggle('is-active', active);
      if (active) btn.setAttribute('aria-pressed', 'true');
      else btn.removeAttribute('aria-pressed');
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

  // Initialize master switch, mode & feature switches
  updateMasterUI(settings.enabled !== false);
  updateModeUI(settings.mode || 'proxy');

  for (const [key, checkbox] of Object.entries(switches)) {
    if (!checkbox) continue;
    const group = GROUP_BY_SWITCH[key];
    if (group) {
      checkbox.checked = isGroupOn(settings, group);
    } else {
      const defaultValue = DEFAULTS[key] ?? true;
      checkbox.checked = settings[key] !== undefined ? settings[key] : defaultValue;
    }
  }

  // Initialize counts
  renderCounts(counts);

  // Apply the resolved language to the whole page
  applyTranslations();

  // Language switch: persist the choice and re-render all texts
  langSegments.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const next = btn.dataset.lang;
      if (!next || (i18n && next === i18n.getLang())) return;
      if (i18n) i18n.setLang(next);
      const { settings: current } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...current, lang: next } });
      applyTranslations();
    });
  });

  // Handle Master toggle
  if (masterToggle) {
    masterToggle.addEventListener('change', async () => {
      const active = masterToggle.checked;
      updateMasterUI(active);
      const { settings: current } = await chrome.storage.local.get('settings');
      const updated = { ...current, enabled: active };
      await chrome.storage.local.set({ settings: updated });
    });
  }

  // Handle Engine Mode toggle
  async function handleModeSelect(selectedMode) {
    const { settings: current } = await chrome.storage.local.get('settings');
    const updated = { ...current, mode: selectedMode };
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

  // Handle Sub-switches changes
  for (const [key, checkbox] of Object.entries(switches)) {
    if (!checkbox) continue;
    checkbox.addEventListener('change', async () => {
      const { settings: current } = await chrome.storage.local.get('settings');
      const updated = { ...current };
      const group = GROUP_BY_SWITCH[key];
      if (group) {
        // A group switch batch-writes every mapped per-category key.
        for (const settingKey of SETTING_KEYS_BY_GROUP[group] || []) {
          updated[settingKey] = checkbox.checked;
        }
      } else {
        updated[key] = checkbox.checked;
      }
      await chrome.storage.local.set({ settings: updated });
      updateHighlighting();
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
    reels: 'labelReels'
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
