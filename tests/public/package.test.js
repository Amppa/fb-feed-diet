'use strict';
/**
 * Tests for scripts/package.js
 * Verifies clean browser-specific manifest generation (Chrome vs Firefox) and packaging outputs.
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness');
const {
  TARGETS,
  generateManifest,
  packageExtension,
} = require(path.join(ROOT, 'scripts', 'package'));

function run(checker) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

  // 1. TARGETS array
  checker.ok('TARGETS includes chrome and firefox', TARGETS.includes('chrome') && TARGETS.includes('firefox'));

  // 2. generateManifest for Chrome
  const chromeManifest = generateManifest(manifest, 'chrome');
  checker.equals(
    'Chrome manifest strips browser_specific_settings',
    chromeManifest.browser_specific_settings,
    undefined
  );
  checker.equals(
    'Chrome manifest strips background.scripts',
    chromeManifest.background ? chromeManifest.background.scripts : null,
    undefined
  );
  checker.equals(
    'Chrome manifest retains background.service_worker',
    chromeManifest.background ? chromeManifest.background.service_worker : null,
    'src/background/background.js'
  );
  checker.equals(
    'Chrome manifest retains minimum_chrome_version',
    chromeManifest.minimum_chrome_version,
    '111'
  );
  checker.ok(
    'Chrome manifest preserves general fields',
    chromeManifest.manifest_version === 3 &&
      chromeManifest.version === manifest.version &&
      Array.isArray(chromeManifest.content_scripts)
  );

  // 3. generateManifest for Firefox
  const firefoxManifest = generateManifest(manifest, 'firefox');
  checker.equals(
    'Firefox manifest strips minimum_chrome_version',
    firefoxManifest.minimum_chrome_version,
    undefined
  );
  checker.equals(
    'Firefox manifest strips background.service_worker',
    firefoxManifest.background ? firefoxManifest.background.service_worker : null,
    undefined
  );
  checker.ok(
    'Firefox manifest retains browser_specific_settings.gecko',
    Boolean(firefoxManifest.browser_specific_settings && firefoxManifest.browser_specific_settings.gecko)
  );
  checker.equals(
    'Firefox manifest gecko id is correct',
    firefoxManifest.browser_specific_settings?.gecko?.id,
    'fb-feed-diet@amppa.github.io'
  );
  checker.ok(
    'Firefox manifest retains background.scripts array',
    Array.isArray(firefoxManifest.background?.scripts) && firefoxManifest.background.scripts.length === 2
  );
  checker.ok(
    'Firefox manifest preserves general fields',
    firefoxManifest.manifest_version === 3 &&
      firefoxManifest.version === manifest.version &&
      Array.isArray(firefoxManifest.content_scripts)
  );

  // 4. Unknown target throws
  let unknownThrew = false;
  try {
    packageExtension('safari');
  } catch {
    unknownThrew = true;
  }
  checker.ok('packageExtension throws on unknown target', unknownThrew);

  // 5. Clean packaging into a temporary test release directory
  const testReleaseDir = path.join(ROOT, 'release', '.test-package-suite');
  try {
    const chromePkg = packageExtension('chrome', {
      releaseDir: testReleaseDir,
      slug: 'fb-feed-diet-test',
      skipVersionCheck: true,
    });
    checker.ok('Chrome test package created', fs.existsSync(chromePkg.zipFilePath));
    checker.equals('Chrome package name follows target convention', chromePkg.zipFileName, `fb-feed-diet-test-chrome-v${manifest.version}.zip`);

    const ffPkg = packageExtension('firefox', {
      releaseDir: testReleaseDir,
      slug: 'fb-feed-diet-test',
      skipVersionCheck: true,
    });
    checker.ok('Firefox test package created', fs.existsSync(ffPkg.zipFilePath));
    checker.equals('Firefox package name follows target convention', ffPkg.zipFileName, `fb-feed-diet-test-firefox-v${manifest.version}.zip`);
  } finally {
    if (fs.existsSync(testReleaseDir)) {
      fs.rmSync(testReleaseDir, { recursive: true, force: true });
    }
  }
}

module.exports = { run };
