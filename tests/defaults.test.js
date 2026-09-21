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
  checker.equals('settings.debugProbe is false', settings && settings.debugProbe, false);

  const counts = defaults && defaults.COUNTS;
  checker.ok('COUNTS object exists', Boolean(counts));
  checker.equals('counts.total is 0', counts && counts.total, 0);
  checker.equals('counts.filtered is 0', counts && counts.filtered, 0);
  checker.equals('counts.sponsored is 0', counts && counts.sponsored, 0);
  checker.equals('counts.suggested is 0', counts && counts.suggested, 0);
  checker.equals('counts.regular is 0', counts && counts.regular, 0);
  checker.ok('counts.date is a string', typeof (counts && counts.date) === 'string' && counts.date.length >= 8);

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
