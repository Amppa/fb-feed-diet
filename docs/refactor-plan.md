# Refactoring Plan & Status

Authoritative tracker for the architectural cleanup round that began 2026-09-26.
Every claim below was verified against the code at the time of writing; where a plan
item was rejected during verification, the reason is recorded instead of silently dropped.

Branch: `refactor/architecture-cleanup` (merge into `master` is a human decision).

## Status

| Phase | Scope | State |
| :-- | :-- | :-- |
| 1 | Retire the ISOLATED-world DOM fallback engine | Done — STRATEGY.md #32 |
| 2 | Single-path settings synchronization | Done — STRATEGY.md #33 |
| 3 | Ghost code, dead exports, duplicate packager | Done |
| 4 | SSOT vocabulary and helper consolidation | Partially done — 2 of 4 items |
| 5 | Test infrastructure hardening | Mostly done — 1 item rejected on evidence |
| 6 | Oversized-function decomposition | Done — see below |
| 7 | Drop unconsumed DOM probe producers (metrics, text candidates) | Done — see below |
| Docs | STRATEGY.md, architecture.md, debugging.md, DEVELOPMENT.md, workflow.md | Done |

## Phase 4 outcome

**Done**
- `readProp`: classify.js and metadata.js held byte-identical copies; defaults.js now owns
  the single implementation. classify.js delegates and fails closed to `regular` when the
  shared module is absent, matching its existing no-schema posture.
