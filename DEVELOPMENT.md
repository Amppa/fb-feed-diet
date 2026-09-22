# Development Guide

This document covers project architecture, internal data flow, runtime specifications, development workflow, debugging techniques, and testing conventions for **FB Diet**.

---

## 🛠️ Project Structure

```text
fb-diet-feed/
├── manifest.json              # MV3 configuration with dual-world content scripts
├── package.json               # Test script and package metadata
├── README.md                  # User-facing summary and installation instructions
├── DEVELOPMENT.md             # Developer guide, architecture & debugging (this file)
├── AGENTS.md                  # Professional engineering discipline & AI contract
├── STRATEGY.md                # Feed classification strategy & decision log
├── design/                    # Source design assets (e.g. Affinity fb-fd.af)
├── icons/                     # Extension asset icons (16, 32, 48, 128)
├── scripts/                   # Zero-dependency release packagers (NOT packaged)
│   ├── package.js             # Node.js packaging script
│   └── package.ps1            # Windows PowerShell packaging script
├── src/
│   ├── shared/
│   │   └── defaults.js        # Single source of truth for settings & stats schemas
│   ├── background/
│   │   └── background.js      # Service Worker: settings sync, tab broadcast
│   ├── content/
│   │   ├── content.css        # Responsive styling for inline placeholders
│   │   ├── content.js         # Isolated world: storage sync, throttled stats, DOM fallback
│   │   └── detector.js        # Multilingual regexes & DOM heuristics for fallback
│   ├── i18n/
│   │   └── i18n.js            # Shared en / zh-TW dictionary for options & popup pages
│   ├── inject/
│   │   ├── proxy.js           # Hooks window.__d, wraps React components safely
│   │   ├── relay.js           # Intercepts Relay Record Store and evaluates field paths
│   │   ├── metadata.js        # Probe enrichment: author / group / content / media / viewer
│   │   ├── classify.js        # Pure functions mapping feed props + Relay to categories
│   │   ├── classify-retired.js# Retired rules kept for reference (never injected)
│   │   ├── bridge.js          # In-memory settings, postMessage router, expansion state
│   │   └── fold.js            # FBDietFold React decorator component & placeholder UI
│   ├── options/
│   │   ├── options.html       # Full dashboard & group toggles
│   │   ├── options.css        # Dark glassmorphic styles
│   │   └── options.js         # Live stats breakdown and configuration sync
│   └── popup/
│       ├── popup.html         # Compact extension toolbar popup
│       ├── popup.css          # Minimalist dark popup UI
│       └── popup.js           # Master toggle and options page navigation
└── tests/
    ├── harness.js             # Lightweight Node test assertion framework
    ├── run.js                 # Test runner discovering *.test.js
    ├── defaults.test.js       # Unit tests for shared defaults schema
    ├── proxy.test.js          # Unit tests for proxy.js registration & hooks
    ├── relay.test.js          # Unit tests for relay.js path navigation
    ├── classify.test.js       # Unit tests for feed unit classification
    ├── i18n.test.js           # Unit tests for language dictionaries & fallback
    └── fold.test.js           # Unit tests for folding wrapper logic
```

---

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

---

## 🏗️ High-Level Architecture

FB Diet utilizes a **Dual-World Architecture** under Chrome Manifest V3 to balance high-speed React-level interception with secure Chrome extension APIs:

```mermaid
graph TD
    subgraph MAIN World [MAIN World - document_start]
        P[proxy.js<br/>Hook window.__d] --> R[relay.js<br/>Proxy RelayRecordSourceProxy]
        R --> C[classify.js<br/>Pure Category Rules]
        P --> F[fold.js<br/>Wrap CometFeedUnit]
        C --> F
        F <--> B[bridge.js<br/>Runtime State & Reports]
    end

    subgraph ISOLATED World [ISOLATED World - document_idle]
        CS[content.js<br/>Coordinator & Fallback]
        DET[detector.js<br/>DOM Text Scanner]
        CS --- DET
    end

    subgraph Extension Core [Extension Context]
        BG[background.js<br/>Service Worker]
        POP[popup.html / JS<br/>Quick Toggle]
        OPT[options.html / JS<br/>Settings & Stats]
        STR[(chrome.storage.local)]
    end

    %% Communication
    B <==>|"window.postMessage<br/>('fb-diet/main' & 'fb-diet/content')"| CS
    BG -->|"chrome.scripting.executeScript<br/>window.__fbDietSetSettings"| B
    CS <==>|"chrome.storage & messages"| STR
    OPT <==>|"chrome.storage"| STR
    POP <==>|"chrome.storage"| STR
    STR -.->|"storage.onChanged"| BG
```

