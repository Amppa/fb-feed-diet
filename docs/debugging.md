# Debugging & Diagnostics

> Developer topic file. Start at the hub: [DEVELOPMENT.md](../DEVELOPMENT.md).

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

### Feed Probe Buttons (per-unit diagnostics, Probe v3)

Enable "Show Feed Probe Buttons" in the Options page (or open Facebook with `?fb_diet_debug=1`).
Every unit flowing through `FBDietFold` displays dual diagnostic probe buttons on its top-left side:
- **Proxy Probe (🔍)**: Inspects the unit via intercepted Relay payload, GraphQL reads, and classifier state.
- **DOM Probe (🔍D)**: Inspects the unit via live DOM extraction (author, title, media, clean URLs, and signals).

Clicking either button copies a compact, structured diagnostic JSON report to the clipboard and opens a floating popup (click outside to dismiss).

#### Probe Schema (Version 3)
The probe diagnostic schema uses an independent `schemaVersion: 3` (decoupled from the extension release version, eliminating the need to tie diagnostic parsers to manifest versions):
- **Part 1 (Environment)**: `schemaVersion` (3), `type` (`proxy` | `dom`), `dietMode`, `scope` (`restricted`, `allowed`, `path`), `at` (`rendered`, `probed`).
- **Part 2 (Input)**: `feedPosition`, `postId`, `moduleName`, `unitId` (placed at the end of the input block).
- **Part 3 (Data & Extraction)**:
  - *Proxy report*: `memory`, `payload`, `classify` (`category`, `categoryEnabled`, `foldMode`, `reason`, `evidence`).
  - *DOM report (`extracted` 已過濾結構化資料)*: `urls` (streamlined to `synthesized` permalink when constructible and `primary` clean URL; redundant raw/timestamp/profile URLs pruned), `actor`, `group`, `title`, `snippet`, `media`, `reshare`, `suggested` (metrics omitted for maximum conciseness).
- **Part 4 (Diagnostics & Debug)**:
  - *Proxy report*: `signals`, `recordKeys`, `relayReads` (exact paths read and non-null values returned).
  - *DOM Popup*: Displays Author, Title, Snippet, Media, and a directly clickable `Link` hyperlink pointing to `synthesized` (or `primary`), opening in a new tab.

Use it to diagnose missed folds (`classify.category: null` — check `reason`) and wrong folds
(`reason` maps back to the rule table in [STRATEGY.md](../STRATEGY.md) §3).

### Options Appearance Settings

The Options page includes an **Appearance Settings** section with a **Defaults** button in its header that restores exactly the five keys below from `FB_DIET_DEFAULTS.SETTINGS` (no confirmation, mirroring the stats Reset button). Rows, in order:
- **Only Fold on the Whitelist** (toggle `restrictFoldScope`, default true): Restricts classification and folding to the allowlist (`/`, `/home.php`, `/search*`, `/marketplace*`) via `FB_DIET_DEFAULTS.isFoldScopeAllowed` — Home, Search and Marketplace only; all other pages render natively with zero counters and log entries, while right-rail ad hiding stays active everywhere and is never counted (STRATEGY.md decision #26).
- **Keep Fold Bar When Expanded** (toggle `alwaysShowFoldBar`, default true): When enabled, unfolded or expanded posts retain a top notice bar for identification and re-folding. When disabled, unfolded posts render completely natively without any injected header bar.
- **Fold Bar Title** (select `showTitleMode`, default `whenFolded`): `Always Show` renders the group, author, and snippet on both folded and expanded bars; `Only When Folded` — the default — shows the full title while the post is folded (a summary of the hidden content) and keeps expanded bars down to the badge and `[-]`; `Always Hide` renders neither. Metadata collection and DOM enrichment follow the per-state value, so expanded bars under `whenFolded` skip that work entirely (STRATEGY.md decisions #27, #28).
- **Minimized Fold Bar** (toggle `minimizedFoldMode`, default false): Switches fold bars between 36px and 18px. When enabled, folded posts and retained notice bars render as an 18px compact bar instead of the 36px title bar. Changes sync immediately to all open Facebook tabs.
- **Enable Feed Probe (Debug)** (toggle `debugProbe`, default false): when enabled, each feed unit displays a 🔍 button that copies its diagnostic JSON and shows classification, enrichment, Relay reads, and fold-scope context in a tooltip. (The former standalone DEBUG card was folded into this section; the in-page JSON analyzer textarea was removed earlier in favor of direct tooltip inspection.)
