// scripts/package.js
// Packages the extension into clean, browser-specific release zip files (Chrome and Firefox).
// Zero JS dependencies: uses system tools that always emit the PK zip format
// (Info-ZIP, Python zipfile, PowerShell Compress-Archive, or bsdtar).
//
// Generates:
//   - release/fb-feed-diet-chrome-v<version>.zip   (cleans Firefox-specific fields)
//   - release/fb-feed-diet-firefox-v<version>.zip  (cleans Chrome-specific fields)
//
// Usage:
//   node scripts/package.js           # Packages both Chrome and Firefox
//   node scripts/package.js chrome    # Packages only Chrome
//   node scripts/package.js firefox   # Packages only Firefox

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'manifest.json');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');
const TARGETS = ['chrome', 'firefox'];
const BASE_SLUG = 'fb-feed-diet';

/**
 * Derives a clean, browser-specific manifest from the unified source manifest.
 *
 * @param {object} baseManifest - Source manifest.json
 * @param {'chrome'|'firefox'} target - Browser target
 * @returns {object} Clean target-specific manifest
 */
function generateManifest(baseManifest, target) {
  const manifest = JSON.parse(JSON.stringify(baseManifest));

  if (target === 'chrome') {
    // Chrome Web Store MV3 requires service_worker background and disallows Firefox-specific settings
    delete manifest.browser_specific_settings;
    if (manifest.background) {
      delete manifest.background.scripts;
    }
  } else if (target === 'firefox') {
    // Firefox AMO MV3 uses background event scripts and gecko ID, disallowing service_worker
    delete manifest.minimum_chrome_version;
    if (manifest.background) {
      delete manifest.background.service_worker;
    }
  }

  return manifest;
}

/**
 * Creates a real ZIP archive (PK magic) using system utilities that always
 * emit the zip format: Info-ZIP, Python zipfile, PowerShell
 * Compress-Archive, or bsdtar.
 *
 * Tool order is deliberate. `tar -a` is only trustworthy under bsdtar
 * (Windows/macOS): GNU tar (Linux CI) silently writes a plain ustar stream
 * even when the target is named .zip, which once shipped tar-bytes-as-zip
 * in a public release. GNU tar is therefore never used here, and the PK
 * magic-byte assertion at the end fails the build loudly instead of
 * shipping a misnamed archive.
 *
 * @param {string} sourceDir - Absolute path to directory containing items to zip
 * @param {string[]} items - Relative paths of files/folders inside sourceDir to include
 * @param {string} destZip - Absolute path to destination .zip file
 */