- `RESERVED_PROFILE_SEGMENTS`: ui.js (18 entries) and metadata.js (9) had drifted apart on
  the same question — "is this first path segment a Facebook route rather than a vanity
  handle?". The shared table lives in defaults.js; metadata.js also lowercases its input
  like ui.js does, so `/photos`, `/hashtag`, `/media` and friends can no longer surface as
  an author name (the rule decision #30 already requires before synthesizing a permalink).

**Rejected after verification — do not retry without new evidence**
- *Privacy / audience keyword merge* (`ui.js` `UI_KEYWORDS` + `dom-suggested.js`
  `PRIVACY_OR_TIME_LABELS`): the matching rules are opposite. dom-suggested.js tests
  `aria.indexOf(label) !== -1` (substring containment against an aria-label), while ui.js
  compares whole strings case-insensitively. A single shared list would either start
  discarding real author names whose text merely contains a label, or stop filtering UI
  chrome and re-open a suggested-detection false-positive path. defaults.js states this
  boundary directly ("Keep context-specific lists separate: their matching rules are not
  interchangeable").
- *Badge CSS token extraction* (`content.css` vs `theme.css`): the two stylesheets serve
  different documents (injected into facebook.com vs the options/popup pages) and cannot
  share custom properties, so nothing is deduplicated; only literal values could be
  aligned, which is a design-taste change rather than a structural one.

## Phase 5 outcome

**Done**
- Two `.every()` assertions that passed vacuously on empty collections now require a
  non-empty subject first (`dom-metadata.test.js`, `classify.test.js`).
- `tests/harness.js`: removed the never-exported `INJECT_ORDER` constant.
- `makeNode`: `dom-metadata.test.js` held a strict subset of the harness node double and
  now imports it (-65 lines, 81 assertions unchanged).

**Rejected after verification**
- *Consolidating `suggested-dom.test.js`'s `makeNode`*: it is not a weaker duplicate. Its
  `matches(sel)` / `querySelectorAll` resolve space-separated descendant chains, which the
  harness double does not support. Swapping it would silently change which nodes selectors
  match; merging requires first teaching the harness that dialect and re-validating every
  assertion, which is new test infrastructure rather than cleanup.

## Phase 6: oversized-function decomposition (`refactor/decomposition`)

Follow-up round after the cleanup above, targeting comprehension hotspots instead of file
count. Verified with byte-identical golden snapshots (14 fold scenarios incl. counters and
`postMessage` reports, 4 metadata enrichment cases, 4 suggested-detection cards) plus the
full suite.

| Function | Before | After | Extracted |
| :-- | :-- | :-- | :-- |
| `fold.js FBDietFold` | 230 | 165 | `isFoldScopeBlocked`, `resolveVerdict`, `verdictReport` (the counter payload was previously spelled out three times) |
| `metadata.js collect` | 264 | 78 | `collectActor`, `collectGroup`, `collectContent` |
| `dom-suggested.js detectSuggestedFromDom` | 232 | 29 | `scanAriaKeywords`, `resolveHeaderScope`, `scanHeaderScope`, `scanAuthorZone`, `classifyExtraButton`, `scanPreMessageLabels` |

React hooks stayed inside `FBDietFold`; the suggested scans keep the first-hit-wins
precedence and the shared debug log. Nothing new is exported to `window`.

**Deliberately not done**
- `probe.js buildProbeReport` (145 lines): already fronted by `collectProbeContext`, and the
  remaining body is one linear report assembly.
- Splitting `ui.js` into `dom-metadata.js` + `ui.js`: the seam exists (two globals, disjoint
  consumers) but the gain is file-count optics while the cost is a permanent extra manifest
  order and four extra test loaders. Revisit when the extractor cluster gains a second
  consumer or has to dispatch per surface (group / page / reels).

## Phase 7: drop the unconsumed DOM probe producers (`chore/drop-unconsumed-dom-probes`)

`ui.js` 1222 → 947 lines by deleting two producers whose only reader was the test suite:

| Removed | Lines | Was produced as |
| :-- | :-- | :-- |
| `parseMetricNumber`, `extractButtonCount`, `extractMetricsFromDom` | 148 | `collect().metrics` |
| `scanTextCandidates`, `isNodeAtOrAfter`, `isBelowContentZone` | 119 | `collect().textCandidates` |

Grep over all of `src/` found zero consumers: the probe report stopped surfacing reaction
counts and text candidates during the schema v2/v3 streamlining (and `probe-css.test.js`
still pins that the popup must not render `Candidates:`), but the producers survived that
decision. 24 test assertions went with the feature — the suite shrank from 81 to 57 checks
in `dom-metadata.test.js` without any assertion being weakened.

Recover from git history if the probe ever needs counts again; the extraction logic is a
single cherry-pick away.

## Phase 8: memory retention fixes (`fix/memory-retention`)

Prompted by a report of Facebook tabs reaching 2-7 GB with the extension enabled.

| Fix | File | Why it mattered |
| :-- | :-- | :-- |
| Keep factory args only for registered/hooked modules | `proxy.js` | `moduleArgs.set()` ran for every module the loader defined, pinning each factory closure and its dependency exports; thousands of modules per session, while only the ~15 registered names are ever read back (`getModuleHealth` iterates `registrations`, `register()` re-applies to a seen module) |
| Cap `stats.patchedModules` at 40 | `proxy.js` | unbounded push, only the first 20 were ever shown |
| FIFO cap 300 on `titleBarCache` | `ui.js` | set-only Map; folded units never unmount, so it grew with every unit scrolled past |
| 4 s hard disconnect + 200 ms coalescing for the title-bar `MutationObserver` | `ui.js` | cleanup only ran on unmount, which never happens for a squashed post; each mutation batch re-triggered a 23-query subtree sweep |
| Commit effect deps `[isHydrated, domSuggested]` -> `[domSuggested]` | `fold.js` | the effect sets `isHydrated`, so every unit built and tore down its suggested-post scanner twice |
| `window.__fbDietHideMode = 'none'` override | `fold.js` | lets the squash-vs-`display:none` media cost be measured on a real page without changing the default |

Not addressed by choice: the squash design itself (it deliberately keeps units visible to
IntersectionObserver to preserve Relay subscriptions), and the 20-deep `lastCmp` walk plus
the 23-query subtree sweep, which are CPU/GC pressure rather than retained memory. Both need
live-page measurement before changing; `docs/debugging.md` §Memory Diagnostics describes the
A/B levers.

Test note: the fake React in `tests/harness.js` ignores dependency arrays, so the commit-effect
fix is verified by inspection rather than assertion; the hide-mode lever is covered
functionally in `fold.test.js`.

## Invariants to preserve

- The MAIN world proxy is the only classification and folding engine. Do not reintroduce a
  DOM fallback; `content.test.js` and `probe-css.test.js` pin the retired symbols and
  class names.
- One settings write triggers one fan-out (`storage.onChanged`). Do not re-add a
  `PUSH_SETTINGS` / `SETTINGS_CHANGED` channel.
- The three background script declarations (`manifest.json` `service_worker` + `scripts`,
  and `importScripts`) are all required for Chrome/Firefox MV3 parity.
- `fold.js` `DOM_SUGGESTED_SCAN_DELAYS` and `ui.js` title-bar snippet ladder govern
  different lifecycle events and stay decoupled.
- `ui.js` stays a single MAIN-world closure; splitting it adds manifest entries and global
  coupling without real isolation.
- `schemaVersion` is 4: the unified-button change and the later field-placement change were
  deliberately folded into one version and one decision entry (#31).
