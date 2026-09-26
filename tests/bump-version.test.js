'use strict';
/**
 * Tests for scripts/bump-version.js
 * Verifies SemVer parsing, increment calculations, and version parity across files.
 */
const fs = require('fs');
const path = require('path');
const { bump, parseSemVer } = require('../scripts/bump-version');
const { ROOT } = require('./harness');

function run(checker) {
  // 1. parseSemVer
  checker.equals('parseSemVer parses valid 2.1.1', JSON.stringify(parseSemVer('2.1.1')), JSON.stringify({ major: 2, minor: 1, patch: 1 }));
  checker.equals('parseSemVer trims whitespace', JSON.stringify(parseSemVer('  0.5.12  ')), JSON.stringify({ major: 0, minor: 5, patch: 12 }));
  checker.equals('parseSemVer returns null on invalid', parseSemVer('2.1'), null);
  checker.equals('parseSemVer returns null on non-numeric', parseSemVer('v2.1.1'), null);

  // 2. bump increments
  checker.equals('bump patch from 2.1.0 -> 2.1.1', bump('2.1.0', 'patch'), '2.1.1');
  checker.equals('bump minor from 2.1.0 -> 2.2.0', bump('2.1.0', 'minor'), '2.2.0');
  checker.equals('bump major from 2.1.0 -> 3.0.0', bump('2.1.0', 'major'), '3.0.0');
  checker.equals('bump explicit version accepts valid semver', bump('2.1.0', '2.5.4'), '2.5.4');

  let invalidBumpThrew = false;
  try {
    bump('2.1.0', 'invalid-type');
  } catch (err) {
    invalidBumpThrew = true;
  }
  checker.ok('bump throws on invalid target', invalidBumpThrew);

  // 3. Current repository version parity across single-source-of-truth files
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const defaultsContent = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'defaults.js'), 'utf8');
  const defaultsMatch = defaultsContent.match(/const\s+EXTENSION_VERSION\s*=\s*['"]([^'"]+)['"]/);

  checker.ok('package.json version matches manifest.json', pkg.version === manifest.version);
  checker.ok('defaults.js EXTENSION_VERSION matches manifest.json', defaultsMatch && defaultsMatch[1] === manifest.version);
  checker.equals('current version is 2.7.0', manifest.version, '2.7.0');

  // 4. Firefox shares the single cross-browser manifest (Chrome reads service_worker, Firefox reads scripts)
  const bgScripts = manifest.background.scripts;
  checker.ok('background.scripts present for Firefox event page', Array.isArray(bgScripts) && bgScripts.length > 0);
  checker.equals('background.scripts ends with the service worker script', bgScripts && bgScripts[bgScripts.length - 1], manifest.background.service_worker);
  // Firefox background scripts run in a window context without importScripts, so the
  // shared defaults module must be loaded by manifest order for FB_DIET_DEFAULTS to exist.
  checker.equals('background.scripts loads defaults first', bgScripts && bgScripts[0], 'src/shared/defaults.js');
  checker.ok('every background script file exists', Array.isArray(bgScripts) && bgScripts.every((entry) => fs.existsSync(path.join(ROOT, entry))));
  const gecko = manifest.browser_specific_settings && manifest.browser_specific_settings.gecko;
  checker.ok('gecko id present', Boolean(gecko && typeof gecko.id === 'string' && gecko.id.includes('@')));
  checker.equals('gecko strict_min_version is 128.0', gecko && gecko.strict_min_version, '128.0');
}

module.exports = { run };
