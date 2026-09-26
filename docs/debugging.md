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

### Feed Probe Button (per-unit lifecycle diagnostics, Probe v4)

Enable "Show Feed Probe Buttons" in the Options page (or open Facebook with `?fb_diet_debug=1`).
Every unit flowing through `FBDietFold` displays a single 🔍 diagnostic button on its top-left side.
Clicking it copies one unified lifecycle JSON report to the clipboard and opens a floating popup (click outside to dismiss) with the verdict header (Mode/Filter, Category, Signal, Source, Scope) plus the DOM-phase rows (author/group, title, snippet, media and a directly clickable `Link` hyperlink opening in a new tab).

#### Probe Schema (Version 4)
The probe diagnostic schema uses an independent `schemaVersion` (4) that describes the **report shape**, while `env.extVersion` records the **release build** that produced it. The two change at different rates — one release has already carried several schema revisions — so keep both: `schemaVersion` tells a reader how to parse the keys, `env.extVersion` tells which rule table produced the verdict (STRATEGY.md decision #31).
- **Contract**: `schemaVersion` (4) is always the very first key.
- **Part 1 (`env`) — what produced this report**: `extVersion` (release build), `dietMode` (`lite` | `full`), `lang` (the page's `<html lang>`, since keyword-based rules are locale-sensitive), `probed` (click time, when every live value below was collected).
- **Part 2 (`unit`) — which unit this is**: `unitId`, `postId`, `moduleName`, `feedPosition`. `unitId` is the Relay record key (`ids[0]` of the unit) and the only place the complete id appears: paste it into `FBDietRelay.describe('<unitId>')` to dump the record. `postId` comes from `feedUnit.post_id`/`clip_id`/… and serves the permalink; a missing `unitId` (with `verdict.reason: 'no-unit-id'`) means the classifier could not anchor the unit at all — the most common cause of a unit never being folded. Note the persistent `fbDietLog` stores only a truncated id (`…` + last 10 chars), so match it by suffix.
- **Part 3 (`verdict`) — what was decided**: `category`, `reason`, `settingKey`, `foldMode`, plus the nested `scope` (`restricted`, `allowed`, `path`) that conditioned the verdict (decision #26). This is the post-reconciliation result; compare it with `proxy.initialClassify` to see whether live DOM changed the outcome.
- **Part 4 (lifecycle phases)**:
  - *`proxy` — render-time memory input (Props/Relay)*: `renderedAt` (when the unit rendered and its props snapshot was captured; `probed - renderedAt` is how long the unit has been mounted), `initialClassify` (pre-DOM verdict: `category`, `signal`, `unitTypename`, `reason`, `evidence`), `entryCategory`, `relay` (`isReady`, `sourceCount`, `reads`, `recordKeys`), `enrichment`, `payload` (post id, `debug_info`, key lists), `signals`, `moduleHealth` (drift watchdog snapshot). Caveat: `relay.isReady`/`sourceCount`/`lastError` and `moduleHealth` are session-level live values read at `probed`, not render-time data.
  - *`dom` — live mounted-DOM extraction at click time*: `urls` (streamlined to `primary` clean URL and `synthesized` permalink; redundant raw/timestamp/profile URLs pruned), `extracted` (`actor`, `group`, `title`, `snippet`, `media`, `reshare`, `suggested` with its `debug`).
- Nesting never exceeds two levels, and null/empty members are omitted throughout, so every present key carries information.

Use it to diagnose missed folds (`verdict.category: 'regular'` with `no-match` — compare `proxy.initialClassify` against `verdict` to spot DOM reconciliation) and wrong folds
(`verdict.reason` maps back to the rule table in [STRATEGY.md](../STRATEGY.md) §3).

### Options Appearance Settings

The Options page includes an **Appearance Settings** section with a **Defaults** button in its header that restores exactly the five keys below from `FB_DIET_DEFAULTS.SETTINGS` (no confirmation, mirroring the stats Reset button). Rows, in order:
- **Only Fold on the Whitelist** (toggle `restrictFoldScope`, default true): Restricts classification and folding to the allowlist (`/`, `/home.php`, `/search*`, `/marketplace*`) via `FB_DIET_DEFAULTS.isFoldScopeAllowed` — Home, Search and Marketplace only; all other pages render natively with zero counters and log entries, while right-rail ad hiding stays active everywhere and is never counted (STRATEGY.md decision #26).
- **Keep Fold Bar When Expanded** (toggle `alwaysShowFoldBar`, default true): When enabled, unfolded or expanded posts retain a top notice bar for identification and re-folding. When disabled, unfolded posts render completely natively without any injected header bar.
- **Fold Bar Title** (select `showTitleMode`, default `whenFolded`): `Always Show` renders the group, author, and snippet on both folded and expanded bars; `Only When Folded` — the default — shows the full title while the post is folded (a summary of the hidden content) and keeps expanded bars down to the badge and `[-]`; `Always Hide` renders neither. Metadata collection and DOM enrichment follow the per-state value, so expanded bars under `whenFolded` skip that work entirely (STRATEGY.md decisions #27, #28).
- **Minimized Fold Bar** (toggle `minimizedFoldMode`, default false): Switches fold bars between 36px and 18px. When enabled, folded posts and retained notice bars render as an 18px compact bar instead of the 36px title bar. Changes sync immediately to all open Facebook tabs.
- **Enable Feed Probe (Debug)** (toggle `debugProbe`, default false): when enabled, each feed unit displays a 🔍 button that copies its diagnostic JSON and shows classification, enrichment, Relay reads, and fold-scope context in a tooltip. (The former standalone DEBUG card was folded into this section; the in-page JSON analyzer textarea was removed earlier in favor of direct tooltip inspection.)
