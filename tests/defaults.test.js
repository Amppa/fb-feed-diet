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
  checker.equals('VERSION is 1', defaults && defaults.VERSION, 1);

  const settings = defaults && defaults.SETTINGS;
  checker.ok('SETTINGS object exists', Boolean(settings));
  checker.equals('settings.enabled is true', settings && settings.enabled, true);
  checker.equals('settings.mode is proxy', settings && settings.mode, 'proxy');
  checker.equals('settings.foldSponsored is true', settings && settings.foldSponsored, true);
  checker.equals('settings.foldSuggested is true', settings && settings.foldSuggested, true);
  checker.equals('settings.foldSuggestedGroup is true', settings && settings.foldSuggestedGroup, true);
  checker.equals('settings.foldMarketAds is true', settings && settings.foldMarketAds, true);
  checker.equals('settings.foldSearchingAds is true', settings && settings.foldSearchingAds, true);
  checker.equals('settings.foldStories is true', settings && settings.foldStories, true);
  checker.equals('settings.foldReels is true', settings && settings.foldReels, true);
  checker.equals('settings.foldRegular is false', settings && settings.foldRegular, false);
  checker.equals('settings.minimizedFoldMode is false', settings && settings.minimizedFoldMode, false);
  checker.equals('settings.alwaysShowFoldTitle is true', settings && settings.alwaysShowFoldTitle, true);
  checker.equals('settings.debugProbe is false', settings && settings.debugProbe, false);

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

  // normalizeFoldMode helper
  checker.ok('normalizeFoldMode exists', typeof defaults.normalizeFoldMode === 'function');
  checker.equals('normalizeFoldMode true + mini:false -> title', defaults.normalizeFoldMode(true, 'off', false), 'title');
  checker.equals('normalizeFoldMode true + mini:true -> mini', defaults.normalizeFoldMode(true, 'off', true), 'mini');
  checker.equals('normalizeFoldMode false -> off', defaults.normalizeFoldMode(false), 'off');
  checker.equals('normalizeFoldMode off -> off', defaults.normalizeFoldMode('off'), 'off');
  checker.equals('normalizeFoldMode title + mini:false -> title', defaults.normalizeFoldMode('title', 'off', false), 'title');
  checker.equals('normalizeFoldMode title + mini:true -> mini', defaults.normalizeFoldMode('title', 'off', true), 'mini');
  checker.equals('normalizeFoldMode fallback', defaults.normalizeFoldMode('unknown', 'off'), 'off');

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
