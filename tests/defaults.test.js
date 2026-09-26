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
  checker.equals('settings.dietMode is full', settings && settings.dietMode, 'full');
  checker.equals('settings.mode is proxy', settings && settings.mode, 'proxy');
  checker.equals('settings.foldSponsored is true', settings && settings.foldSponsored, true);
  checker.equals('settings.foldSuggested is false', settings && settings.foldSuggested, false);
  checker.equals('settings.foldSuggestedGroup is false', settings && settings.foldSuggestedGroup, false);
  checker.equals('settings.foldMarketAds is true', settings && settings.foldMarketAds, true);
  checker.equals('settings.foldSearchingAds is true', settings && settings.foldSearchingAds, true);
  checker.equals('settings.foldStories is true', settings && settings.foldStories, true);
  checker.equals('settings.foldReels is true', settings && settings.foldReels, true);
  checker.equals('settings.foldRegular is false', settings && settings.foldRegular, false);
  checker.equals('settings.minimizedFoldMode is false', settings && settings.minimizedFoldMode, false);
  checker.equals('settings.alwaysShowFoldBar is true', settings && settings.alwaysShowFoldBar, true);
  checker.equals('settings.showTitleMode is whenFolded', settings && settings.showTitleMode, 'whenFolded');
  checker.equals('settings.debugProbe is false', settings && settings.debugProbe, false);
  checker.equals('settings.restrictFoldScope is true', settings && settings.restrictFoldScope, true);

  const counts = defaults && defaults.COUNTS;
  checker.ok('COUNTS object exists', Boolean(counts));
  checker.equals('counts.total is 0', counts && counts.total, 0);
  checker.equals('counts.filtered is 0', counts && counts.filtered, 0);
  checker.equals('counts.sponsored is 0', counts && counts.sponsored, 0);
  checker.equals('counts.suggested is 0', counts && counts.suggested, 0);
  checker.equals('counts.regular is 0', counts && counts.regular, 0);
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
  checker.ok('ads group batch-writes its three keys', Boolean(keysByGroup) && keysByGroup.ads.join(',') === 'foldSponsored,foldMarketAds,foldSearchingAds');
  checker.ok('regular group writes foldRegular', Boolean(keysByGroup) && keysByGroup.regular.join(',') === 'foldRegular');
  checker.ok('every mapped key exists in SETTINGS', Boolean(keysByGroup) && Object.values(keysByGroup).every((keys) => keys.every((key) => key in settings)));

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
  checker.equals('legacy true rolls forward to the new default', defaults.normalizeTitleMode(true), 'whenFolded');
  checker.equals('legacy false keeps never', defaults.normalizeTitleMode(false), 'never');
  checker.equals('unknown value falls back to the new default', defaults.normalizeTitleMode('wat'), 'whenFolded');
  checker.equals('stale preview value falls back to the new default', defaults.normalizeTitleMode('whenExpanded'), 'whenFolded');
  checker.equals('undefined falls back to the new default', defaults.normalizeTitleMode(undefined), 'whenFolded');
  checker.equals('custom fallback honoured', defaults.normalizeTitleMode('wat', 'always'), 'always');

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
