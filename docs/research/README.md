# External Projects & Algorithm Research

This directory contains reverse-engineering analyses, architectural teardowns, and algorithm evaluations of 8 external feed-filtering extensions and open-source projects.

The goal is to benchmark their classification approaches, interception mechanisms, and layout reconstruction techniques against **FB Feed Diet**, identify known failure modes, and discover robust signals for content filtering.

---

## 📑 Core Synthesis Document

- **[Cross-Project Algorithmic Feasibility Analysis & Synthesis](feasibility-analysis.md)**  
  A centralized evaluation of the four filtering paradigms (Relay Memory Hook, Heuristic DOM Reconstruction, Pre-Paint CSS Masks, Naive Anti-Patterns), comparative algorithmic matrix, and deep dives into SVG symbol stitching, 2D coordinate geometry, emergency circuit breakers, and false-positive prevention.

---

## 📊 Cross-Project Comparison Matrix

| Project | Target Scope | Interception Hook | Classification Source | Suggested Post Signal | Sponsored Ad Signal | Reels / Stories | Known Pitfalls & Risks |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FB Feed Diet** *(Ours)* | Whitelist (`/`, `/home.php`, `/search*`, `/marketplace*`) | Proxy construct trap on `RelayRecordSourceProxy` + `window.__d` module wrapping | Props unpeeled + Relay store fallback | `subscribe_status === 'CAN_SUBSCRIBE'`, `viewer_forum_join_state === 'CAN_JOIN'`, `action_links` (FOLLOW/JOIN), Header text without friend signals | `sponsored_data.ad_id`, `th_dat_spo` obfuscated record | `ShowcaseFeedUnit` (reels), `DiscoverFeedUnit` (stories tray), Comet module decoration | Relies on React internal context unpeeling if Relay store is idle |
| **[esuit-suggest-blocker v2.10.0](esuit.md)** | Home only (`pathname === '/'`) | CSP relaxation via `declarativeNetRequest` + inline script rewriting `RelayPublishQueue` | Relay store only (`window.___sf`) | `CAN_SUBSCRIBE`, `CAN_JOIN`, `GroupsYouShouldJoinFeedUnit`, keyed `story_header` | `sponsored_data.ad_id` | `showcase_story_type === 'SHOWCASE_SHORT_VIDEO'`, Comet module list (14 components) | Hardcoded CSP breaks page loads when FB CDN domains change; `story_header` and `SHOWCASE_SHORT_VIDEO` cause severe false positives on friend interactions |
| **[BlockZilla v2.6.0](blockzilla.md)** | Full site (Feed, Marketplace, Right Panel, etc.) | DeclarativeNetRequest network rules + Post-render DOM scanning (`div[aria-posinset]:not([bzParsed])`) | XPath over SVG `<use>` + Symbol text map reconstruction | Multi-language string dictionary matching on reconstructed text | XPath on `//*[local-name()='use' and starts-with(@xlink:href, '#Svg')]` matching assembled keyword | Keyword string comparison on title/content | Heavy CPU cost on scroll (XPath + DOM traversals); breaks silently when FB rotates SVG symbol id patterns; relies on `isEmergencyStopped` circuit breaker |
| **[F.B. Sponsored Blocker v1.1.76](fb-sponsored.md)** | Feed and right sidebar | Post-render DOM scanning anchored by `aria-posinset` + `requestAnimationFrame` coalescing | Flexbox `order` sorting + Decoy character partitioning (`labelVariants`) | Leaf Follow/Join buttons restricted to author header (`isAuthorLevelLabel`) | De-scrambled label matches `SPONSORED_TEXTS` or SVG `<use>` symbol reference | Separate Reels container matching | DOM styling flushes if `isCharacterSplit` fails to guard; requires `pendingLabels` retry queue for React Suspense; must avoid `data-ad-rendering-role` |
| **[Feed Filter for FB v1.6.2](feed-filter-for-facebook.md)** | Feed and right rail | MV3 dual-world (ISOLATED bridge + MAIN core) + Pre-paint CSS `:has()` rules | Privacy Sandbox `attributionsrc` + CTA role + Two-tier `IntersectionObserver` | Regex on suggested labels + Action buttons | `attributionsrc`, `data-ad-rendering-role^="cta"`, `[aria-label*="sponsored content"]` | Reels container query | `:has()` selectors hide elements before React hydration; `data-ad-rendering-role` carries slight false-positive risk on certain organic pages |
| **[Web Cleaner v8.22.0](webcleaner.md)** | Full site + YouTube / LinkedIn | Userscript (`unsafeWindow`) + Dynamic CSS rules + Coordinate de-obfuscation | Geometric 2D sorting (`getClientRects()`) on character horizontal baseline | Classifies by outer wrapper size / position | String matching on 2D horizontal reconstructed character sequence | Hides reels tray via bounding box | `getClientRects()` forces layout reflows if ungated; userscript sandbox limits native prototype hooking |
| **[Facebook Feed Filter v1.1.0](facebook-feed-filter.md)** | Home feed (`/`) | MV3 ISOLATED world + Pre-paint `:has()` CSS rules + Microtask scheduler | Batched DOM scanning with `WeakSet` deduplication | Ancestor card depth scoring + Keyword regex | Pre-paint CSS attributes (`attributionsrc`, `cta`) + Text match | `[role="region"][aria-label="Reel" i]` | Lacks Flexbox `order` or SVG symbol reconstruction; susceptible to vector-only ad obfuscation |
| **[Simple Blockers](simple-blockers.md)** | Multi-platform / Facebook | Naive `document.querySelectorAll` timer loops | Raw `outerHTML.includes()` or 80-language dictionary | N/A | Substring search on entire container HTML | N/A | Calling `el.remove()` breaks React 18 Virtual DOM causing feed crashes; substring search on `outerHTML` destroys organic posts mentioning keywords |

