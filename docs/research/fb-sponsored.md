# F.B. Sponsored/Ad Post Blocker — Reverse Engineering & Battle Lessons

- **Project**: `F.B. Sponsored/Ad Post Blocker`
- **Analyzed Version**: `v1.1.76`
- **Source Artifact**: GitHub repository (`fb-sponsored-ad-post-blocker-main`) / AMO & Web Store

---

## 1. Overview & Core Philosophy

- **Platform Target**: MV3 Firefox and Chromium browsers from a single source tree.
- **Key Artifacts**:
  - `content.js` (~2,250 lines of optimized filtering logic)
  - `DESKTOP-AD-LABELS.md` (author's field journal detailing failed/successful ad heuristics)
- **Design Philosophy**:
  Rejects reliance on unstable class names; relies strictly on computed layout geometry (`order`), SVG references, and ARIA tree semantics.

---

## 2. Core Algorithm: Flexbox Order Reconstruction & Decoy Partitioning ⚡

### Obfuscation Mechanics
Facebook scrambles "Sponsored" labels by:
1. **Single-character leaf spans** with interleaved zero-width Unicode joiners (`INVISIBLE_CHARS_RE`).
2. **Decoy character injection**: Random non-rendering spans placed throughout the subtree.
3. **Flexbox CSS `order` shuffling**: Spans are in arbitrary DOM order and rendered correctly via visual flexbox `order`.

### Step 1: Pre-flight Guard to Prevent Main Thread Stalls (`isCharacterSplit`)
Calling `getComputedStyle()` indiscriminately forces style recalculation across thousands of nodes, causing severe UI lag. `isCharacterSplit()` acts as an O(1) gate:
```javascript
const MIN_SCRAMBLED_LABEL_CHILDREN = 4;
const MAX_SCRAMBLED_LABEL_CHILDREN = 120;

function isCharacterSplit(el) {
  const children = el.children;
  if (children.length < MIN_SCRAMBLED_LABEL_CHILDREN || children.length > MAX_SCRAMBLED_LABEL_CHILDREN) return false;
  for (const child of children) {
    // Must be leaf spans with at most 1 visible character
    if (child.tagName !== "SPAN" || child.children.length !== 0) return false;
    if (child.textContent.replace(INVISIBLE_CHARS_RE, "").length > 1) return false;
  }
  return true; // Rejects 99.9% of normal elements without resolving styles
}
```

### Step 2: Sorting by Visual Sequence (`collectOrderedLeaves`)
```javascript
function collectOrderedLeaves(node, depth = 0) {
  if (depth > MAX_LABEL_DEPTH) return []; // Capped at depth 4
  const withOrder = Array.from(node.childNodes).map((child, index) => {
    let order = index;
    let hidden = false;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const computed = getComputedStyle(child);
      const parsed = parseInt(computed.order, 10);
      if (!Number.isNaN(parsed)) order = parsed;
      hidden = computed.display === "none" || computed.visibility === "hidden";
    }
    return { child, order, hidden };
  });
  withOrder.sort((a, b) => a.order - b.order);
  // Collect leaves and record classList.length
}
```

### Step 3: Decoy Class-Count Partitioning (`labelVariants`)
Facebook differentiates real characters from decoys via class count, but the direction frequently flips (e.g. 22 classes vs 7 classes). Rather than betting on direction, `labelVariants` evaluates three partitions:
```javascript
function labelVariants(el) {
  const leaves = collectOrderedLeaves(el);
  const assemble = (keep) =>
    leaves
      .filter((leaf) => leaf.classCount === null || keep(leaf.classCount))
      .map((leaf) => leaf.text)
      .join("")
      .replace(INVISIBLE_CHARS_RE, "")
      .trim();

  return [
    assemble(() => true),                                  // All leaves
    assemble((n) => n > HONEYPOT_LEAF_CLASS_COUNT),         // High-class-count leaves only
    assemble((n) => n <= HONEYPOT_LEAF_CLASS_COUNT),        // Low-class-count leaves only
  ];
}
```

---

## 3. Critical Failure Modes & False Positive Lessons (`DESKTOP-AD-LABELS.md`)

### Pitfall 1: `data-ad-rendering-role` is Poisonous
- Many ad cards carry `data-ad-rendering-role="profile_name,story_message,title"`.
- **Reality**: Organic group posts and marketplace items share the same Comet story rendering template and also carry these roles. Keying off this attribute hides entire organic feeds.

### Pitfall 2: Nested Follow Buttons in Reshared Content (`isAuthorLevelLabel`)
- When a group member shares a post from an unfollowed public page, the embedded quote contains a "Follow" button.
- Gating on any Follow button in the card incorrectly hides legitimate group posts.
- **Fix**: Require the Follow button to reside in the **primary author heading** of the top card; ignore nested quotes.

### Pitfall 3: The Danger of Short "Ad" Substrings
Facebook often rolls "Sponsored" to "Ad". Using simple substring matching causes false positives on names like "Brad" or text like "Address". Short keywords must require exact full-string equality.

### Pitfall 4: Permalink Veto and `/stories/<id>/` Traps
- Legitimate organic posts link to themselves via canonical permalinks (`/posts/`, `/commerce/listing/`). Ads link outward or lack a permalink.
- **Trap**: `/stories/<id>/` looks like an organic self-link, but ads utilize it too. Treating `/stories/` as an organic whitelist immunizes ads.

---

## 4. Architecture Evaluation & Trade-offs

### Strengths
- **Empirically Proven Obfuscation Immunity**: Flexbox `order` sorting plus ternary decoy partitioning bypasses arbitrary character scrambling.
- **Robust Heading Boundaries**: Restricting follow/join signals to top-level author headers eliminates reshare false positives.
- **Micro-optimized Layout Scanning**: Coalescing queries via `requestAnimationFrame` and checking `isCharacterSplit` prevents frame drops during continuous scrolling.

### Limitations
- **React Suspense Race Conditions**: Delayed rendering requires maintaining a timer-based `pendingLabels` retry queue (polling every 50ms up to 8s), consuming background CPU.
- **DOM Coupling**: When Facebook migrates ad markup from scrambled spans to shadow DOM or canvas, the DOM scanner requires manual heuristic updates.