### Core Design Principles

1. **Pure Object Patching (no eval, no CSP games)**: The MAIN-world modules only wrap live objects (module registrar, exported classes) — never `eval` / `new Function` / inline scripts, so the Facebook page CSP stays untouched and cannot interfere with page loading.
2. **Authoritative Relay Store Capture**: Wraps the exported class of `relay-runtime/mutations/RelayRecordSourceProxy` with a Proxy construct trap, so every Relay store instance is remembered without rewriting any module source. (The old `rules.json` CSP override + `RelayPublishQueue` source rewrite were removed in STRATEGY.md decision #9: the CSP replacement risked breaking page loads, and the construct trap captures the same store.)
3. **Non-Destructive React Tree (1x1 Squash)**: Feed units are never removed or destroyed. `fold.js` wraps the original component and applies a `1x1` squash container with `overflow: hidden`, ensuring Facebook video players and IntersectionObserver monitors stay stable.
4. **Dual Engine Modes (Proxy Mode vs DOM Mode)**: Users can toggle between high-speed MAIN world Proxy mode (default) and traditional ISOLATED world DOM mode in the Options page.
5. **Resilient Lifecycle (`shutdown`)**: To eliminate `Extension context invalidated` errors when developers reload the extension, open tabs safely disconnect `MutationObserver` instances, clear pending timers, and silence storage flushes.
6. **React 18 Safe Hydration Commit Gate**: To prevent `Minified React error #418` (Hydration Mismatch) in Facebook's streaming SSR / Selective Hydration architecture, all wrapped components (`FBDietFold`, `SideAdHidden`, `RightRailUnitWrapper`) return the unmodified server-rendered tree on initial render. Upon successful commit (before browser paint via `useLayoutEffect`), they transition seamlessly to the folded state, guaranteeing zero hydration errors, zero DOM destruction, and flicker-free visual performance.

---

## 🧩 Directory & Module Breakdown

### Shared Defaults Module (`src/shared/`)

- **`defaults.js` (`globalThis.FB_DIET_DEFAULTS`)**: Single source of truth for configuration and stat schema.
  - Exposes `FB_DIET_DEFAULTS.SETTINGS`, `FB_DIET_DEFAULTS.COUNTS`, the user-facing group layer (`GROUP_BY_CATEGORY`, `SETTING_KEYS_BY_GROUP`, `GROUP_ORDER`; STRATEGY.md decision #8), and `VERSION`.
  - Loaded before all scripts via `manifest.json` (`content_scripts`), `importScripts` (`background.js`), and `<script>` tags (`popup.html`, `options.html`).
  - Eliminates configuration drift across contexts.

### Main World Modules (`src/inject/`)

Loaded sequentially at `document_start` before Comet finishes loading:

- **`proxy.js` (`window.FBDietProxy`)**:
  - Intercepts `window.__d` (Comet module definer) via property getter/setter.
  - Matches requested module names (e.g. `CometFeedUnitErrorBoundary.react`).
  - Wraps component factories without modifying source text.
  - Exposes `getReact()` and diagnostic getters.
- **`relay.js` (`window.FBDietRelay`)**:
  - Uses a `Proxy` `construct` trap around `relay-runtime/mutations/RelayRecordSourceProxy`.
  - Maintains an LRU cache of the latest 6 record store proxies (`sources`).
  - Implements path evaluator supporting syntax:
    - `^field`: follow linked record ID.
    - `^^list[0].field`: access first item in linked record list.
    - `{$1}` / `{$args}`: dynamic query variables.
    - `*`: wildcard record lookups.
- **`classify.js` (`window.FBDietClassify`)**:
  - Pure deterministic classification functions.
  - Evaluates direct props first, followed by Relay paths.
  - `classifyFeedUnit(payload, context)` — `context.moduleName` is part of the decision (the Reels attachment wrapper never folds as Reels).
  - Supported categories (see [STRATEGY.md](STRATEGY.md) for the full decision log):
    - `sponsored`: `^sponsored_data.ad_id`
    - `suggested`: `^^actors[0].subscribe_status === 'CAN_SUBSCRIBE'` (only this value) or `^to.viewer_forum_join_state === 'CAN_JOIN'` (a can-join group post is a suggestion; STRATEGY.md, decision #10). story_header is diagnostic-only evidence and NEVER decides a category (STRATEGY.md, decision #6; retired rules kept in `src/inject/classify-retired.js`)
    - `suggestedGroup`: `GroupsYouShouldJoinFeedUnit` / `GroupSuggestionsFeedUnit` typenames only — the horizontal "groups you should join" list unit (STRATEGY.md, decision #10)
    - `reels`: the unit's OWN `__typename === 'ShowcaseFeedUnit'` (nested attachment records and the attachment-style module are excluded on purpose)
    - `stories`: the unit's OWN `__typename === 'DiscoverFeedUnit'` (mid-feed Stories row; STRATEGY.md, decision #7); other Stories surfaces plus `marketAds` / `searchingAds` use component-name markers in `fold.js`, not unit classification
  - **User-facing groups** (two-layer model, STRATEGY.md decision #8): fine-grained categories map to 5 groups —
    `ads` (sponsored + marketAds + searchingAds), `regular` (no-match bucket; stats only, never foldable),
    `suggested`, `media` (reels + stories), `other` (suggestedGroup).
    Storage stays per-category with zero migration; Options group switches batch-write the mapped keys
    (`SETTING_KEYS_BY_GROUP`, "on" only when every mapped key is on). Folded bars and the stats breakdown
    display the group; probe popups show both layers (feed type + group).
- **`bridge.js` (`window.FBDietBridge`)**:
  - Owns in-page expand/collapse state (`expandedSet`).
  - Manages deduplication sets (`reportedBlockedSet`, `reportedRegularSet`) to prevent redundant storage writes.
  - Handles `window.postMessage` communication between MAIN and ISOLATED worlds.
  - Accepts immediate settings push via `window.__fbDietSetSettings`.
- **`fold.js` (`window.FBDietFold`)**:
  - Wraps target feed unit components using `React.createElement`.
  - Folded bars and re-fold bars show the user-facing GROUP badge (`GROUP_META` + local `GROUP_BY_CATEGORY`, resolved via `groupOf(category)`), not the fine-grained category (STRATEGY.md, decision #8).
  - Enforces strict Rules of Hooks (unconditional top-level hooks: `useContext`, `useState`, `useEffect`, `useSafeLayoutEffect`).
  - **Safe Hydration Commit Gate**: Returns the original `rendered` tree during initial SSR hydration pass, then transitions to folded UI via `useSafeLayoutEffect` immediately upon commit, eliminating React 18 `#418` hydration mismatch errors.
  - If a unit matches an active filter and is not expanded, renders an inline `FBDietFold` bar and sets the original element container to squash mode (`1x1` container).
  - Also guards sidebar ad units (`SideAdHidden` and `RightRailUnitWrapper`) with identical commit gates.
  - Tracks diagnostic hydration statistics (`getStatus().hydration`).
  - Preserves Relay query subscriptions and React component identity.

### Isolated World Modules (`src/content/`)

- **`content.js`**:
  - Listens for `fb-diet/main` messages (`ready`, `blocked`, `allowed`, `regular`).
  - Persists a capped diagnostic log of classification events to `chrome.storage.local` (`fbDietLog`, last 300 entries, batched flush).
  - Manages a 3-second throttled buffer (`countBuffer`) to batch-update `chrome.storage.local`.
  - Disables DOM scanning as soon as `ready` is received from MAIN world.
  - Implements `shutdown()`: called on context invalidation to gracefully halt observers and timers.
- **`detector.js` (`window.FBDietDetector`)**:
  - Fallback text parser with multilingual keyword dictionaries (Sponsored, Suggested, etc.).
  - Handles SVG text masking, aria-labels, and obfuscated spans.

### Shared i18n Module (`src/i18n/`)

- **`i18n.js` (`window.FBDietI18N`)**: Dependency-free dictionary module shared by the pages that render UI text.
  - Loaded via `<script>` from `src/options/options.html` and `src/popup/popup.html`. It is intentionally NOT in
    `manifest.json`'s content-script lists, so neither the ISOLATED content scripts nor the MAIN world have it.
  - Ships `en` and `zh-TW`; every other locale normalizes to `en` (`normalize`, `detect`, `FALLBACK`).
  - API: `t(key, lang?)`, `detect()`, `getLang()`, `setLang(code)`, `normalize(code)`, `LOCALES`, `FALLBACK`.
  - `t()` resolves the requested language, then English, then returns the key itself, so an unknown key is
    visible instead of blank. Options/popup drive DOM text through `data-i18n` / `data-i18n-title` attributes.
  - Feed placeholder badges stay hardcoded in `fold.js` (`GROUP_META.badgeText`, one per user-facing group) on purpose: the MAIN world
    has no i18n module (`tests/i18n.test.js` asserts the badge keys were trimmed from the shared dictionary).

---

## 🔄 Runtime Data & Control Flows

### 1. Initialization Sequence

```text
Tab Navigates to facebook.com
  │
  ├─► [MAIN World: document_start]
  │     1. proxy.js attaches getter/setter to window.__d
  │     2. relay.js queues wrapExports for RelayRecordSourceProxy
  │     3. classify.js binds setRelayReader
  │     4. bridge.js registers message listener
  │     5. fold.js registers CometFeedUnitErrorBoundary.react with proxy
  │
  ├─► [Background Service Worker]
  │     Pushes saved settings to tab via chrome.scripting (window.__fbDietSetSettings)
  │
  └─► [ISOLATED World: document_idle]
        1. content.js boots, starts 8s fallback timer
        2. Sends ping { source: 'fb-diet/content', type: 'ping' }
        3. MAIN world replies ready { source: 'fb-diet/main', type: 'ready' }
        4. content.js marks proxyActive = true and cancels fallback timer
```

### 2. Feed Unit Classification & Folding Flow

```text
Comet renders CometFeedUnitErrorBoundary
  │
  ▼
FBDietFold wrapper executes
  │
  ├─► Extract feed unit ID & props
  ├─► Check bridge.isExpanded(unitId)
  │     └─► If true: return original component untouched
  │
  ├─► FBDietClassify.classifyFeedUnit(payload)
  │     ├─► Inspect props directly
  │     └─► Read Relay paths via FBDietRelay.read(...)
  │
  ├─► Matched active category?
  │     ├─► NO:
  │     │     Report regular (reason: no-match) -> return original element
  │     │
  │     └─► YES:
  │           1. bridge.reportBlocked(unitId, category)
  │           2. postMessage to content.js (queued for 3s storage flush)
  │           3. Return placeholder bar + hidden original tree (display: none)
```

### 3. Expand / Restore Lifecycle

When a user clicks **"Expand"** on a folded placeholder:
1. `fold.js` event handler calls `bridge.toggleExpanded(unitId, true)`.
2. Component triggers local React state rerender (`setExpanded(true)`).
3. The original tree becomes visible immediately with a **"Re-fold"** option on top.
4. The expanded state is kept in memory (`bridge.js`) keyed by `unitId`, surviving virtual scroll recycling without hitting disk storage.

---

## 🔍 In-Browser Diagnostic Consoles & Debugging

FB Diet exposes rich diagnostic inspection helpers directly in the browser DevTools console.

### MAIN World Inspection (Select `top` context in DevTools Console)

```javascript
// 1. Check proxy interception stats
window.FBDietProxy.getStats();
// => { intercepted: 142, patched: 1, hookRuns: 38, patchedModules: ["CometFeedUnitErrorBoundary.react"] }

// 2. Check Relay store capture status
window.FBDietRelay.isReady();         // => true
window.FBDietRelay.getSourceCount();  // => number of active store snapshots

// 3. Inspect recent classification reports
window.FBDietBridge.getRecentReports();
// => Array of { id, category, reason, evidence, at }

// 4. View intercepted errors
window.FBDietProxy.getErrors();
window.FBDietRelay.getLastError();
```

### Verbose Logging via URL Query

Append `?fb_diet_debug=1` to any Facebook URL:
```text
https://www.facebook.com/?fb_diet_debug=1
```
This activates verbose `[FB Diet][MAIN]` console output for every intercepted unit, classified category, and bridge message.

### ISOLATED World Inspection (Select `FB Diet` context in DevTools Console)

```javascript
// Check content script status & buffer
window.__fbDietStatus();
window.__fbDietReports();      // in-memory MAIN world reports

// Persistent diagnostic log (chrome.storage.local "fbDietLog", last 300 events)
window.__fbDietDumpLog();      // prints & returns the stored entries
window.__fbDietClearLog();     // wipes the log
```

### Feed Probe Buttons (per-unit diagnostics, Probe v2)

Enable "Show Feed Probe Buttons" in the Options page (or open Facebook with `?fb_diet_debug=1`).
Every unit flowing through `FBDietFold` then shows a small 🔍 button floating on its left side;
clicking it copies a compact JSON report of that unit and displays a floating popup (click outside to dismiss)
showing the feed type, user-facing group, author/group, relation status (`NULL` for missing values),
title/snippet (40 chars max), and match reason:

- `classify`: the decision (`category`, `unitId`, `unitTypename`, `reason`, streamlined `evidence` with `id`, `idCount`)
- `enrichment` (`metadata.js`, best-effort & null-safe): author (id, name, typename, subscribe status),
  group (id, name, join state, permalink), content (message snippet, title, permalink, raw `createdTime`,
  ISO `createdAt`, `callToAction`, `feedContext`, `isReshare`), media (attachment count, deduplicated types,
  `isMultiImage`, `hasVideo`), viewer (`isSelf`: boolean / null)
- `relayReads`: the exact Relay paths the classifier tried for this unit, with the returned values
- `recordKeys`: top-level keys of the Relay record (identifies new/modified FB fields without huge dumps)
- `href` / `version` / `settings`: context snapshot (page URL, extension version, active filter toggles)
- `payload`: unit position and `feedUnit.post_id` only (redundant `__id` and `__typename` pruned, [STRATEGY.md](STRATEGY.md) decisions #11/#13)

Use it to diagnose missed folds (`classify.category: null` — check `reason`) and wrong folds
(`reason` maps back to the rule table in [STRATEGY.md](STRATEGY.md) §3).

### Options Debug Card (Feed Probe Buttons)

The Options page has a **DEBUG** card below Feed Classifies. It hosts the **Show Feed Probe Buttons**
toggle: when enabled, each feed unit displays a 🔍 button on hover/focus to copy its diagnostic JSON
and inspect the classification, enrichment details, and Relay reads directly via tooltip.
(The previous in-page JSON analyzer textarea has been removed in favor of direct tooltip inspection.)

---

## 🧪 Testing Strategy (`tests/`)

Unit tests run under **Node.js** with zero browser or DOM dependencies.

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
- **`tests/i18n.test.js`**: Loads `src/i18n/i18n.js` into a VM sandbox and validates language detection/normalization, dictionary lookups, unknown-key fallback, and the `setLang` round-trip.
- **`tests/fold.test.js`**: Tests wrapper generation, React element creation, and category metadata binding.

### Adding New Classification Rules

1. Define the Relay path or prop attribute in `src/inject/classify.js`.
2. Add the category mapping in `CATEGORY` and `SETTING_BY_CATEGORY`.
3. Map the category to its user-facing group in `GROUP_BY_CATEGORY` (`src/shared/defaults.js` and the local copy in `src/inject/fold.js`); badge metadata lives in `GROUP_META` (STRATEGY.md, decision #8).
4. Add corresponding test fixture assertions in `tests/classify.test.js`.
5. Run `npm test` to verify zero regression across existing rules.
