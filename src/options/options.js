/**
 * FB Diet - Options Page Controller
 * Manages all feature switches, stat counters, and reset action.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const resetBtn = document.getElementById('resetBtn');
  const featuresList = document.getElementById('featuresList');
  const masterToggle = document.getElementById('enabled');
  const masterStatus = document.getElementById('masterStatus');

  const i18n = window.FBDietI18N;
  const langSegments = document.querySelectorAll('.lang-segment');

  const SHARED_DEFAULTS = globalThis.FB_DIET_DEFAULTS?.SETTINGS || {};
  const DEFAULTS_MAP = globalThis.FB_DIET_DEFAULTS || {};
  const SETTING_KEYS_BY_GROUP = DEFAULTS_MAP.SETTING_KEYS_BY_GROUP || {};

  const switches = {};
  document.querySelectorAll('#featuresList input[type="checkbox"], #appearanceList input[type="checkbox"], #classifierList input[type="checkbox"]').forEach(input => {
    if (input.id) switches[input.id] = input;
  });

  // Section dropdowns live in the appearance and classifier lists.
  const selects = {};
  document.querySelectorAll('#appearanceList select, #classifierList select').forEach(el => {
    if (el.id) selects[el.id] = el;
  });

  // Settings keys restored by the Appearance section's Defaults button
  // from FB_DIET_DEFAULTS.SETTINGS. // per docs/architecture.md
  // The Detection Source select and Feed Probe now live in the Classifier Settings
  // section, but "Defaults" still covers them so no visible control is skipped.
  // `alwaysShowFoldBar` has no visible control anymore, so "Defaults" leaves the
  // stored value alone; the inject code still honours it.
  const APPEARANCE_KEYS = ['restrictFoldScope', 'showTitleMode', 'tooltipMode', 'minimizedFoldMode', 'dietMode', 'debugProbe', 'themeMode'];

  function resolveEffectiveTheme(mode, detectedFb) {
    if (mode === 'light') return 'light';
    if (mode === 'dark') return 'dark';
    if (detectedFb === 'light' || detectedFb === 'dark') return detectedFb;
    const isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDark ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    if (typeof document !== 'undefined' && document.documentElement && typeof document.documentElement.setAttribute === 'function') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  // Shared normaliser: the options page shows the current mode name for a profile that may
  // still hold a retired value ('lite' / 'full' / 'relay+dom') in storage.
  const normalizeDetectionMode = (value) => (
    DEFAULTS_MAP && typeof DEFAULTS_MAP.normalizeDetectionMode === 'function'
      ? DEFAULTS_MAP.normalizeDetectionMode(value)
      : 'relay'
  );

  // Two selects keep a boolean in storage (compatibility contract) while showing
  // descriptive option values: "18"/"36" for the bar height, "scoped"/"all" for the scope.
  const BOOLEAN_SELECTS = {
    minimizedFoldMode: { trueValue: '18', falseValue: '36' },
    restrictFoldScope: { trueValue: 'scoped', falseValue: 'all' }
  };
  function booleanToSelectValue(key, value) {
    const mapping = BOOLEAN_SELECTS[key];
    return (value === false || value === mapping.falseValue || value === 'false' ? mapping.falseValue : mapping.trueValue);
  }
  function selectValueToBoolean(key, value) {
    return value !== BOOLEAN_SELECTS[key].falseValue;
  }
  function setSelectValue(key, select, stored) {
    select.value = BOOLEAN_SELECTS[key] ? booleanToSelectValue(key, stored) : String(stored);
    if (select.selectedIndex === -1) select.selectedIndex = 0;
  }

  const GROUP_BY_SWITCH = {
    groupRegular: 'regular',
    groupAds: 'ads',
    groupSuggested: 'suggested',
    groupMedia: 'media',
    groupOther: 'other'
  };
  const SWITCH_BY_GROUP = {
    regular: 'groupRegular',
    ads: 'groupAds',
    suggested: 'groupSuggested',
    media: 'groupMedia',
    other: 'groupOther'
  };

  function isGroupOn(settings, group) {
    const keys = SETTING_KEYS_BY_GROUP[group] || [];
    return keys.length > 0 && keys.every((key) => settings[key] !== false);
  }

  let currentSettings = {};

  const counters = {
    total: document.getElementById('totalCount'),
    filtered: document.getElementById('filteredCount'),
    ads: document.getElementById('adsCount'),
    suggested: document.getElementById('suggestedCount'),
    media: document.getElementById('mediaCount'),
    other: document.getElementById('otherCount'),
    regular: document.getElementById('regularCount')
  };
  const filteredHead = document.getElementById('filteredCountHead');

  function updateHighlighting() {
    const isMasterActive = masterToggle ? masterToggle.checked : true;
    for (const [group, el] of Object.entries(counters)) {
      if (!el || group === 'total' || group === 'filtered') continue;
      const switchId = SWITCH_BY_GROUP[group];
      const isFolded = isMasterActive && switchId && switches[switchId] ? switches[switchId].checked : false;
      el.classList.toggle('active-folded', Boolean(isFolded));
    }
  }

  let lastCounts = null;
  function refreshDonut() {
    if (lastCounts) renderDonut(lastCounts);
  }

  function renderCounts(counts) {
    if (!counts) return;
    if (counters.total) counters.total.textContent = (counts.total || 0).toLocaleString();
    if (counters.filtered) counters.filtered.textContent = formatFilteredPercent(counts);
    if (filteredHead) filteredHead.textContent = (counts.filtered || 0).toLocaleString();
    if (counters.ads) counters.ads.textContent = (counts.ads || 0).toLocaleString();
    if (counters.suggested) counters.suggested.textContent = (counts.suggested || 0).toLocaleString();
    if (counters.media) counters.media.textContent = (counts.media || 0).toLocaleString();
    if (counters.other) counters.other.textContent = (counts.other || 0).toLocaleString();
    if (counters.regular) counters.regular.textContent = (counts.regular || 0).toLocaleString();
    lastCounts = counts;
    updateHighlighting();
    renderDonut(counts);
  }

  // Same fold source as updateHighlighting: master switch plus the group switch.
  function isDonutGroupFolded(group) {
    if (masterToggle && !masterToggle.checked) return false;
    const switchId = SWITCH_BY_GROUP[group];
    const checkbox = switchId && switches[switchId];
    return Boolean(checkbox && checkbox.checked);
  }

  // Donut center shows the filtered share of received posts (the ring is empty at zero).
  function formatFilteredPercent(counts) {
    const total = countOf(counts, 'total');
    if (total <= 0) return '0%';
    return `${Math.round((countOf(counts, 'filtered') / total) * 100)}%`;
  }

  // Donut composition of received posts, in legend order. Nodes are built with
  // createElementNS (never innerHTML), per the MV3 review red lines.
  const DONUT_GROUPS = ['regular', 'suggested', 'media', 'ads', 'other'];

  function countOf(counts, key) {
    return (counts && counts[key]) || 0;
  }

  // Ring denominator matches the center percent: counts.total wins, so an
  // unclassified share (total beyond the five groups) shows as a track-colored
  // gap instead of silently stretching the slices. Falls back to the group sum
  // when total is missing, and never below it, so stale rows still close the ring.
  function donutTotal(counts) {
    const groupSum = DONUT_GROUPS.reduce((sum, group) => sum + countOf(counts, group), 0);
    const total = countOf(counts, 'total');
    return Math.max(total, groupSum);
  }

  // Ring geometry is owned by options.html: arcs reuse the track circle's own
  // center and radius, so a viewBox change never leaves the JS behind.
  function donutGeometry(segments) {
    const fallback = { cx: 70, cy: 70, r: 59 };
    const track = segments && segments.parentNode
      ? segments.parentNode.querySelector('.donut-track')
      : null;
    if (!track) return fallback;
    const read = (name) => {
      const value = Number(track.getAttribute(name));
      return Number.isFinite(value) ? value : fallback[name];
    };
    const geom = { cx: read('cx'), cy: read('cy'), r: read('r') };
    geom.circumference = 2 * Math.PI * geom.r;
    return geom;
  }

  // One ring slice. Arcs start at 12 o'clock and run clockwise: the slice is
  // rotated back by the already-consumed share, then the whole ring is turned
  // -90 degrees to move the zero point from 3 o'clock to the top.
  function buildArc(group, geom, fraction, consumed) {
    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    arc.setAttribute('cx', String(geom.cx));
    arc.setAttribute('cy', String(geom.cy));
    arc.setAttribute('r', String(geom.r));
    arc.setAttribute('class', 'donut-seg');
    // Folded slices use the badge text color; unfolded ones sink to the
    // badge background (--donut-<group> / --donut-<group>-dim in options.css).
    arc.style.stroke = `var(--donut-${group}${isDonutGroupFolded(group) ? '' : '-dim'})`;
    arc.setAttribute('stroke-dasharray', `${fraction * geom.circumference} ${geom.circumference}`);
    arc.setAttribute('stroke-dashoffset', String(-consumed * geom.circumference));
    arc.setAttribute('transform', `rotate(-90 ${geom.cx} ${geom.cy})`);
    return arc;
  }

  function renderDonut(counts) {
    const segments = document.getElementById('donutSegments');
    const center = document.getElementById('donutCenter');
    const emptyHint = document.getElementById('donutEmpty');
    if (!segments) return;
    while (segments.firstChild) segments.removeChild(segments.firstChild);
    const total = donutTotal(counts);
    const isEmpty = total <= 0;
    if (center) center.hidden = isEmpty;
    if (emptyHint) emptyHint.hidden = !isEmpty;
    if (isEmpty) return;
    const geom = donutGeometry(segments);
    let consumed = 0;
    for (const group of DONUT_GROUPS) {
      const fraction = countOf(counts, group) / total;
      if (fraction <= 0) continue;
      segments.appendChild(buildArc(group, geom, fraction, consumed));
      consumed += fraction;
    }
  }

  function updateMasterUI(isEnabled) {
    if (masterToggle) masterToggle.checked = isEnabled;
    if (masterStatus) masterStatus.textContent = i18n ? i18n.t(isEnabled ? 'masterStatusActive' : 'masterStatusDisabled') : (isEnabled ? 'Active' : 'Disabled');
    const appearanceList = document.getElementById('appearanceList');
    const classifierList = document.getElementById('classifierList');
    if (isEnabled) {
      featuresList.classList.remove('disabled');
      if (appearanceList) appearanceList.classList.remove('disabled');
      if (classifierList) classifierList.classList.remove('disabled');
    } else {
      featuresList.classList.add('disabled');
      if (appearanceList) appearanceList.classList.add('disabled');
      if (classifierList) classifierList.classList.add('disabled');
    }
    updateHighlighting();
    refreshDonut();
  }

  /**
   * Repaints the Detection Source select. `dietMode` lives in the classifier list, so the
   * generic select loop already persists it; this only has to show the *normalised* value, so
   * a profile still holding the pre-rename 'lite' / 'full' displays its current name instead of
   * silently falling back to the first option.
   */
  function updateDetectionUI(settings) {
    const select = selects.dietMode;
    if (!select) return;
    select.value = normalizeDetectionMode(settings && settings.dietMode);
    if (select.selectedIndex === -1) select.selectedIndex = 0;
  }

  // The dictionary module owns the attribute contract. What stays here is this page's own work:
  // its document title, the language switch's active state, and the dynamic status labels.
  function applyTranslations() {
    if (!i18n) return;
    const lang = i18n.getLang();
    i18n.applyTo(document);
    document.title = i18n.t('optionsTitle');
    langSegments.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.lang === lang);
    });
    // Dynamic statuses depend on the language too.
    updateMasterUI(masterToggle ? masterToggle.checked : true);
  }

  // Load initial settings and counts
  const data = await chrome.storage.local.get(['settings', 'counts', 'detectedFbTheme']);
  let settings = data.settings || {};
  const counts = data.counts || {};
  let detectedFbTheme = data.detectedFbTheme;

  // Fallback to system color scheme if Facebook theme has not been detected yet
  if (!detectedFbTheme) {
    const isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    detectedFbTheme = isDark ? 'dark' : 'light';
    chrome.storage.local.set({ detectedFbTheme }).catch(() => {});
  }

  // Resolve language: stored setting wins, otherwise detect from the browser UI.
  const lang = settings.lang || (i18n ? i18n.detect() : 'en');
  if (i18n) i18n.setLang(lang);
  if (!settings.lang && i18n) {
    chrome.storage.local.set({ settings: { ...settings, lang } });
  }

  currentSettings = { ...SHARED_DEFAULTS, ...settings };
  applyTheme(resolveEffectiveTheme(currentSettings.themeMode, detectedFbTheme));

  // Initialize master switch, detection source & feature switches
  updateMasterUI(currentSettings.enabled !== false);
  updateDetectionUI(currentSettings);

  for (const [key, checkbox] of Object.entries(switches)) {
    if (!checkbox) continue;
    const group = GROUP_BY_SWITCH[key];
    if (group) {
      checkbox.checked = isGroupOn(currentSettings, group);
    } else if (currentSettings[key] !== undefined) {
      checkbox.checked = Boolean(currentSettings[key]);
    }
  }

  for (const [key, select] of Object.entries(selects)) {
    if (currentSettings[key] === undefined) continue;
    setSelectValue(key, select, currentSettings[key]);
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

  // Writing settings is the whole broadcast: chrome.storage.onChanged in the background
  // service worker pushes the new value to every open Facebook tab.
  async function saveAndBroadcastSettings(updated) {
    currentSettings = updated;
    await chrome.storage.local.set({ settings: updated });
  }

  /**
   * Restores the Appearance Settings section to FB_DIET_DEFAULTS.SETTINGS values.
   * Writes storage, broadcasts to open tabs, then repaints the section controls
   * directly so the UI never waits on the storage.onChanged round trip.
   */
  function applyAppearanceControls(settings) {
    for (const key of APPEARANCE_KEYS) {
      const checkbox = switches[key];
      if (checkbox && settings[key] !== undefined) checkbox.checked = Boolean(settings[key]);
      const select = selects[key];
      if (select && settings[key] !== undefined) {
        setSelectValue(key, select, settings[key]);
      }
    }
  }

  const resetAppearanceBtn = document.getElementById('resetAppearanceBtn');
  if (resetAppearanceBtn) {
    resetAppearanceBtn.addEventListener('click', async () => {
      const { settings: current } = await chrome.storage.local.get('settings');
      const updated = { ...current };
      for (const key of APPEARANCE_KEYS) {
        if (SHARED_DEFAULTS[key] !== undefined) updated[key] = SHARED_DEFAULTS[key];
      }
      await saveAndBroadcastSettings(updated);
      applyAppearanceControls(updated);
      applyTheme(resolveEffectiveTheme(updated.themeMode, detectedFbTheme));
    });
  }

  // Handle Master toggle
  if (masterToggle) {
    masterToggle.addEventListener('change', async () => {
      const active = masterToggle.checked;
      updateMasterUI(active);
      const { settings: current } = await chrome.storage.local.get('settings');
      await saveAndBroadcastSettings({ ...current, enabled: active });
    });
  }

  // Handle all feature switches & checkboxes
  for (const [key, checkbox] of Object.entries(switches)) {
    if (!checkbox) continue;
    checkbox.addEventListener('change', async () => {
      const group = GROUP_BY_SWITCH[key];
      const { settings: current } = await chrome.storage.local.get('settings');
      const updated = { ...current };
      if (group) {
        for (const settingKey of SETTING_KEYS_BY_GROUP[group] || []) {
          updated[settingKey] = checkbox.checked;
        }
      } else {
        updated[key] = checkbox.checked;
      }
      await saveAndBroadcastSettings(updated);
      updateHighlighting();
      refreshDonut();
    });
  }

  // Handle appearance dropdowns (e.g. showTitleMode); the value is the raw option string,
  // except boolean-backed selects which map back to the stored boolean.
  for (const [key, select] of Object.entries(selects)) {
    select.addEventListener('change', async () => {
      const { settings: current } = await chrome.storage.local.get('settings');
      const value = BOOLEAN_SELECTS[key] ? selectValueToBoolean(key, select.value) : select.value;
      if (key === 'themeMode') {
        applyTheme(resolveEffectiveTheme(value, detectedFbTheme));
      }
      await saveAndBroadcastSettings({ ...current, [key]: value });
    });
  }

  // Handle Reset button
  resetBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_COUNTS' }, (res) => {
      if (res && res.counts) {
        renderCounts(res.counts);
      } else {
        renderCounts({ date: '', total: 0, filtered: 0, ads: 0, regular: 0, suggested: 0, media: 0, other: 0 });
      }
    });
  });

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.detectedFbTheme) {
        detectedFbTheme = changes.detectedFbTheme.newValue;
        applyTheme(resolveEffectiveTheme(currentSettings.themeMode, detectedFbTheme));
      }
      if (changes.counts) {
        renderCounts(changes.counts.newValue);
      }
      if (changes.settings) {
        const s = changes.settings.newValue;
        if (s) {
          if (s.themeMode !== undefined) {
            applyTheme(resolveEffectiveTheme(s.themeMode, detectedFbTheme));
          }
          if (s.enabled !== undefined) updateMasterUI(s.enabled !== false);
          if (s.dietMode !== undefined) updateDetectionUI(s);
          for (const [key, checkbox] of Object.entries(switches)) {
            if (!checkbox) continue;
            const group = GROUP_BY_SWITCH[key];
            if (group) checkbox.checked = isGroupOn(s, group);
            else if (s[key] !== undefined) checkbox.checked = Boolean(s[key]);
          }
          for (const [key, select] of Object.entries(selects)) {
            if (s[key] === undefined) continue;
            setSelectValue(key, select, s[key]);
          }
          updateHighlighting();
          refreshDonut();
          if (s.lang && i18n && s.lang !== i18n.getLang()) {
            i18n.setLang(s.lang);
            applyTranslations();
          }
        }
      }
    }
  });

  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
      if (currentSettings.themeMode === 'auto') {
        const fallback = e.matches ? 'dark' : 'light';
        applyTheme(resolveEffectiveTheme('auto', detectedFbTheme || fallback));
      }
    });
  }
});
