/**
 * FB Diet - Options Page Controller
 * Manages all feature switches, stat counters, and reset action.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const resetBtn = document.getElementById('resetBtn');
  const featuresList = document.getElementById('featuresList');
  const masterToggle = document.getElementById('enabled');
  const masterStatus = document.getElementById('masterStatus');
  const modeLite = document.getElementById('modeLite');
  const modeFull = document.getElementById('modeFull');
  const statItemSuggested = document.getElementById('statItemSuggested');
  const featureItemSuggested = document.getElementById('featureItemSuggested');
  const featureItemTitleMode = document.getElementById('featureItemTitleMode');
  const showTitleMode = document.getElementById('showTitleMode');
  const groupSuggested = document.getElementById('groupSuggested');

  const i18n = window.FBDietI18N;
  const langSegments = document.querySelectorAll('.lang-segment');

  const SHARED_DEFAULTS = globalThis.FB_DIET_DEFAULTS?.SETTINGS || {};
  const DEFAULTS_MAP = globalThis.FB_DIET_DEFAULTS || {};
  const SETTING_KEYS_BY_GROUP = DEFAULTS_MAP.SETTING_KEYS_BY_GROUP || {};

  const switches = {};
  document.querySelectorAll('#featuresList input[type="checkbox"], #appearanceList input[type="checkbox"]').forEach(input => {
    if (input.id) switches[input.id] = input;
  });

  // Section dropdowns (the Fold Bar Title select) live in the same appearance list.
  const selects = {};
  document.querySelectorAll('#appearanceList select').forEach(el => {
    if (el.id) selects[el.id] = el;
  });

  // Settings keys owned by the Appearance Settings section; the Defaults button
  // restores exactly these from FB_DIET_DEFAULTS.SETTINGS (STRATEGY.md decision #27).
  const APPEARANCE_KEYS = ['restrictFoldScope', 'alwaysShowFoldBar', 'showTitleMode', 'minimizedFoldMode', 'debugProbe'];

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

  function updateHighlighting() {
    const isMasterActive = masterToggle ? masterToggle.checked : true;
    for (const [group, el] of Object.entries(counters)) {
      if (!el || group === 'total' || group === 'filtered') continue;
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
    const appearanceList = document.getElementById('appearanceList');
    if (isEnabled) {
      featuresList.classList.remove('disabled');
      if (appearanceList) appearanceList.classList.remove('disabled');
    } else {
      featuresList.classList.add('disabled');
      if (appearanceList) appearanceList.classList.add('disabled');
    }
    updateHighlighting();
  }

  function updateDietModeUI(mode) {
    const isFull = mode === 'full';
    if (modeFull) modeFull.checked = isFull;
    if (modeLite) modeLite.checked = !isFull;

    // In Lite mode, seal / lock Suggested & Header Snippet Display (semi-transparent gray, unclickable)
    if (statItemSuggested) {
      statItemSuggested.classList.toggle('is-locked', !isFull);
    }
    if (featureItemSuggested) {
      featureItemSuggested.classList.toggle('is-locked', !isFull);
      if (groupSuggested) groupSuggested.disabled = !isFull;
    }
    if (featureItemTitleMode) {
      featureItemTitleMode.classList.toggle('is-locked', !isFull);
      if (showTitleMode) showTitleMode.disabled = !isFull;
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
  let settings = data.settings || {};
  const counts = data.counts || {};

  // Resolve language: stored setting wins, otherwise detect from the browser UI.
  const lang = settings.lang || (i18n ? i18n.detect() : 'en');
  if (i18n) i18n.setLang(lang);
  if (!settings.lang && i18n) {
    chrome.storage.local.set({ settings: { ...settings, lang } });
  }

  currentSettings = { ...SHARED_DEFAULTS, ...settings };

  // Initialize master switch, diet mode & feature switches
  updateMasterUI(currentSettings.enabled !== false);
  updateDietModeUI(currentSettings.dietMode || 'lite');

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
    select.value = String(currentSettings[key]);
    if (select.selectedIndex === -1) select.selectedIndex = 0;
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

  async function saveAndBroadcastSettings(updated) {
    currentSettings = updated;
    await chrome.storage.local.set({ settings: updated });
    try {
      chrome.runtime.sendMessage({ type: 'PUSH_SETTINGS', settings: updated });
    } catch (e) {
      // Storage onChanged covers environments where runtime messaging is unavailable
    }
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
        select.value = String(settings[key]);
        if (select.selectedIndex === -1) select.selectedIndex = 0;
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

  // Handle Diet Mode toggle
  async function handleDietModeSelect(selectedMode) {
    const { settings: current } = await chrome.storage.local.get('settings');
    await saveAndBroadcastSettings({ ...current, dietMode: selectedMode });
    updateDietModeUI(selectedMode);
  }

  if (modeLite) {
    modeLite.addEventListener('change', () => {
      if (modeLite.checked) handleDietModeSelect('lite');
    });
  }
  if (modeFull) {
    modeFull.addEventListener('change', () => {
      if (modeFull.checked) handleDietModeSelect('full');
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
    });
  }

  // Handle appearance dropdowns (e.g. showTitleMode); the value is the raw option string
  for (const [key, select] of Object.entries(selects)) {
    select.addEventListener('change', async () => {
      const { settings: current } = await chrome.storage.local.get('settings');
      await saveAndBroadcastSettings({ ...current, [key]: select.value });
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
          if (s.dietMode !== undefined) updateDietModeUI(s.dietMode);
          for (const [key, checkbox] of Object.entries(switches)) {
            if (!checkbox) continue;
            const group = GROUP_BY_SWITCH[key];
            if (group) checkbox.checked = isGroupOn(s, group);
            else if (s[key] !== undefined) checkbox.checked = Boolean(s[key]);
          }
          for (const [key, select] of Object.entries(selects)) {
            if (s[key] === undefined) continue;
            select.value = String(s[key]);
            if (select.selectedIndex === -1) select.selectedIndex = 0;
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
