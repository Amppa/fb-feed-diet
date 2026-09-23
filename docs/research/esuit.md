# Case Study: esuit-suggest-blocker (v2.10.0)

> Reference and benchmark teardown of `esuit-suggest-blocker` v2.10.0.

## 📌 Overview

`esuit-suggest-blocker` is a Chrome extension designed to block Facebook feed suggestions and ads. It pioneered extracting classification signals from Facebook's client-side Relay Store rather than parsing fragile DOM text.

---

## ⚙️ Architecture & Hooking Mechanism

### 1. CSP Relaxation & Relay Store Interception
- **Technique**: Uses MV3 `declarativeNetRequest` to replace Facebook's native `Content-Security-Policy` header with a static hardcoded header containing `'unsafe-eval'`.
- **Injection**: Injects an inline `<script>` into the MAIN world that hooks `window.__d`.
- **Store Capture**: Performs string substitution (`toString().replace(...)`) on the `RelayPublishQueue` module factory, recompiling it via `eval` / `new Function` to capture the Relay Record Store instance into `window.___rs`.
- **Relay Read Helper**: Exposes `window.___sf(id, path)` to traverse records and follow pointers (paths with `^` prefixes).

### 2. Operational Scope
- Only runs when `location.pathname === '/'` (Strictly limited to the homepage). Does not handle search, marketplace, or permalink pages.

---

## 🎯 Feed Classification Logic (`classifyFeedUnit`)

esuit extracts the root Relay unit ID and evaluates a series of short-circuiting `if` branches in the following exact order:

```text
Groups You Might Like  -->  Suggested  -->  Sponsored  -->  Reels / Story Header
```

### Decision Rules Table

| Target Category | Condition / Heuristic | Evaluated Path in Relay Store (`window.___sf`) |
| :--- | :--- | :--- |
| **GROUP_YOU_MIGHT_LIKE** | `unitTypename ∈ ['GroupsYouShouldJoinFeedUnit']` | Direct typename of unit |
| **SUGGESTED** | `subscribe_status === 'CAN_SUBSCRIBE'`<br>or `viewer_forum_join_state === 'CAN_JOIN'` | `^^actors[0].subscribe_status`<br>`^to.viewer_forum_join_state` |
| **SPONSORED** | `sponsored_data.ad_id` exists | `^sponsored_data.ad_id` |
| **REELS** | Nested unit has `showcase_story_type === 'SHOWCASE_SHORT_VIDEO'` | Nested unit path |
| **SUGGESTED** *(Header variant)* | `title.text` exists under `story_header{"location":"homepage_stream"}` | Nested unit `story_header` |

### Non-Feed Component Decoration
Apart from `classifyFeedUnit`, esuit hides or decorates 14 fixed Comet component names via `window.__d` factory wrapping:
- Stories trays (`StoriesTray*.react`, `CometStoriesTray.react`)
- Marketplace side units
- Search ads
- Right rail units

---

## ⚠️ Critical Flaws & Lessons Learned

FB Diet's empirical testing and diagnostic probe logs revealed severe architectural and algorithmic flaws in esuit's approach:

### 1. Stability: White Screens from Hardcoded CSP (Decision #9)
- **Problem**: esuit's `rules.json` completely overwrote Facebook's response CSP with a hardcoded domain whitelist just to inject `'unsafe-eval'`.
- **Failure Mode**: Whenever Facebook introduces or migrates static CDN domains (e.g. `*.fbcdn.net`), browser network requests fail with CSP violations, causing intermittent white screens on page load.
- **FB Diet Solution**: Capture `RelayRecordSourceProxy` using a safe Proxy construct trap in `proxy.js` / `relay.js`—pure object wrapping without `eval`, inline scripts, or CSP modifications.

### 2. False Positives: Contextual Story Header Collision (Decisions #2 & #6)
- **Problem**: esuit checks if `story_header(location:homepage_stream)` has a non-empty `title.text`.
- **Failure Mode**: Facebook uses the **identical** keyed record `client:*:story_header(location:homepage_stream):title` for contextual friend activities (e.g. *"Alice commented on Bob's photo"*).
- **Consequence**: Users' genuine friend interactions are falsely classified as suggestions and collapsed.
- **FB Diet Solution**: Retired the `story_header` heuristic completely (archived in `classify-retired.js`). Rely on relationship state (`CAN_SUBSCRIBE`, `CAN_JOIN`) and unpeeled `action_links`.

### 3. False Positives: Shared Reels (Decision #3)
- **Problem**: Testing for `showcase_story_type === 'SHOWCASE_SHORT_VIDEO'`.
- **Failure Mode**: When a friend shares a video Reel as an attachment in a standard `Story`, the attachment record contains `SHOWCASE_SHORT_VIDEO`.
- **Consequence**: Regular friend posts with shared reels are aggressively hidden.
- **FB Diet Solution**: Only flag reels when the feed unit **itself** has `__typename === 'ShowcaseFeedUnit'`, and explicitly ignore attachments decorated by `CometFeedStoryFBReelsAttachmentStyle.react`.

### 4. Display Mechanism: 1x1 Squash vs Element Zeroing (Decision #5)
- esuit injects a 1x1 invisible container to avoid breaking Facebook's `IntersectionObserver`. FB Diet adopted a similar squash container, but augmented it with non-destructive, reversible two-way toggle bars (`FBDietFold` / `FBDietTitleBar`).
