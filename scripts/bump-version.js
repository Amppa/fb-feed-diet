#!/usr/bin/env node
'use strict';

/**
 * scripts/bump-version.js
 * Synchronously bumps extension version across all configuration files:
 *  1. package.json
 *  2. manifest.json
 *  3. src/shared/defaults.js
 *
 * Usage:
 *  node scripts/bump-version.js <version>
 *  node scripts/bump-version.js patch
 *  node scripts/bump-version.js minor
 *  node scripts/bump-version.js major
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const MANIFEST_PATH = path.join(ROOT_DIR, 'manifest.json');
const DEFAULTS_PATH = path.join(ROOT_DIR, 'src', 'shared', 'defaults.js');

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSemVer(v) {
  const m = String(v).trim().match(SEMVER_REGEX);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
  };
}

function bump(currentVersion, typeOrTarget) {
  const current = parseSemVer(currentVersion);
  if (!current) {
    throw new Error(`Current version '${currentVersion}' is not valid SemVer.`);
  }

  const normalized = (typeOrTarget || '').trim().toLowerCase();
  if (normalized === 'patch') {
    return `${current.major}.${current.minor}.${current.patch + 1}`;
  }
  if (normalized === 'minor') {
    return `${current.major}.${current.minor + 1}.0`;
  }
  if (normalized === 'major') {
    return `${current.major + 1}.0.0`;
  }

  if (SEMVER_REGEX.test(normalized)) {
    return normalized;
  }

  throw new Error(
    `Invalid version or bump type: '${typeOrTarget}'. Expected 'patch', 'minor', 'major', or explicit SemVer 'x.y.z'.`
  );
}

function run() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/bump-version.js <new-version | patch | minor | major>');
    process.exit(1);
  }

  if (!fs.existsSync(PACKAGE_PATH)) {
    console.error(`Error: package.json not found at ${PACKAGE_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Error: manifest.json not found at ${MANIFEST_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(DEFAULTS_PATH)) {
    console.error(`Error: defaults.js not found at ${DEFAULTS_PATH}`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  const currentVersion = pkg.version;
  const newVersion = bump(currentVersion, arg);

  console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);

  // 1. Update package.json
  pkg.version = newVersion;
  fs.writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`  ✓ Updated package.json`);

  // 2. Update manifest.json
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  manifest.version = newVersion;
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`  ✓ Updated manifest.json`);

  // 3. Update defaults.js
  let defaultsContent = fs.readFileSync(DEFAULTS_PATH, 'utf8');
  const versionConstRegex = /(const\s+EXTENSION_VERSION\s*=\s*['"])([^'"]+)(['"];)/;
  if (!versionConstRegex.test(defaultsContent)) {
    console.error('Error: Could not locate EXTENSION_VERSION constant in defaults.js');
    process.exit(1);
  }
  defaultsContent = defaultsContent.replace(versionConstRegex, `$1${newVersion}$3`);
  fs.writeFileSync(DEFAULTS_PATH, defaultsContent, 'utf8');
  console.log(`  ✓ Updated src/shared/defaults.js`);

  console.log(`\nSuccessfully bumped to v${newVersion}!`);
}

if (require.main === module) {
  try {
    run();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { bump, parseSemVer };
