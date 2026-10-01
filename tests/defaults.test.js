'use strict';
/**
 * Tests for src/shared/defaults.js
 * Ensures the Single Source of Truth has the expected schema and settings keys.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./harness');

function run(checker) {
  const code = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'defaults.js'), 'utf8');

  const sandbox = { globalThis: {} };
  sandbox.globalThis.globalThis = sandbox.globalThis;
  vm.createContext(sandbox);

  // First run
  vm.runInContext(code, sandbox);

  const defaults = sandbox.globalThis.FB_DIET_DEFAULTS;
  checker.ok('FB_DIET_DEFAULTS is defined on globalThis', Boolean(defaults));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  checker.equals('VERSION matches manifest.json', defaults && defaults.VERSION, manifest.version);

  const settings = defaults && defaults.SETTINGS;
  checker.ok('SETTINGS object exists', Boolean(settings));
  checker.equals('settings.enabled is true', settings && settings.enabled, true);
  checker.equals('settings.dietMode is relay', settings && settings.dietMode, 'relay');

  /* --- detection mode normalisation: retired stored values must keep their meaning --- */
  const norm = defaults && defaults.normalizeDetectionMode;
  checker.ok('normalizeDetectionMode is exposed', typeof norm === 'function');
  checker.equals('relay passes through', norm('relay'), 'relay');
  // The DOM mode (decision #40) is a real value, not a legacy alias: it is selectable on
  // purpose, and reading it back must not rewrite it into something else.
  checker.equals('dom passes through', norm('dom'), 'dom');
  checker.equals('an unknown value still fails closed to the default', norm('dom-only'), 'relay');
  // The whole point of the rename: a profile that chose Lite did NOT choose DOM scanning, so the
  // legacy value must land on relay and not silently become the richer mode.
  checker.equals('legacy lite becomes relay', norm('lite'), 'relay');
  // 'full' was the old name for the hybrid that is now retired. It lands on 'relay', the half of
  // that hybrid which actually decided every non-regular unit.
  checker.equals('legacy full becomes relay', norm('full'), 'relay');
  // The retirement itself: every profile that stored the 1.0 hybrid keeps the behaviour it
  // observed, because the store decided everything the DOM was not allowed to touch.
  checker.equals('the retired relay+dom mode becomes relay', norm('relay+dom'), 'relay');
  checker.equals('an unknown value falls back to the default', norm('nonsense'), 'relay');
  checker.equals('a missing value falls back to the default', norm(undefined), 'relay');
  checker.equals('a non-string falls back to the default', norm(42), 'relay');
  checker.equals('an explicit fallback is honoured', norm('nope', 'dom'), 'dom');
  checker.ok('DETECTION_MODES lists exactly the two current values',
    Array.isArray(defaults.DETECTION_MODES) && defaults.DETECTION_MODES.join(',') === 'relay,dom');
  // The default is the store, because it is the engine that decides the great majority of units
  // and it survives a visual redesign. `dom` is a peer, not a diagnostic, and is not the default
  // because it is not the one that has been observed deciding most units on a real page.
  checker.equals('the default is relay', defaults.DEFAULT_DETECTION_MODE, 'relay');
  checker.equals('null is not a mode', norm(null), 'relay');
  checker.equals('settings.foldAds is true', settings && settings.foldAds, true);
  checker.equals('settings.foldRegular is false', settings && settings.foldRegular, false);
  checker.equals('settings.foldSuggested is false', settings && settings.foldSuggested, false);
  checker.equals('settings.foldMedia is true', settings && settings.foldMedia, true);
  checker.equals('settings.foldOther is true', settings && settings.foldOther, true);
  checker.equals('settings.minimizedFoldMode is false', settings && settings.minimizedFoldMode, false);
  checker.equals('settings.alwaysShowFoldBar is true', settings && settings.alwaysShowFoldBar, true);
  checker.equals('settings.showTitleMode is whenFolded', settings && settings.showTitleMode, 'whenFolded');
  checker.equals('settings.debugProbe is false', settings && settings.debugProbe, false);
  checker.equals('settings.restrictFoldScope is true', settings && settings.restrictFoldScope, true);

  const counts = defaults && defaults.COUNTS;
  checker.ok('COUNTS object exists', Boolean(counts));
  // Base metadata plus exactly one counter per user-facing group.
  checker.equals('COUNTS keys are base metadata plus the 5 group counters',
    Object.keys(counts || {}).slice().sort().join(','),
    ['ads', 'date', 'filtered', 'media', 'other', 'regular', 'suggested', 'total'].join(','));
  checker.equals('counts.total is 0', counts && counts.total, 0);
  checker.equals('counts.filtered is 0', counts && counts.filtered, 0);
  checker.equals('counts.ads is 0', counts && counts.ads, 0);
  checker.equals('counts.regular is 0', counts && counts.regular, 0);
  checker.equals('counts.suggested is 0', counts && counts.suggested, 0);
  checker.equals('counts.media is 0', counts && counts.media, 0);
  checker.equals('counts.other is 0', counts && counts.other, 0);
  checker.equals('counts does not have legacy sponsored', counts && counts.sponsored, undefined);
  checker.ok('counts.date is a string', typeof (counts && counts.date) === 'string' && counts.date.length >= 8);

  /* --- user-facing groups (STRATEGY.md, decision #8) --- */
  const groupByCategory = defaults && defaults.GROUP_BY_CATEGORY;
  checker.ok('GROUP_BY_CATEGORY exists', Boolean(groupByCategory));
  checker.equals('sponsored maps to ads', groupByCategory && groupByCategory.sponsored, 'ads');
  checker.equals('marketAds maps to ads', groupByCategory && groupByCategory.marketAds, 'ads');
  checker.equals('searchingAds maps to ads', groupByCategory && groupByCategory.searchingAds, 'ads');
  checker.equals('regular maps to regular', groupByCategory && groupByCategory.regular, 'regular');
  checker.equals('suggested maps to suggested', groupByCategory && groupByCategory.suggested, 'suggested');
  checker.equals('reels maps to media', groupByCategory && groupByCategory.reels, 'media');
  checker.equals('stories maps to media', groupByCategory && groupByCategory.stories, 'media');
  checker.equals('suggestedGroup maps to other', groupByCategory && groupByCategory.suggestedGroup, 'other');

  const keysByGroup = defaults && defaults.SETTING_KEYS_BY_GROUP;
  checker.equals('ads group writes foldAds', keysByGroup && keysByGroup.ads.join(','), 'foldAds');
  checker.equals('media group writes foldMedia', keysByGroup && keysByGroup.media.join(','), 'foldMedia');
  checker.ok('regular group writes foldRegular', Boolean(keysByGroup) && keysByGroup.regular.join(',') === 'foldRegular');
  checker.ok('every mapped key exists in SETTINGS', Boolean(keysByGroup) && Object.values(keysByGroup).every((keys) => keys.every((key) => key in settings)));

  /* --- category -> storage key (SSOT the classifier reads; STRATEGY.md decision #8) --- */
  const ENGINE_CATEGORIES = ['sponsored', 'marketAds', 'searchingAds', 'regular', 'suggested', 'reels', 'stories', 'suggestedGroup'];
  const settingByCategory = defaults && defaults.SETTING_BY_CATEGORY;
  checker.ok('SETTING_BY_CATEGORY exists', Boolean(settingByCategory));
  checker.equals('SETTING_BY_CATEGORY covers all 8 engine categories',
    Object.keys(settingByCategory || {}).slice().sort().join(','),
    ENGINE_CATEGORIES.slice().sort().join(','));

  // Closure check: reading a category's key directly must equal walking it through
  // the group layer, so the two tables cannot drift apart silently.
  const closureHolds = ENGINE_CATEGORIES.every((category) => {
    const group = groupByCategory && groupByCategory[category];
    const keys = group && keysByGroup && keysByGroup[group];
    const directKey = settingByCategory && settingByCategory[category];
    return Boolean(keys) && keys.length > 0 && directKey === keys[0];
  });
  checker.ok('SETTING_BY_CATEGORY[cat] equals SETTING_KEYS_BY_GROUP[GROUP_BY_CATEGORY[cat]][0]', closureHolds);
  checker.ok('every category key exists in SETTINGS', ENGINE_CATEGORIES.every((category) => {
    const key = settingByCategory && settingByCategory[category];
    return typeof key === 'string' && key in settings;
  }));

  /* --- group metadata --- */
  const groupMeta = defaults && defaults.GROUP_META;
  checker.ok('GROUP_META exists', Boolean(groupMeta));
  checker.equals('ads badge text is Ads', groupMeta && groupMeta.ads && groupMeta.ads.badgeText, 'Ads');
  checker.equals('regular badge text is Regular', groupMeta && groupMeta.regular && groupMeta.regular.badgeText, 'Regular');
  checker.equals('suggested badge text is Suggested', groupMeta && groupMeta.suggested && groupMeta.suggested.badgeText, 'Suggested');
  checker.equals('media badge text is Reels & Stories', groupMeta && groupMeta.media && groupMeta.media.badgeText, 'Reels & Stories');
  checker.equals('other badge text is Other', groupMeta && groupMeta.other && groupMeta.other.badgeText, 'Other');

  /* --- shared keyword schema --- */
  const keywords = defaults && defaults.KEYWORDS;
  checker.ok('KEYWORDS object exists', Boolean(keywords));
  for (const key of [
    'SPONSORED', 'SUGGESTED_FALLBACK', 'SUGGESTED_GROUP', 'STORIES', 'REELS',
    'SUGGESTED_DOM', 'FOLLOW_ACTIONS', 'JOIN_ACTIONS', 'NEGATIVE_ACTIONS', 'DIAGNOSTIC'
  ]) {
    checker.ok('keyword matrix exists: ' + key, Boolean(keywords && Array.isArray(keywords[key])));
  }
  checker.ok('sponsored matrix includes English', keywords && keywords.SPONSORED.indexOf('sponsored') !== -1);
  checker.ok('fallback matrix includes Traditional Chinese', keywords && keywords.SUGGESTED_FALLBACK.indexOf('為你推薦') !== -1);
  checker.ok('DOM matrix includes English follow label', keywords && keywords.FOLLOW_ACTIONS.indexOf('follow') !== -1);
  checker.ok('negative action matrix includes following', keywords && keywords.NEGATIVE_ACTIONS.indexOf('following') !== -1);

  // normalizeFoldMode helper
  checker.ok('normalizeFoldMode exists', typeof defaults.normalizeFoldMode === 'function');
  checker.equals('normalizeFoldMode true + mini:false -> title', defaults.normalizeFoldMode(true, 'off', false), 'title');
  checker.equals('normalizeFoldMode true + mini:true -> mini', defaults.normalizeFoldMode(true, 'off', true), 'mini');
  checker.equals('normalizeFoldMode false -> off', defaults.normalizeFoldMode(false), 'off');
  checker.equals('normalizeFoldMode off -> off', defaults.normalizeFoldMode('off'), 'off');
  checker.equals('normalizeFoldMode title + mini:false -> title', defaults.normalizeFoldMode('title', 'off', false), 'title');
  checker.equals('normalizeFoldMode title + mini:true -> mini', defaults.normalizeFoldMode('title', 'off', true), 'mini');
  checker.equals('normalizeFoldMode fallback', defaults.normalizeFoldMode('unknown', 'off'), 'off');

  /* --- fold scope allowlist (STRATEGY.md decision #26) --- */
  checker.ok('isFoldScopeAllowed exists', typeof defaults.isFoldScopeAllowed === 'function');
  checker.equals('home root allowed', defaults.isFoldScopeAllowed('/'), true);
  checker.equals('home.php allowed', defaults.isFoldScopeAllowed('/home.php'), true);
  checker.equals('search root allowed', defaults.isFoldScopeAllowed('/search'), true);
  checker.equals('search subpage allowed', defaults.isFoldScopeAllowed('/search/top'), true);
  checker.equals('marketplace item allowed', defaults.isFoldScopeAllowed('/marketplace/item/1'), true);
  checker.equals('groups feed rejected', defaults.isFoldScopeAllowed('/groups/feed'), false);
  checker.equals('profile page rejected', defaults.isFoldScopeAllowed('/mypage'), false);
  checker.equals('search prefix boundary rejected', defaults.isFoldScopeAllowed('/searchabc'), false);
  checker.equals('empty path fails open', defaults.isFoldScopeAllowed(''), true);
  checker.equals('undefined path fails open', defaults.isFoldScopeAllowed(undefined), true);

  /* --- fold bar title modes (STRATEGY.md decision #27) --- */
  checker.ok('normalizeTitleMode exists', typeof defaults.normalizeTitleMode === 'function');
  checker.equals('title mode always passes through', defaults.normalizeTitleMode('always'), 'always');
  checker.equals('title mode whenFolded passes through', defaults.normalizeTitleMode('whenFolded'), 'whenFolded');
  checker.equals('title mode never passes through', defaults.normalizeTitleMode('never'), 'never');
  checker.equals('boolean true falls back to default', defaults.normalizeTitleMode(true), 'whenFolded');
  checker.equals('boolean false falls back to default', defaults.normalizeTitleMode(false), 'whenFolded');
  checker.equals('unknown value falls back to the new default', defaults.normalizeTitleMode('wat'), 'whenFolded');
  checker.equals('stale preview value falls back to the new default', defaults.normalizeTitleMode('whenExpanded'), 'whenFolded');
  checker.equals('undefined falls back to the new default', defaults.normalizeTitleMode(undefined), 'whenFolded');
  checker.equals('custom fallback honoured', defaults.normalizeTitleMode('wat', 'always'), 'always');

  /* --- feed UI labels: one table per locale, and the locale the feed renders with --- */
  const labels = defaults && defaults.FEED_LABELS;
  const enLabels = (labels && labels.en) || {};
  const zhLabels = (labels && labels['zh-TW']) || {};
  checker.ok('FEED_LABELS is exposed', Boolean(labels));
  checker.equals('both feed label locales define the same keys',
    Object.keys(zhLabels).sort().join(','), Object.keys(enLabels).sort().join(','));

  // Pinned per locale rather than "en must differ from zh-TW": a label that happens to be the
  // same word in both is a legitimate outcome, which is the argument tests/i18n.test.js settled
  // when it replaced that rule with key-set parity.
  checker.equals('stories label in en', defaults.getFeedLabel('stories', 'en'), 'Stories');
  checker.equals('stories label in zh-TW', defaults.getFeedLabel('stories', 'zh-TW'), '限時動態（朋友）');
  checker.equals('reels label in en', defaults.getFeedLabel('reels', 'en'), 'Reels');
  checker.equals('reels label in zh-TW', defaults.getFeedLabel('reels', 'zh-TW'), '連續短片');
  checker.equals('suggestedGroup label in en', defaults.getFeedLabel('suggestedGroup', 'en'), 'Suggested Groups');
  checker.equals('suggestedGroup label in zh-TW', defaults.getFeedLabel('suggestedGroup', 'zh-TW'), '推薦社團列表');
  checker.equals('a key the table does not name is empty', defaults.getFeedLabel('nope', 'en'), '');
  checker.equals('an unsupported locale falls back to en', defaults.getFeedLabel('reels', 'fr-FR'), 'Reels');

  checker.ok('normalizeLocale is exposed', typeof defaults.normalizeLocale === 'function');
  checker.equals('zh-TW is kept', defaults.normalizeLocale('zh-TW'), 'zh-TW');
  checker.equals('zh-CN collapses onto the shipped Chinese locale', defaults.normalizeLocale('zh-CN'), 'zh-TW');
  checker.equals('en-US normalises to en', defaults.normalizeLocale('en-US'), 'en');
  checker.equals('an unsupported locale is en', defaults.normalizeLocale('fr-FR'), 'en');
  checker.equals('a missing code is en', defaults.normalizeLocale(null), 'en');

  // Source precedence for the injected UI: the user's stored choice, then the page's own
  // attribute, then the browser's UI language.
  const docOf = (lang) => ({ documentElement: { lang } });
  const navOf = (language) => ({ language });
  const settingsOf = (lang) => ({ lang });
  checker.ok('resolveFeedLocale is exposed', typeof defaults.resolveFeedLocale === 'function');
  checker.equals('the stored choice wins over the page',
    defaults.resolveFeedLocale(settingsOf('zh-TW'), docOf('en-US'), navOf('en-US')), 'zh-TW');
  checker.equals('and over a Chinese page when it says English',
    defaults.resolveFeedLocale(settingsOf('en'), docOf('zh-TW'), navOf('zh-TW')), 'en');
  checker.equals('no stored choice leaves the page language deciding',
    defaults.resolveFeedLocale(settingsOf(undefined), docOf('zh-TW'), navOf('en-US')), 'zh-TW');
  checker.equals('a page in another language does not out-vote a Chinese browser',
    defaults.resolveFeedLocale(null, docOf('en-US'), navOf('zh-TW')), 'zh-TW');
  checker.equals('a page with no lang falls back to the browser language',
    defaults.resolveFeedLocale(null, {}, navOf('zh-TW')), 'zh-TW');
  checker.equals('two English sources are en',
    defaults.resolveFeedLocale(null, docOf('en-US'), navOf('en-US')), 'en');
  checker.equals('no source at all is en', defaults.resolveFeedLocale(null, null, null), 'en');

  /* --- shared path reader and reserved-route table (SSOT) --- */
  checker.ok('readProp is exposed', typeof defaults.readProp === 'function');
  checker.equals('readProp walks a dotted path', defaults.readProp({ a: { b: { c: 7 } } }, 'a.b.c'), 7);
  checker.equals('readProp returns undefined on a missing hop', defaults.readProp({ a: null }, 'a.b'), undefined);
  checker.ok('RESERVED_PROFILE_SEGMENTS covers both historical lists',
    ['profile.php', 'groups', 'pages', 'watch', 'reel', 'stories', 'story.php', 'share', 'events',
     'reels', 'hashtag', 'photos', 'photo.php', 'media', 'policies', 'privacy', 'help', 'settings']
      .every((route) => defaults.RESERVED_PROFILE_SEGMENTS.indexOf(route) !== -1));

  // Idempotency: repeated execution does not throw
  let threw = false;
  try {
    vm.runInContext(code, sandbox);
  } catch (e) {
    threw = true;
  }
  checker.ok('repeated execution does not throw', !threw);
}

module.exports = { run };
