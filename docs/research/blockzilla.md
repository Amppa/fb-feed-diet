# BlockZilla — Architectural Teardown & Reverse Engineering

- **Project**: `BlockZilla` (Homepage: `https://blockzilla.app`)
- **Analyzed Version**: `v2.6.0`
- **Source Artifact**: CRX unpacked distribution (`BlockZilla_2_6_0_0`)

---

## 1. Overview

Teardown and code trace of the Facebook-specific filtering subsystem in **BlockZilla** (`v2.6.0`). BlockZilla is a commercial-grade, multi-site ad-blocker targeting 17 domains via Manifest V3. Its Facebook module (`websites/facebook.com/js/`) represents one of the most sophisticated post-render DOM / XPath reconstruction engines.

---

## 1. Directory & Module Partitioning

```text
websites/facebook.com/
├── css/
└── js/
    ├── common.js                     # Multi-language dictionary (Sponsored, Suggested)
    ├── sponsored_posts.js            # Main home feed ad filter (XPath & SVG reconstruction)
    ├── suggested-for-you.js          # Recommendation and friend suggestion filters
    ├── marketplace-ads.js            # Dedicated Marketplace sponsored item filter
    ├── sponsored-ads-right-panel.js  # Desktop right-rail fixed ad banner filter
    └── referral-id.js                # URL referral and telemetry cleaner
```

---

## 2. Core Algorithm: XPath SVG Symbol Reconstruction ⚡

### Problem
On Chromium, Facebook often draws "Sponsored" as vector graphics rather than text:
```html
<svg class="..."><use xlink:href="#SvgT31"></use></svg>
```
No plaintext string exists in the post; standard `textContent` queries fail.

### BlockZilla Solution

```mermaid
graph TD
    A[DOM Mutation / Scroll] --> B[initSvgTextElementMap<br/>Scan id^='Svg' or id^='gid']
    B --> C[Symbol Map: map['#SvgT31'] = 's']
    C --> D[XPath: //*local-name()='use']
    D --> E[Iterate parentSVG.childNodes<br/>Assemble: content += map[use.href]]
    E --> F{content === keyword?}
    F -->|Match| G[findParentSVGPostElement Traversal]
    G --> H[Flag isSponsored & hideAd]
    F -->|No Match| I[Mark bzParsed to avoid re-scan]
```

#### Step 1: Pre-populate Symbol Map (`initSvgTextElementMap_V3`)
Extracts text cached inside `<symbol id="Svg...">` or `<svg id="gid...">` intended for screen readers:
```javascript
function initSvgTextElementMap_V3() {
    const map = [];
    const elements = document.querySelectorAll('[id^="Svg"]');
    for (let i = 0; i < elements.length; ++i) {
        const el = elements[i];
        let textContent = '';
        if (el.nodeName === 'svg') {
            const sub = el.querySelector('use');
            if (sub && sub.hasAttribute('xlink:href')) {
                const textEl = document.querySelector(sub.getAttribute('xlink:href'));
                if (textEl) textContent = textEl.textContent.trim().toLowerCase();
            }
        } else {
            textContent = el.textContent.trim().toLowerCase();
        }
        if (textContent) map['#' + el.id] = textContent;
    }
    return map;
}
```

#### Step 2: XPath Snapshot Query (`checkSVGs_V3`)
Uses native `document.evaluate` XPath queries for speed:
```javascript
const xpathExpression = '//*[local-name()="use" and starts-with(@xlink:href, "#Svg")]';
const result = document.evaluate(
    xpathExpression,
    document,
    prefix => ({ 'xlink': 'http://www.w3.org/1999/xlink' }[prefix] || null),
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
);
```

#### Step 3: Character Stitching & Post Resolution
Stitches multiple `<use>` elements inside a parent `<svg>` into a coherent keyword:
```javascript
let content = '';
for (let j = 0; j < parentSVG.childNodes.length; ++j) {
    const useElement = parentSVG.childNodes[j];
    const gid = useElement.href.baseVal;
    content += svgTextElementMap[gid];
}
if (keyword === content) {
    const parent = findParentSVGPostElement(parentSVG);
    if (parent) {
        parent.isSponsored = true;
        checkAndHideAd(parent, parentSVG, true);
    }
}
parentSVG.setAttribute('bzParsed', '');
```

---

## 3. Emergency Circuit Breaker (`isEmergencyStopped`)

To protect users against catastrophic false positives if Facebook mutates its markup, BlockZilla implements a fail-safe breaker:

```javascript
function isExeededEmergencyCounter(element) {
    if (element.isSponsored === true) {
        var parentPostElement = findParentPostElement(element);
        if (parentPostElement.previousSibling == previousPostElement) {
            if (++consequentlyCounter === 3) {
                isEmergencyStopped = true; // 3 consecutive posts flagged as ads -> trip circuit!
                return true;
            }
        } else {
            consequentlyCounter = 0;
        }
        previousPostElement = parentPostElement;
    }
    return false;
}
```
**Rationale**: Organic feeds never serve 3 consecutive sponsored ads. If 3 consecutive units match, heuristics have regressed; BlockZilla halts filtering entirely rather than blanking the user's feed.

---

## 4. Anti-Obfuscation Evolution (V1–V6)

`sponsored_posts.js` preserves historical iterations of Facebook ad anti-circumvention:

| Variant | Target Mechanism | Approach |
| :--- | :--- | :--- |
| **V1** | Plain Text | Direct substring match (`getElementsByText`) |
| **V2** | Flexbox Order | Resolves `*[style*="order"]`, filters non-absolute, sorts by computed order |
| **V3** | Split Spans | Filters `textContent.length === 1` non-absolute leaves |
| **V4** | SVG Symbol Map | Resolves `<svg use xlink:href>` against symbol dictionary |
| **V5** | Canvas Ratio | Compares `a[role="link"] canvas` width vs container width |
| **V6** | Letter Subset Matching | Dispersed character match (`isMatch`) ignoring junk whitespace |

---

## 5. Subsystem Details: Marketplace & Right Rail

### Marketplace (`marketplace-ads.js`)
- `hideElementTitle('a[href*="/ads/"]', keyword)`: Catches explicit ad anchor links.
- `findParentElementByHref(element, 'a')`: Traverses `parent.parentNode.parentNode.parentNode` to find the enclosing listing card.

### Right Panel (`sponsored-ads-right-panel.js`)
- Targets `a[href*="l.facebook.com/l.php"]` or elements with `aria-label*="sponsored content"` in `role="complementary"`.

---

## 6. Architecture Evaluation & Trade-offs

### Strengths
- **Resilient to SVG Obfuscation**: The dynamic XPath + symbol dictionary reconstruction bypasses vector-drawn ad label obfuscation where plaintext scanners fail.
- **Fail-Safe Circuit Breaker**: The 3-consecutive-hit heuristic protects users against cascading false positives during unexpected markup shifts.
- **Modular Coverage**: Dedicated modules for Feed, Marketplace, and Right Panel prevent ad-hoc selector sprawl.

### Limitations
- **High DOM Overhead**: Invoking XPath queries and DOM style flushes (`getComputedStyle`) on scroll creates measurable main-thread contention on low-powered devices.
- **Brittle to ID Prefix Rotations**: Hardcoded XPath selectors (`starts-with(@xlink:href, '#Svg')` and `#gid`) break silently when Facebook rotates internal SVG symbol naming conventions.
- **Coarse Removal Mechanics**: Completely hides elements with `display: none` without placeholder substitution, which can trigger scroll-anchoring shifts during virtualized list re-renders.
