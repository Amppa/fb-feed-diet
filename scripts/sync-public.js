// scripts/sync-public.js
// Cumulative clean sync to the public GitHub repository.
//
// Unlike the original single-commit workflow, this keeps the public history:
// it clones the public mirror, overlays only the whitelisted public files from
// this checkout, and fast-forward pushes ONE new commit per release. No force-push.
//
// Security model is unchanged: sensitive paths are never copied (allowlist, not
// denylist), and a pre-commit assertion aborts if any forbidden path is present
// in the staging tree — whether from this checkout or from a polluted mirror.
//
// Usage:
//   node scripts/sync-public.js [extra-message]
//   npm run sync:public

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(ROOT_DIR, '.public-sync-temp');

// 1. Target Public Repository URL (origin)
const PUBLIC_REPO_URL = 'https://github.com/Amppa/fb-feed-diet.git';

// 2. Allowlist of files and folders to make public
// Excludes: docs/, STRATEGY.md, DEVELOPMENT.md, AGENTS.md, design/, release/, tests/testcase/
// scripts/ is included because tests/bump-version.test.js requires scripts/bump-version, so
// without it the mirror ships a test suite that cannot run. It also lets a mirror-only clone
// produce the installable zip, since release/ is excluded.
const PUBLIC_INCLUDES = [
  'manifest.json',
  'README.md',
  'package.json',
  'icons',
  'src',
  'tests',
  'scripts',
  'screenshots'
];

// 3. Paths that must NEVER appear in the public tree. Checked before every commit.
const FORBIDDEN_PATHS = [
  'docs',
  'STRATEGY.md',
  'DEVELOPMENT.md',
  'AGENTS.md',
  'design',
  'release',
  'tests/testcase',
  'tests/private',
  '.kilo'
];

function sh(cmd, cwd) {
  return execSync(cmd, { cwd: cwd || ROOT_DIR, stdio: 'pipe' }).toString().trim();
}

function copyWhitelist(destDir) {
  for (const item of PUBLIC_INCLUDES) {
    const srcPath = path.join(ROOT_DIR, item);
    const destPath = path.join(destDir, item);
    if (fs.existsSync(srcPath)) {
      fs.rmSync(destPath, { recursive: true, force: true });
      fs.cpSync(srcPath, destPath, { recursive: true });
      console.log(`  + Copied: ${item}`);
    }
  }
  // tests/testcase/ and tests/private/ must never arrive in the public tree —
  // remove explicitly either way.
  const testcaseDir = path.join(destDir, 'tests', 'testcase');
  if (fs.existsSync(testcaseDir)) {
    fs.rmSync(testcaseDir, { recursive: true, force: true });
    console.log('  - Excluded: tests/testcase/');
  }
  const privateDir = path.join(destDir, 'tests', 'private');
  if (fs.existsSync(privateDir)) {
    fs.rmSync(privateDir, { recursive: true, force: true });
    console.log('  - Excluded: tests/private/');
  }
}

function writePublicGitignore(destDir) {
  const publicGitignore = `# Dependencies & OS files
node_modules/
.DS_Store
Thumbs.db

# Extension packaging outputs
release/
.public-sync-temp/
`;
  fs.writeFileSync(path.join(destDir, '.gitignore'), publicGitignore, 'utf8');
}

function assertCleanTree(destDir) {
  const violations = FORBIDDEN_PATHS.filter((rel) => fs.existsSync(path.join(destDir, rel)));
  if (violations.length > 0) {
    throw new Error(`forbidden paths present in public tree: ${violations.join(', ')}`);
  }
}

function run() {
  const extraMessage = (process.argv[2] || '').trim();
  console.log('[Sync Public] Cumulative clean sync to public repository...');

  // Fresh clone of the public mirror, so its history is preserved and extended.
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  console.log('[Sync Public] Cloning public mirror...');
  sh(`git clone --branch master ${PUBLIC_REPO_URL} "${TEMP_DIR}"`, ROOT_DIR);

  try {
    copyWhitelist(TEMP_DIR);
    writePublicGitignore(TEMP_DIR);
    assertCleanTree(TEMP_DIR);

    sh('git add -A', TEMP_DIR);
    const pending = sh('git status --porcelain', TEMP_DIR);
    if (!pending) {
      console.log('[Sync Public] Already in sync — public mirror needs no new commit.');
      return;
    }

    // manifest.json is the field Chrome installs, so it names the release. A
    // missing or unreadable version is fatal rather than falling back to a
    // hardcoded number: a stale default would quietly label this release
    // with a version nobody shipped.
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
    const version = manifest.version;
    if (!version) throw new Error('manifest.json has no version field');

    const message = extraMessage
      ? `Release v${version}: ${extraMessage} (clean source)`
      : `Release v${version} (clean source)`;
    sh(`git commit -m "${message.replace(/"/g, '')}"`, TEMP_DIR);

    console.log(`[Sync Public] Pushing to ${PUBLIC_REPO_URL} (fast-forward, no --force)...`);
    sh('git push origin master', TEMP_DIR);

    console.log('[Sync Public] Success! Public history extended by one clean commit.');
  } finally {
    // Always clean up temp directory
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  try {
    run();
  } catch (err) {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
    console.error('[Sync Public] Error during sync:', err.message);
    process.exit(1);
  }
}

module.exports = { PUBLIC_INCLUDES, FORBIDDEN_PATHS, assertCleanTree };
