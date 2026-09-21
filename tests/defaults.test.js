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
  checker.equals('settings.removeSponsored is true', settings && settings.removeSponsored, true);
  checker.equals('settings.removeSuggested is true', settings && settings.removeSuggested, true);
  checker.equals('settings.removeSuggestedGroup is true', settings && settings.removeSuggestedGroup, true);
  checker.equals('settings.removeMarketAds is true', settings && settings.removeMarketAds, true);
  checker.equals('settings.removeSearchingAds is true', settings && settings.removeSearchingAds, true);
  checker.equals('settings.removeStories is true', settings && settings.removeStories, true);
  checker.equals('settings.removeReels is true', settings && settings.removeReels, true);
  checker.equals('settings.debugProbe is false', settings && settings.debugProbe, false);

  const counts = defaults && defaults.COUNTS;
  checker.ok('COUNTS object exists', Boolean(counts));
  checker.equals('counts.total is 0', counts && counts.total, 0);
  checker.equals('counts.sponsored is 0', counts && counts.sponsored, 0);
  checker.equals('counts.suggested is 0', counts && counts.suggested, 0);

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
