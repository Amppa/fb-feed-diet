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
