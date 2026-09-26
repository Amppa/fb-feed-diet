# Local Workflow, Packaging & Testing

> Developer topic file. Start at the hub: [DEVELOPMENT.md](../DEVELOPMENT.md).

## 💻 Local Development Workflow

1. Clone or open this repository.
2. In Google Chrome, navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** (載入未封裝項目) and select the repository root directory.
5. Making changes:
   - **Popup & Options changes**: Refresh the extension on `chrome://extensions/` or reopen the popup/options page.
   - **Content scripts & Inject changes**: Refresh the extension, then reload any active Facebook tabs.

### Handling Extension Reloads Gracefully

When modifying extension code:
1. Reload **FB Diet** on `chrome://extensions/`.
2. Reload all open Facebook tabs.
3. If an open tab is kept alive during extension reload, `content.js` triggers `shutdown()` automatically as soon as it detects `chrome.runtime?.id` is invalidated, disconnecting observers and preventing `Extension context invalidated` console spam.

---

## 🏷️ Version Bumping

To synchronize version updates across `package.json`, `manifest.json`, and `src/shared/defaults.js` in a single command:

```bash
# Using npm:
npm run bump-version 2.1.1
npm run bump-version patch   # or minor / major

# Using Node.js directly:
node scripts/bump-version.js 2.1.1
```

---

## 📦 Packaging for Release

Packagers generate a clean release `.zip` in `release/` and automatically exclude `design/`, `scripts/`, `tests/`, documentation, and git metadata:

```bash
# Using npm:
npm run package

# Using Node.js directly:
node scripts/package.js

# Or on Windows using PowerShell:
powershell -ExecutionPolicy Bypass -File scripts/package.ps1
```

The same zip also installs on **Firefox 128+**: Firefox reads `background.scripts` as an event page while Chrome reads `background.service_worker`, so one manifest serves both. Sideload in Firefox via `about:debugging` → *This Firefox* → *Load Temporary Add-on…*.

---

## 🧪 Testing Strategy (`tests/`)

Unit tests run under **Node.js** with zero browser/DOM dependencies and zero external runtime dependencies — assertions come from `tests/harness.js`.

Test pure business logic, Relay path resolution, classification decisions and the i18n dictionaries. **Browser automation is forbidden**: never introduce Puppeteer, Playwright or similar tooling into this project; frontend and extension behaviour is verified manually in Chrome or through isolated Node unit tests.

### Running the Test Suite

```bash
# Using npm
npm test

# Or directly with node:
node tests/run.js
```

### Test Structure

- **`tests/harness.js`**: Minimalist test harness providing `ok`, `equal`, `deepEqual`, `throws`, and test summary reporting.
- **`tests/proxy.test.js`**: Validates `window.__d` interception, factory patching, error recovery, and multiple registration handling.
- **`tests/relay.test.js`**: Mocks Relay record stores and tests path query features (`^`, `^^`, `{$var}`, wildcards).
- **`tests/classify.test.js`**: Tests feed unit payloads against all classification rules (sponsored ads, suggestions, groups, reels, stories).
- **`tests/dom-metadata.test.js`**: Tests the MAIN-world DOM metadata collector contract and fallback behavior.
- **`tests/probe-css.test.js`**: Verifies probe styles live in the declarative content stylesheet and are not injected by JavaScript.
- **`tests/suggested-dom.test.js`**: Tests the MAIN-world suggested-post detector, including false-positive guards and module wiring.
- **`tests/i18n.test.js`**: Loads `src/i18n/i18n.js` into a VM sandbox and validates language detection/normalization, dictionary lookups, unknown-key fallback, and the `setLang` round-trip.
- **`tests/fold.test.js`**: Tests wrapper generation, React element creation, category metadata binding, and feed-module registration paths.

### Adding New Classification Rules

1. Define the Relay path or prop attribute and the new `CATEGORY` entry in `src/inject/classify.js`.
2. Map the category in `src/shared/defaults.js`: its user-facing group in `GROUP_BY_CATEGORY`, its storage key in `SETTING_BY_CATEGORY`, and its badge metadata in `GROUP_META` (consumed by `src/inject/ui.js`, which owns the bars and badges — STRATEGY.md, decision #8). `tests/defaults.test.js` pins that the category table agrees with the group layer.
3. Add corresponding test fixture assertions in `tests/classify.test.js`.
4. Run `npm test` to verify zero regression across existing rules.
