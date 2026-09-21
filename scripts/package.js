// scripts/package.js
// Packages the Chrome extension into a clean release zip file.
// Zero npm dependencies: uses built-in system tools (tar or PowerShell Compress-Archive).
//
// Excludes design/, scripts/, tests/, documentation, git data, and release archives.
// Output: release/<slug>-v<version>.zip

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'manifest.json');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');

// 1. Read extension metadata from manifest.json
if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('Error: manifest.json not found in root directory.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const rawName = manifest.name || 'fb-diet';
const version = manifest.version || '1.0.0';

// Sanitize filename
const slug = rawName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');

const zipFileName = `${slug}-v${version}.zip`;
const zipFilePath = path.join(RELEASE_DIR, zipFileName);

// 2. Ensure release directory exists
if (!fs.existsSync(RELEASE_DIR)) {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
}

// Remove old zip with the same name if it exists
if (fs.existsSync(zipFilePath)) {
  fs.unlinkSync(zipFilePath);
}

// 3. Entries to include in the package
const includeItems = ['manifest.json', 'icons', 'src'];

// Validate that required items exist
for (const item of includeItems) {
  if (!fs.existsSync(path.join(ROOT_DIR, item))) {
    console.error(`Error: Required package item '${item}' does not exist.`);
    process.exit(1);
  }
}

console.log(`Packaging ${rawName} v${version}...`);

// 4. Create ZIP archive using system utilities
let packaged = false;

// Try tar (supported on Windows 10/11 build 17063+ and modern macOS/Linux)
try {
  const itemsArg = includeItems.join(' ');
  // -a automatically determines compression by extension (.zip)
  execSync(`tar -a -cf "${zipFilePath}" ${itemsArg}`, {
    cwd: ROOT_DIR,
    stdio: 'pipe',
  });
  packaged = true;
} catch {
  // Fallback for Windows if tar is unavailable or fails: use PowerShell Compress-Archive
  if (process.platform === 'win32') {
    try {
      const itemsList = includeItems.map((i) => `'${i}'`).join(',');
      const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path ${itemsList} -DestinationPath '${zipFilePath}' -Force"`;
      execSync(psCmd, { cwd: ROOT_DIR, stdio: 'pipe' });
      packaged = true;
    } catch (psErr) {
      console.error('PowerShell fallback failed:', psErr.message);
    }
  } else {
    // Fallback for Unix: use zip command
    try {
      const itemsArg = includeItems.join(' ');
      execSync(`zip -r "${zipFilePath}" ${itemsArg}`, {
        cwd: ROOT_DIR,
        stdio: 'pipe',
      });
      packaged = true;
    } catch (zipErr) {
      console.error('zip command fallback failed:', zipErr.message);
    }
  }
}

if (!packaged || !fs.existsSync(zipFilePath)) {
  console.error('Failed to create zip package.');
  process.exit(1);
}

const stats = fs.statSync(zipFilePath);
const sizeKb = (stats.size / 1024).toFixed(1);

console.log(`✓ Package created successfully!`);
console.log(`  File: release/${zipFileName} (${sizeKb} KB)`);
console.log(`  Included: ${includeItems.join(', ')}`);
console.log(`  Excluded: design/, scripts/, tests/, *.md, etc.`);
