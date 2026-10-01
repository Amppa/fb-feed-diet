// scripts/sync-public.js
// Synchronizes the clean, public extension source to the public GitHub repository.
// Completely excludes internal documentation (docs/, STRATEGY.md, etc.) and testcase captures.
// Forces a single clean commit on the public repository, purging past commit history.

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
  'scripts'
];

console.log('🚀 [Sync Public] Starting clean export for public repository...');

// Ensure clean temp working directory
if (fs.existsSync(TEMP_DIR)) {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Copy allowed items
for (const item of PUBLIC_INCLUDES) {
  const srcPath = path.join(ROOT_DIR, item);
  const destPath = path.join(TEMP_DIR, item);
  if (fs.existsSync(srcPath)) {
    fs.cpSync(srcPath, destPath, { recursive: true });
    console.log(`  + Copied: ${item}`);
  }
}

// Remove sensitive testcase directory if it was copied inside tests/
const testcaseDir = path.join(TEMP_DIR, 'tests', 'testcase');
if (fs.existsSync(testcaseDir)) {
  fs.rmSync(testcaseDir, { recursive: true, force: true });
  console.log('  - Excluded: tests/testcase/');
}

// Create a minimal public .gitignore
const publicGitignore = `# Dependencies & OS files
node_modules/
.DS_Store
Thumbs.db

# Extension packaging outputs
release/
.public-sync-temp/
`;
fs.writeFileSync(path.join(TEMP_DIR, '.gitignore'), publicGitignore, 'utf8');

// Initialize a brand new, clean git repository
console.log('🧹 [Sync Public] Creating clean git history (purging previous commits)...');
try {
  execSync('git init', { cwd: TEMP_DIR, stdio: 'pipe' });
  execSync('git branch -M master', { cwd: TEMP_DIR, stdio: 'pipe' });
  execSync('git add .', { cwd: TEMP_DIR, stdio: 'pipe' });
  
  // Read the version for the clean commit message. manifest.json is the field Chrome installs,
  // so it is the one that has to match the commit. A missing or unreadable file is fatal rather
  // than falling back to a hardcoded number: a stale default would quietly label this release
  // with a version nobody shipped.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
  const version = manifest.version;
  if (!version) throw new Error('manifest.json has no version field');

  execSync(`git commit -m "Release v${version} (clean source)"`, { cwd: TEMP_DIR, stdio: 'pipe' });

  console.log(`📡 [Sync Public] Force pushing to ${PUBLIC_REPO_URL}...`);
  execSync(`git remote add origin ${PUBLIC_REPO_URL}`, { cwd: TEMP_DIR, stdio: 'pipe' });
  
  // Force push to replace GitHub master with this clean commit
  execSync('git push -f origin master', { cwd: TEMP_DIR, stdio: 'inherit' });

  console.log('✅ [Sync Public] Success! Public GitHub history purged and updated.');
} catch (err) {
  console.error('❌ [Sync Public] Error during sync:', err.message);
  process.exit(1);
} finally {
  // Always clean up temp directory
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}