function archiveDirectory(sourceDir, items, destZip) {
  if (fs.existsSync(destZip)) {
    fs.unlinkSync(destZip);
  }

  // Python zipfile writer: no shell quoting issues (args passed directly),
  // layout matches `zip -r` (top-level entries, relative arcnames).
  // Newlines are fine: execFileSync passes the script as one argv entry.
  const pythonZipScript = [
    'import os, sys, zipfile',
    'dest, names = sys.argv[1], sys.argv[2:]',
    'with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:',
    '    for name in names:',
    '        if os.path.isdir(name):',
    '            for root, _, files in os.walk(name):',
    '                for f in files:',
    '                    p = os.path.join(root, f)',
    '                    z.write(p, os.path.relpath(p))',
    '        else:',
    '            z.write(name, name)',
  ].join('\n');

  const steps = [
    {
      label: 'zip',
      run() {
        execFileSync('zip', ['-q', '-r', destZip, ...items], {
          cwd: sourceDir,
          stdio: ['ignore', 'ignore', 'inherit'],
        });
      },
    },
    {
      label: 'python3-zipfile',
      run() {
        execFileSync('python3', ['-c', pythonZipScript, destZip, ...items], {
          cwd: sourceDir,
          stdio: ['ignore', 'ignore', 'inherit'],
        });
      },
    },
    {
      label: 'python-zipfile',
      run() {
        execFileSync('python', ['-c', pythonZipScript, destZip, ...items], {
          cwd: sourceDir,
          stdio: ['ignore', 'ignore', 'inherit'],
        });
      },
    },
  ];

  if (process.platform === 'win32') {
    steps.push({
      label: 'compress-archive',
      run() {
        const itemsList = items.map((i) => `'${i}'`).join(',');
        execFileSync(
          'powershell.exe',
          ['-NoProfile', '-Command', `Compress-Archive -Path ${itemsList} -DestinationPath '${destZip}' -Force`],
          {
            cwd: sourceDir,
            stdio: ['ignore', 'ignore', 'inherit'],
          }
        );
      },
    });
  }

  // bsdtar only: `tar --version` containing "bsdtar" means libarchive, whose
  // `-a` flag honors the .zip suffix with real PK output. GNU tar is skipped
  // unconditionally (see docblock).
  steps.push({
    label: 'bsdtar',
    run() {
      const version = execFileSync('tar', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString();
      if (!/bsdtar/i.test(version)) {
        throw new Error('GNU tar cannot write zip output; skipping');
      }
      execFileSync('tar', ['-a', '-cf', destZip, ...items], {
        cwd: sourceDir,
        stdio: ['ignore', 'ignore', 'inherit'],
      });
    },
  });

  const failures = [];
  let archived = false;
  for (const step of steps) {
    try {
      step.run();
      if (fs.existsSync(destZip)) {
        archived = true;
        break;
      }
      failures.push(`${step.label}: no output file`);
    } catch (err) {
      failures.push(`${step.label}: ${err.message}`);
    }
  }

  if (!archived || !fs.existsSync(destZip)) {
    throw new Error(`Failed to create archive at ${destZip} (${failures.join('; ')})`);
  }

  // Fail closed: never ship non-zip bytes under a .zip name again.
  const header = fs.readFileSync(destZip).subarray(0, 2);
  if (header.length < 2 || header[0] !== 0x50 || header[1] !== 0x4b) {
    fs.unlinkSync(destZip);
    throw new Error(
      `Refusing to ship non-zip bytes as ${path.basename(destZip)} (${failures.join('; ') || 'no tool reported an error'})`
    );
  }
}

/**
 * Validates version parity between manifest.json and defaults.js.
 *
 * The read pattern must stay identical to the one bump-version.js writes with: a reader that looks
 * for something else finds nothing and passes. Per decisions-history.md #58.
 *
 * @param {string} version manifest.json's version
 * @param {string} [rootDir] tree being packaged; defaults to the repository this script sits in
 */
function verifyVersionParity(version, rootDir) {
  const defaultsPath = path.join(rootDir || ROOT_DIR, 'src', 'shared', 'defaults.js');
  if (!fs.existsSync(defaultsPath)) return;
  const match = fs.readFileSync(defaultsPath, 'utf8').match(/const\s+EXTENSION_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error(`Version parity check could not read EXTENSION_VERSION from ${defaultsPath}`);
  }
  if (match[1] !== version) {
    throw new Error(`Version mismatch! manifest.json (${version}) does not match defaults.js (${match[1]}).`);
  }
}

/**
 * Packages a clean build for a specific target browser.
 *
 * @param {'chrome'|'firefox'} target
 * @param {object} [options]
 * @returns {{ target: string, zipFileName: string, zipFilePath: string, sizeKb: string }}
 */
function packageExtension(target, options = {}) {
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown target '${target}'. Supported targets: ${TARGETS.join(', ')}`);
  }

  const rootDir = options.rootDir || ROOT_DIR;
  const releaseDir = options.releaseDir || RELEASE_DIR;
  const manifestPath = path.join(rootDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${rootDir}`);
  }

  const baseManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = baseManifest.version || '1.0.0';

  if (!options.skipVersionCheck) {
    verifyVersionParity(version, rootDir);
  }

  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }

  const slug = options.slug || BASE_SLUG;
  const zipFileName = `${slug}-${target}-v${version}.zip`;
  const zipFilePath = path.join(releaseDir, zipFileName);
  const stagingDir = path.join(releaseDir, `.staging-${target}`);

  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    // 1. Write clean browser-specific manifest
    const targetManifest = generateManifest(baseManifest, target);
    fs.writeFileSync(
      path.join(stagingDir, 'manifest.json'),
      JSON.stringify(targetManifest, null, 2) + '\n',
      'utf8'
    );

    // 2. Copy extension assets
    const copyItems = ['icons', 'src'];
    if (fs.existsSync(path.join(rootDir, '_locales'))) {
      copyItems.push('_locales');
    }
    for (const item of copyItems) {
      const srcItemPath = path.join(rootDir, item);
      if (!fs.existsSync(srcItemPath)) {
        throw new Error(`Required package item '${item}' does not exist.`);
      }
      fs.cpSync(srcItemPath, path.join(stagingDir, item), { recursive: true });
    }

    // 3. Create clean zip from staging directory
    archiveDirectory(stagingDir, ['manifest.json', ...copyItems], zipFilePath);

    const stats = fs.statSync(zipFilePath);
    const sizeKb = (stats.size / 1024).toFixed(1);

    return {
      target,
      zipFileName,
      zipFilePath,
      sizeKb,
    };
  } finally {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }
}

function run() {
  const arg = (process.argv[2] || '').toLowerCase().trim();
  const selectedTargets = arg ? [arg] : TARGETS;

  for (const t of selectedTargets) {
    if (!TARGETS.includes(t)) {
      console.error(`Error: Unknown target '${t}'. Supported targets: ${TARGETS.join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`Packaging extension for targets: ${selectedTargets.join(', ')}...`);

  for (const target of selectedTargets) {
    try {
      const result = packageExtension(target);
      console.log(`✓ [${result.target}] Package created successfully!`);
      console.log(`  File: release/${result.zipFileName} (${result.sizeKb} KB)`);
    } catch (err) {
      console.error(`✗ [${target}] Failed:`, err.message);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  TARGETS,
  generateManifest,
  archiveDirectory,
  verifyVersionParity,
  packageExtension,
};
