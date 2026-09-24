# External Projects & Algorithm Research

This directory contains reverse-engineering analyses, architectural teardowns, and algorithm evaluations of external feed-filtering extensions and related open-source projects.

The goal is to benchmark their classification approaches, interception mechanisms, and Relay/GraphQL traversal techniques against **FB Diet**, identify known failure modes, and discover robust signals for content filtering.

---

## 📊 Cross-Project Comparison Matrix

| Project | Target Scope | Interception Hook | Classification Source | Suggested Post Signal | Sponsored Ad Signal | Reels / Stories | Known Pitfalls & Risks |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FB Diet** *(Ours)* | Whitelist (`/`, `/home.php`, `/search*`, `/marketplace*`) | Proxy construct trap on `RelayRecordSourceProxy` + `window.__d` module wrapping | Props unpeeled + Relay store fallback | `subscribe_status === 'CAN_SUBSCRIBE'`, `viewer_forum_join_state === 'CAN_JOIN'`, `action_links` (FOLLOW/JOIN), Header text without friend signals | `sponsored_data.ad_id`, `th_dat_spo` obfuscated record | `ShowcaseFeedUnit` (reels), `DiscoverFeedUnit` (stories tray), Comet module decoration | Relies on React internal context unpeeling if Relay store is idle |
| **[esuit-suggest-blocker](esuit.md)** | Home only (`pathname === '/'`) | CSP relaxation via `declarativeNetRequest` + inline script rewriting `RelayPublishQueue` | Relay store only (`window.___sf`) | `CAN_SUBSCRIBE`, `CAN_JOIN`, `GroupsYouShouldJoinFeedUnit`, keyed `story_header` | `sponsored_data.ad_id` | `showcase_story_type === 'SHOWCASE_SHORT_VIDEO'`, Comet module list (14 components) | Hardcoded CSP breaks page loads when FB CDN domains change; `story_header` and `SHOWCASE_SHORT_VIDEO` cause severe false positives on friend interactions |
| **[BlockZilla](blockzilla.md)** | Full site (Feed, Marketplace, Right Panel, etc.) | DeclarativeNetRequest network rules + Post-render DOM scanning (`div[aria-posinset]:not([bzParsed])`) | XPath over SVG `<use>` + Symbol text map reconstruction | Multi-language string dictionary matching on reconstructed text | XPath on `//*[local-name()='use' and starts-with(@xlink:href, '#Svg')]` matching assembled keyword | Keyword string comparison on title/content | Heavy CPU cost on scroll (XPath + DOM traversals); breaks silently when FB rotates SVG symbol id patterns; relies on `isEmergencyStopped` circuit breaker |
| **[F.B. Sponsored Blocker](fb-sponsored-ad-post-blocker.md)** | Feed and right sidebar | Post-render DOM scanning anchored by `aria-posinset` + `requestAnimationFrame` coalescing | Flexbox `order` sorting + Decoy character partitioning (`labelVariants`) | Leaf Follow/Join buttons restricted to author header (`isAuthorLevelLabel`) | De-scrambled label matches `SPONSORED_TEXTS` or SVG `<use>` symbol reference | Separate Reels container matching | DOM styling flushes if `isCharacterSplit` fails to guard; requires `pendingLabels` retry queue for React Suspense; must avoid `data-ad-rendering-role` |
| **[Feed Filter for FB (fff)](feed-filter-for-facebook.md)** | Feed and right rail | MV3 dual-world (ISOLATED bridge + MAIN core) + Pre-paint CSS `:has()` rules | Privacy Sandbox `attributionsrc` + CTA role + Two-tier `IntersectionObserver` | Regex on suggested labels + Action buttons | `attributionsrc`, `data-ad-rendering-role^="cta"`, `[aria-label*="sponsored content"]` | Reels container query | `:has()` selectors hide elements before React hydration; `data-ad-rendering-role` carries slight false-positive risk on certain organic pages |

---

## 📁 Individual Project Reports

1. **[esuit-suggest-blocker v2.10.0](esuit.md)**: Teardown of the popular MV3 Relay store hook, classification shortcut order, and analysis of its critical false-positive triggers.
2. **[BlockZilla v2.6.0](blockzilla.md)**: Deep teardown of XPath SVG symbol map reconstruction, multi-stage obfuscation heuristics (V1-V6), and the 3-consecutive-hit emergency circuit breaker.
3. **[F.B. Sponsored/Ad Post Blocker](fb-sponsored-ad-post-blocker.md)**: Teardown of Flexbox `order` de-obfuscation, decoy class partitioning, and crucial failure lessons (`data-ad-rendering-role` pitfalls).
4. **[Feed Filter for Facebook (fff)](feed-filter-for-facebook.md)**: Teardown of dual-world architecture, pre-paint CSS guards (`attributionsrc`), two-tier IntersectionObserver, and contacts rail protection.
5. *Project E* (Upcoming)

---

## 🔬 Benchmark Methodology

When evaluating an external project or proposing a new classification heuristic:
1. **Interception Safety**: Does it require dangerous CSP overrides (`unsafe-eval`, custom script domains) or modify source factories dynamically? (See FB Diet STRATEGY.md Decision #9).
2. **False Positive Resistance**: Does it misclassify contextual friend stories (e.g. friend commenting on a photo, friend posting in a group, friend resharing a reel)?
3. **SPA / Virtual Scroll Resilience**: Does it handle infinite scroll, node recycling, and React 18 Concurrent Rendering without leaking memory or throwing hydration errors?
4. **Scope Boundaries**: Can it discriminate between feed stream insertions and legitimate full-page navigation (e.g. browsing a group directly)?
