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
- `scope`: fold-scope context (`restricted` — the `restrictFoldScope` setting, `allowed` — runtime verdict for this path, `path` — `location.pathname`; STRATEGY.md decision #26)
- `payload`: unit position and `feedUnit.post_id` only (redundant `__id` and `__typename` pruned, [STRATEGY.md](../STRATEGY.md) decisions #11/#13)

Use it to diagnose missed folds (`classify.category: null` — check `reason`) and wrong folds
(`reason` maps back to the rule table in [STRATEGY.md](../STRATEGY.md) §3).

### Options Appearance Settings

The Options page includes an **Appearance Settings** section with a **Defaults** button in its header that restores exactly the five keys below from `FB_DIET_DEFAULTS.SETTINGS` (no confirmation, mirroring the stats Reset button). Rows, in order:
- **Only Fold on the Whitelist** (toggle `restrictFoldScope`, default true): Restricts classification and folding to the allowlist (`/`, `/home.php`, `/search*`, `/marketplace*`) via `FB_DIET_DEFAULTS.isFoldScopeAllowed` — Home, Search and Marketplace only; all other pages render natively with zero counters and log entries, while right-rail ad hiding stays active everywhere and is never counted (STRATEGY.md decision #26).
- **Keep Fold Bar When Expanded** (toggle `alwaysShowFoldBar`, default true): When enabled, unfolded or expanded posts retain a top notice bar for identification and re-folding. When disabled, unfolded posts render completely natively without any injected header bar.
- **Fold Bar Title** (select `showTitleMode`, default `whenFolded`): `Always Show` renders the group, author, and snippet on both folded and expanded bars; `Only When Folded` — the default — shows the full title while the post is folded (a summary of the hidden content) and keeps expanded bars down to the badge and `[-]`; `Always Hide` renders neither. Metadata collection and DOM enrichment follow the per-state value, so expanded bars under `whenFolded` skip that work entirely (STRATEGY.md decisions #27, #28).
- **Minimized Fold Bar** (toggle `minimizedFoldMode`, default false): Switches fold bars between 36px and 18px. When enabled, folded posts and retained notice bars render as an 18px compact bar instead of the 36px title bar. Changes sync immediately to all open Facebook tabs.
- **Enable Feed Probe (Debug)** (toggle `debugProbe`, default false): when enabled, each feed unit displays a 🔍 button that copies its diagnostic JSON and shows classification, enrichment, Relay reads, and fold-scope context in a tooltip. (The former standalone DEBUG card was folded into this section; the in-page JSON analyzer textarea was removed earlier in favor of direct tooltip inspection.)