---

## 📁 Individual Project Reports

1. **[esuit-suggest-blocker v2.10.0](esuit.md)**: Teardown of the popular MV3 Relay store hook, classification shortcut order, and analysis of its critical false-positive triggers.
2. **[BlockZilla v2.6.0](blockzilla.md)**: Deep teardown of XPath SVG symbol map reconstruction, multi-stage obfuscation heuristics (V1-V6), and the 3-consecutive-hit emergency circuit breaker.
3. **[F.B. Sponsored/Ad Post Blocker v1.1.76](fb-sponsored.md)**: Teardown of Flexbox `order` de-obfuscation, ternary decoy class partitioning, and crucial failure lessons (`data-ad-rendering-role` pitfalls).
4. **[Feed Filter for Facebook (fff) v1.6.2](feed-filter-for-facebook.md)**: Teardown of dual-world architecture, pre-paint CSS guards (`attributionsrc`), two-tier IntersectionObserver, and contacts rail protection.
5. **[Web Cleaner v8.22.0](webcleaner.md)**: Teardown of 2D geometric coordinate sorting (`getClientRects()`), direct label-to-story climbing (`storyOf`), and responsive 1100px layout widening.
6. **[Facebook Feed Filter v1.1.0 (Mowd)](facebook-feed-filter.md)**: Teardown of cross-browser MV2/MV3 architecture, microtask mutation scheduling, and non-destructive placeholder insertion.
7. **[Simple Blockers & Anti-Pattern Analysis](simple-blockers.md)**: Teardown of `Social Sponsored Ads Blocker v4.0.10` and `F.Block Sponsored v4.5.0`, detailing why `outerHTML.includes()` and `el.remove()` are catastrophic in React 18.

---

## 🔬 Benchmark Methodology

When evaluating an external project or proposing a new classification heuristic:
1. **Interception Safety**: Does it require dangerous CSP overrides (`unsafe-eval`, custom script domains) or modify source factories dynamically?
2. **False Positive Resistance**: Does it misclassify contextual friend stories (e.g. friend commenting on a photo, friend posting in a group, friend resharing a reel)?
3. **SPA / Virtual Scroll Resilience**: Does it handle infinite scroll, node recycling, and React 18 Concurrent Rendering without leaking memory or throwing hydration errors?
4. **Scope Boundaries**: Can it discriminate between feed stream insertions and legitimate full-page navigation (e.g. browsing a group directly)?
