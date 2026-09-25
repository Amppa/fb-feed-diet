# Feed Classification Strategy & Decision Log (STRATEGY.md)

> This document serves as the single source of truth for FB Diet's feed classification rules, diagnostic signals, architectural trade-offs, and historical decisions. Consult this file before modifying `classify.js` or `fold.js`.

## Table of Contents

- [1. External Reference & Benchmark](#1-external-reference--benchmark)
- [2. Active Classification Rules (`classify.js`)](#2-active-classification-rules-classifyjs)
  - [Production Rules Table](#production-rules-table)
- [3. Decision Log & Architectural Rationale](#3-decision-log--architectural-rationale)
  - [Topic Index](#topic-index)
  - [Decisions Summary (#1 ~ #30)](#decisions-summary-1--30)
- [4. Known Misclassification Pitfalls (False Positives)](#4-known-misclassification-pitfalls-false-positives)
- [5. Diagnostic Runbook & New Rule Workflow](#5-diagnostic-runbook--new-rule-workflow)
  - [Diagnostic Tools](#diagnostic-tools)
  - [5-Step Safe Rule Addition Workflow](#5-step-safe-rule-addition-workflow)

---

## 1. External Reference & Benchmark

FB Diet's classification principles were initially benchmarked against [esuit-suggest-blocker v2.10.0](docs/research/esuit.md). 

Key architectural divergence:
- **Relay Store Access**: esuit relaxes page CSP via `declarativeNetRequest` and rewrites `RelayPublishQueue` source text (`eval`). FB Diet captures the store purely via a `Proxy` construct trap on `RelayRecordSourceProxy` (Decision #4, #9).
- **Scope & Safety**: esuit only functions on the homepage root (`/`) and relies heavily on `story_header`, which causes severe false positives on friend interactions. FB Diet supports multiple surfaces (`/`, `/home.php`, `/search*`, `/marketplace*`), prioritizes relationship state (`CAN_SUBSCRIBE`, `CAN_JOIN`), unpeels React context (`action_links`), and operates non-destructively.

For full teardown, rule breakdown, and vulnerability analysis of external projects, see [docs/research/](docs/research/README.md).

---

## 2. Active Classification Rules (`classify.js`)

FB Diet inspects feed units using unpeeled component props first, falling back to client-side Relay Store records (`safeRelayRead`). Category decisions are resolved strictly in `pickCategory` using a fixed priority:

```text
sponsored  >  suggestedGroup  >  suggested  >  stories  >  reels  >  regular
```

### Production Rules Table

| Category | Trigger Conditions | Source / Paths |
| :--- | :--- | :--- |
| **sponsored** | `sponsored_data.ad_id` exists, or `th_dat_spo` obfuscated record detected | Props / Relay: `^sponsored_data.ad_id`, `feedUnit.th_dat_spo` |
| **suggestedGroup** | Unit typename is `GroupsYouShouldJoinFeedUnit` or `GroupSuggestionsFeedUnit` (horizontal recommendation carousel) | Props / Relay `__typename` |
| **suggested** | 1. `actors[0].subscribe_status === 'CAN_SUBSCRIBE'`<br>2. `to.viewer_forum_join_state === 'CAN_JOIN'` (suggested group post)<br>3. `action_links` contain `SUBSCRIBE` / `FOLLOW` / text `追蹤`<br>4. `action_links` contain `JOIN_GROUP` / text `加入`<br>5. Header/Context contains recommendation title without friend activity signals | Relay `^^actors[0].subscribe_status`<br>Relay `^to.viewer_forum_join_state`<br>Unpeeled props `action_links`<br>Unpeeled props `action_links`<br>Unpeeled props `comet_sections.header` |
| **stories** | Unit itself has `__typename === 'DiscoverFeedUnit'` (in-feed stories tray) | Unit `ownTypename` |
| **reels** | Unit itself has `__typename === 'ShowcaseFeedUnit'` (excludes attachment modules) | Unit `ownTypename` |
| **marketAds / searchingAds** | Component name match (`FEED_UNIT_MODULES`) | Module decoration (`fold.js`) |
| **regular** | No rules matched, but unit has valid ID (`idCount > 0`). Controlled by `foldRegular` | Default bucket |

---

## 3. Decision Log & Architectural Rationale

### Topic Index
- **[Rules & Classification]**: #1, #3, #6, #7, #8, #10, #14, #15, #16, #19
- **[Probe & Diagnostics]**: #11, #13, #20, #21, #30
- **[Core & Interception]**: #4, #5, #9, #24, #26, #28, #29
- **[UI & Appearance Mode]**: #17, #18, #22, #23, #25, #27

### Decisions Summary (#1 ~ #30)

### [Rules] Decision #1: Restrict `subscribe_status` Strictly to `CAN_SUBSCRIBE`
- **Attempted & Rejected**: Expanding suggested criteria to include `CAN_FOLLOW` and `NOT_SUBSCRIBED`.
- **Root Cause**: `NOT_SUBSCRIBED` matches virtually all non-followed authors, including friends commenting on group posts and public posts, causing severe false positives.
- **Rule**: Only `CAN_SUBSCRIBE` indicates an actionable recommendation.

### [Rules] Decision #3: Constrain Reels to Own Typename `ShowcaseFeedUnit`
- **Attempted & Rejected**: Marking units as reels when `showcase_story_type === 'SHOWCASE_SHORT_VIDEO'`.
- **Root Cause**: Friend posts resharing a reel contain this field inside attachment records.
- **Rule**: Only evaluate unit's own `__typename === 'ShowcaseFeedUnit'`. Ignore when context module is `CometFeedStoryFBReelsAttachmentStyle.react`.

### [Core] Decision #4: Relay Store Interception via Proxy Construct Trap
- Wrapped `RelayRecordSourceProxy` constructor via Proxy construct trap to capture the active store in `window.FBDietRelay`. Operates without eval, dynamic code compilation, or CSP compromises.

### [Core] Decision #5: Squash Container (1x1) vs Element Destruction
- Uses `1x1` overflow-hidden squash wrapper + reversible placeholder notice bar (`FBDietFold`). Preserves React DOM nodes, preventing `IntersectionObserver` crashes and video player disconnections.

### [Rules] Decision #6: Complete Retirement of `story_header` Rules
- *(Supersedes earlier Decision #2)*: Keyed probe logs revealed contextual friend stories (e.g. *"Alice commented on Bob's photo"*) share the exact same record: `client:*:story_header(location:homepage_stream):title`. String matching is unreliable across locales.
- **Rule**: `story_header` is completely retired as a classification signal (historical analysis preserved in `docs/research/esuit.md`).

### [Rules] Decision #7: In-Feed Stories Tray `DiscoverFeedUnit`
- **Symptom**: Stories carousels at feed position 9–10 bypassed decoration because they were wrapped in generic `CometFeedUnitErrorBoundary.react`.
- **Rule**: `ownTypename === 'DiscoverFeedUnit'` maps to `stories`, prioritized between `suggested` and `reels`.

### [Rules] Decision #8: Two-Tier Architecture (Categories to User Groups)
- Consolidated 7 internal categories into 5 user-facing groups:
  - `ads`: sponsored, marketAds, searchingAds
  - `regular`: regular (foldable via toggle)
  - `suggested`: suggested
  - `media`: reels, stories
  - `other`: suggestedGroup

### [Core] Decision #9: Elimination of CSP Overrides & String Hook
- Removed declarativeNetRequest CSP overrides (`rules.json`) and inline string rewriting of `RelayPublishQueue`. Solved intermittent page loading failures and white screens caused by Facebook CDN domain rotations.

### [Rules] Decision #10: CAN_JOIN Posts to Suggested; Carousel to suggestedGroup
- Recommendation posts with `viewer_forum_join_state === 'CAN_JOIN'` belong to `suggested` (Facebook suggestions). Only horizontal carousel units (`GroupsYouShouldJoinFeedUnit`) map to `suggestedGroup`.

### [Probe] Decision #11 & #13: Probe Redesign (v2 Streamlined Diagnostics)
- Stripped bloated query variables, internal memo fragments, and opaque Relay mutators from probe JSON dumps. Retained concise evidence: `classify` verdict, `enrichment` (author, group, snippet, permalinks), `relayReads`, and top-level `recordKeys`.

### [Rules] Decision #14: Action Links & Recommendation Header Signals
- During initial feed scroll when the Relay store is uninitialized (`isReady() === false`), unpeeled props provide robust signals:
  - `action_links` with `SUBSCRIBE`/`FOLLOW` or `JOIN_GROUP` -> `suggested`.
  - Header text matching "Suggested for you" without friend interaction context -> `suggested`.

### [Rules] Decision #15: React Tree Context Provider Unpeeling
- Comet wraps feed unit props in deeply nested Context Providers (`childrenKeys: ["value", "children"]`). Implemented `extractCandidateRecords` in `classify.js` and `metadata.js` to traverse candidate records and extract author info and action links.

### [Rules] Decision #16: Make Regular Posts Foldable
- Added `CATEGORY.REGULAR = 'regular'` and `foldRegular` setting (default `false`), allowing users to fold normal posts while maintaining distinct counts.

### [UI] Decision #17: Comprehensive Feed Tagging & Two-Way Folding
- Wrapped all feed units (except isolated right-rail ads) with `FBDietFold`. Supports instant two-way toggle (`[+]` / `[-]`) cached up to 800 items.

### [UI] Decisions #18, #22, #23: Appearance Setting Evolution
- Simplified from complex 3-way segment buttons back to intuitive toggles. Split functionality into dedicated **Fold Appearance Settings**:
  - `alwaysShowFoldBar` (retains header bar on unfolded posts).
  - `minimizedFoldMode` (compact 18px bar vs standard 36px title bar).

### [Rules] Decision #19: `th_dat_spo` Sponsored Signal Detection
- Facebook introduced obfuscated ad markers (`feedUnit.th_dat_spo`). Added direct detection in `classify.js` -> `sponsored` (`reason: 'th_dat_spo'`).

### [Probe] Decisions #20 & #21: Probe v3 Lifecycle Clarification
- Structured probe report into two distinct lifecycle phases:
  - `memory`: Initial render GraphQL/Props/Relay state.
  - `dom`: Live DOM scraping upon clicking 🔍 (author, snippet, group, direct post/ad URLs).

### [UI] Decision #24 & #25: Decouple Title Display (`showFeedTitle`) & Instant Sync
- Background script pushes `PUSH_SETTINGS` to broadcast live visual preference updates across all tabs without reloading.
- Decoupled bar height from text rendering: `showFeedTitle` controls snippet visibility independently of height. Version bumped to `2.0.0`.

### [Core] Decision #26: Scope Restriction (`restrictFoldScope`) & Right-Rail Isolation
- Whitelisted target paths (`/`, `/home.php`, `/search*`, `/marketplace*`) via `isFoldScopeAllowed(pathname)`. Outside the whitelist, feed units render natively with zero overhead.
- Right-rail ads are permanently hidden but strictly excluded from filter counters.

### [UI] Decision #27: Tri-State Title Mode (`showTitleMode`) & Whitelist UI
- Replaced boolean `showFeedTitle` with `showTitleMode` (`'always'`, `'whenFolded'`, `'never'`, default `'whenFolded'`).
- Consolidated settings into a unified Appearance section with a dedicated Defaults reset button. Bumped version to `2.1.0`.

### [Core] Decision #28: Legacy Compatibility Purge in the Fold Engine
- Retired the duplicated compatibility tables inside `classify.js` / `fold.js`: fold modes are normalized only by `FB_DIET_DEFAULTS.normalizeFoldMode` (a missing schema fails closed to `off`), and the fold bar title reads `showTitleMode` alone — `showFeedTitle` is ignored and the dead `alwaysShowFoldTitle` key is gone.
- `window.FBDietFold` no longer re-exports `FBDietUI` / `FBDietProbe` members (`GROUP_META`, `GROUP_BY_CATEGORY`, `groupOf`, `FBDietBar`, `FBDietTitleBar`, `buildUnitProbeReport`); consumers read those modules directly.
- `classifyProbeReport` snapshot reading only resolves the snapshot's own plain fields (linked records keep resolving to `null`), and every evidence reader walks one flattened, duplicate-free prop source list.
- Rollback note: no stored setting is invalidated. The Options page writes `showTitleMode` / `alwaysShowFoldBar`, so a stale `showFeedTitle` value is simply no longer read (no migration needed).

### [Core] Decision #29: Proxy Module Drift Watchdog
- `proxy.js` records module health while decorating: `stats.dCalls` counts every intercepted `__d` definition call, and `getModuleHealth()` derives per-registration `seen` (the module name appeared), `patched` (its factory was actually wrapped) and `unseen` (never appeared) counters.
- `fold.js` converts those counters into a session verdict in `computeModuleDrift()`: **suspected drift = `dCalls >= DRIFT_MIN_DCALLS` (300) AND `seen === 0` AND Relay ready AND fold scope allowed**. The two extra guards matter: on a non-whitelisted path (`/messages` etc.) folding is expected to be silent, and a Relay store that never became ready means the snapshot is still early rather than stale.
- Checks run at `DRIFT_CHECK_DELAYS = [15000, 45000]` ms after install. A confident verdict logs `[FB Diet][Drift] … FEED_UNIT_MODULES looks stale and folding may be inactive` **once per session and is never debug-gated** — a total folding failure must be visible without `?fb_diet_debug=1`.
- Read-only inspection: `FBDietFold.checkModuleDrift()` / `FBDietFold.getStatus().drift`, raw counters via `FBDietProxy.getModuleHealth()`.
- Scope: detection only. The watchdog never rewrites `FEED_UNIT_MODULES` or falls back to ad-hoc selectors; a stale table still requires a source fix plus a new decision entry here.

### [Probe] Decision #30: DOM Fallback & Probe Hardening
Three DOM-side false-positive sources were closed without removing the underlying fallbacks (commits 69bc9bf, 4df6f7a, 9aa953c):

- **Ad-link matching (`detector.js`)**: the fallback no longer matches the bare substrings `/ads/` and `ad_id`. Organic permalinks carry `thread_id` / `load_id`, which contain `ad_id`, and any external site's `/ads/about` page matched as well — both folded real posts. A link must now either pass `AD_LINK_HREF_RE` (an `/ads/` path segment on facebook.com or relative) or carry `ad_id` as an actual query parameter (`/[?&]ad_id=/`).
- **Permalink synthesis (`ui.js`)**: a post URL is only synthesized from a Relay-supplied id (`relayPostIdHint`: `post_id`, `clip_id`, `story.post_id`, `mf_story_key`) matching `/^[A-Za-z0-9_-]{4,}$/`; ids are never parsed out of DOM text. The host must be proven: an explicit group id, an author link of the form `/groups/<gid>/user/<uid>` (`authorIdentityFromProfileUrl`), or a `/groups/…` page path yield `/groups/<gid>/permalink/<id>/`; otherwise a non-reserved vanity handle is required for `/<handle>/posts/<id>`. A stray group link inside the unit is no longer sufficient — the old `groupUrl` synthesis fallback is retired (`groupUrl` survives as report-only evidence) — so a group *mention* in a post body cannot turn a personal permalink into a group permalink.
- **Reshare source detection (`ui.js`)**: `extractReshareFromDom` applies a structural pre-filter before comparing author names. Candidates come from `[role="article"]`, `blockquote`, `div[class*="quote"]`; the container itself, anything inside the probe UI or the comment section, and anything equal to / containing / contained by the unit's own `header` are skipped. Only then must the inner author differ from the main author — so a commenter's name or the sharer's own header can no longer be reported as the reshared original.

---

## 4. Known Misclassification Pitfalls (False Positives)

| # | Symptom | Trigger / Root Cause | Resolution |
| :--- | :--- | :--- | :--- |
| **1** | Friend comment response on an image misclassified as `suggested` | `story_header:header` fallback or `subscribe_status: NOT_SUBSCRIBED` | Decisions #1, #6 (retired `story_header`, restricted to `CAN_SUBSCRIBE`) |
| **2** | Friend comment in a public group misclassified as `suggested` | Unsubscribed author matched `NOT_SUBSCRIBED` | Decisions #1, #6 |
| **3** | Friend resharing a Reel misclassified as `reels` | Nested attachment record had `ShowcaseFeedUnit` / `SHOWCASE_SHORT_VIDEO` | Decision #3 (unit's own typename only) |
| **4** | Contextual friend story misclassified as `suggested` | Identical keyed record `story_header(location:homepage_stream)` shared between suggestions and friend stories | Decision #6 (`story_header` completely retired) |
| **5** | Reshare evidence names a commenter (or the sharer's own header) as the original post | Author-name comparison ran over any nested article/quote subtree, including comment subtrees and the unit header | Decision #30 (structural pre-filter excludes probe UI, comment section and unit header before comparing authors) |

> **Golden Rule**: *Prefer a missed fold over a false positive.* Never loosen relationship status boundaries without multi-scenario verification.

---

## 5. Diagnostic Runbook & New Rule Workflow

### Diagnostic Tools
1. **Persistent Log**: `chrome.storage.local.get('fbDietLog')` (stores last 300 classification events). Access via console: `__fbDietDumpLog()`.
2. **Feed Probe (🔍 Button)**: Enable in Options. Click 🔍 on any post to inspect the floating bubble and copy the probe JSON:
   - Check `classify.category` (`regular` with `no-match` vs `null` with `no-unit-id`).
   - Check `relayReads` and unpeeled candidate records.
3. **Verbose Console**: Append `?fb_diet_debug=1` to any Facebook URL.
4. **Drift Watchdog**: `[FB Diet][Drift] … FEED_UNIT_MODULES looks stale` in the console means no registered module matched after ≥300 intercepted definitions (Relay ready, scope allowed). Confirm with `FBDietFold.getStatus().drift` (`dCalls` / `seen` / `patched`) and `FBDietProxy.getModuleHealth()` (`unseen` lists module names that never appeared) before touching `FEED_UNIT_MODULES`.
5. **Detailed Guide**: Refer to [docs/debugging.md](docs/debugging.md) for full DevTools workflows.

### 5-Step Safe Rule Addition Workflow
1. Extract candidate Relay paths / props fields from `no-match` probe JSON.
2. Verify the candidate signal **does NOT match ordinary friend activity** across diverse scenarios (group posts, photo comments, reshares).
3. Insert into `pickCategory` honoring the priority order: `sponsored > suggestedGroup > suggested > stories > reels`.
4. Add positive and negative regression tests in `tests/classify.test.js`.
5. Append a new decision entry to Section 3 of this document.
