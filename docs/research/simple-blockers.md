# Simple Blockers & Anti-Pattern Analysis

- **Projects Analyzed**:
  - `Social Sponsored Ads Blocker` (`v4.0.10`, CRX unpacked)
  - `F.Block Sponsored` (`v4.5.0`, CRX unpacked `4.5.0_0`)

---

## 1. Case Study A: `Social Sponsored Ads Blocker` (v4.0.10)

This project represents a minimal, 70-line multi-platform script ([removeSponsoredPosts.js](file:///c:/Users/flow/Documents/我的git/Chrome%20extension/ref/Social%20Sponsored%20Ads%20Blocker_4_0_10_0/removeSponsoredPosts.js)) targeting Facebook, Twitter, Reddit, and LinkedIn.

### Core Implementation
```javascript
const twitter = 'article, [data-testid="trend"]';
const fb = '[data-pagelet*="FeedUnit"]';
const reddit = '.promotedlink';
const linkedIn = '.feed-shared-update-v3, .feed-shared-update-v2';

const disappearSponsoredPosts = () => {
  const els = document.querySelectorAll([twitter, fb, reddit, linkedIn].join(','));
  for (const el of els) {
    if (el && (el.outerHTML.includes('Promoted') || el.outerHTML.includes('Sponsored') || el.outerHTML.includes('promoted'))) {
      el.remove();
      elemBlockCounter++;
    }
  }
};
```

### Critical Architectural Anti-Patterns & Failure Modes

1. **Catastrophic False Positives via `outerHTML.includes()`**:
   - `outerHTML` contains the **entire** post: author names, article body, attached comments, and media captions.
   - If an organic friend shares an article discussing a sponsored athlete or mentions the word *"sponsored"* anywhere in their text or comments, `el.outerHTML.includes('Sponsored')` evaluates to `true`.
   - Result: Legitimate friend posts are permanently destroyed.

2. **DOM Destruction in Modern Virtual DOM Frameworks (`el.remove()`)**:
   - Facebook Comet uses React 18 Concurrent Mode with virtualized list rendering.
   - When an extension forcefully invokes native `el.remove()`, React's fiber tree loses reference to the mounted DOM node.
   - Upon next state update or scroll reconciliation, React throws unhandled node reference errors (`NotFoundError: Node was not found`), frequently crashing the entire feed into a blank screen.

3. **Total Inefficacy Against Obfuscation**:
   - Modern ad labels are scrambled into fragmented spans (`<span>S</span><span>p</span>...`) or rendered via SVG `<use>`. A continuous string `'Sponsored'` does not exist in the raw HTML markup, allowing modern ads to bypass detection entirely.

---

## 2. Case Study B: `F.Block Sponsored` (v4.5.0)

A dedicated Facebook ad blocker relying on an extensive internationalization dictionary ([_locales](file:///c:/Users/flow/Documents/我的git/Chrome%20extension/ref/f.block%20sponsored/4.5.0_0/_locales)) and dual-strategy DOM scanning.

### Core Implementation
1. **Multilingual Dictionary (80+ Languages)**:
   Maintains a static array of translated tokens (from *"Sponsored"*, *"Publicidad"*, *"Gesponsert"* to *"贊助"*, *"مُموَّل"*).
2. **Hybrid Label Inspection**:
   - Checks SVG `<use>` elements: follows `xlink:href` to resolve symbol text content.
   - Resolves Flexbox `order` on split spans: collects nodes where `computedStyle.top === 0`, maps character by `computedStyle.order`, and joins clean characters.
3. **Burst Polling Loop**:
   Executes a burst timer every 300ms (up to 15 times) after scroll and navigation events (`history.pushState`) to catch asynchronous DOM insertions.
4. **Time-Saved Telemetry**:
   Calculates estimated minutes saved based on total blocked count (`Math.round(3 * count / 60)`) and renders milestone notifications.

### Trade-offs
- **Strengths**: Comprehensive language support; handles basic SVG and Flex `order` permutations.
- **Weaknesses**: The 300ms burst timer causes periodic CPU spikes during fast scrolling; relies on `display: none` without placeholder substitution.
