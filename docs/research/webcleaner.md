# Web Cleaner — Architectural Teardown & Reverse Engineering

- **Project**: `Web Cleaner`
- **Analyzed Version**: `v8.22.0`
- **Source Artifact**: `webcleaner.user.js` (Violentmonkey / Tampermonkey Userscript)

---

## 1. Overview & Operational Model

`Web Cleaner` is a multi-platform userscript targeting Facebook, YouTube, LinkedIn, and general web browsing.
Unlike browser extensions with isolated content scripts, `Web Cleaner` runs inside userscript manager sandboxes, accessing `unsafeWindow` where available and injecting pure stylesheet rules for visual reflow.

Its Facebook module (`Facebook Clean Feed`, lines 1489–2100) is built around **pure CSS injection, geometric label reconstruction, and single-pass story retirement**.

---

## 2. Core Algorithms & Innovations

### 1. Geometric 2D Coordinate Label De-obfuscation (`paintedLabel`) ⚡
Instead of resolving Flexbox CSS `order` or parsing SVG symbol references, `Web Cleaner` solves scrambled text using **physical rendering geometry (client bounding rects)**:

```javascript
function paintedLabel(el) {
  const pts = [];
  for (const sp of el.querySelectorAll("span")) {
    if (sp.children.length) continue;
    const t = (sp.textContent || "").replace(ZW, "");
    if (t.length !== 1) continue;
    const cs = getComputedStyle(sp);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const rs = sp.getClientRects();
    if (!rs.length || rs[0].width <= 0) continue;
    pts.push({ c: t, x: Math.round(rs[0].left), y: Math.round(rs[0].top) });
  }
  if (pts.length < 2) return "";
  let minY = pts[0].y;
  for (const p of pts) if (p.y < minY) minY = p.y;
  // Group letters sharing the same baseline within 3px, then sort left-to-right by X coordinate
  const line = pts.filter((p) => Math.abs(p.y - minY) <= 3).sort((a, b) => a.x - b.x);
  const seen = new Set(), keep = [];
  for (const p of line) {
    if (seen.has(p.x)) continue;
    seen.add(p.x);
    keep.push(p.c);
  }
  return keep.join("").trim();
}
```
- **Why this is significant**: Regardless of how Facebook scrambles DOM hierarchy (whether through flexbox `order`, inline-block offsets, or absolute positioning tricks), characters that form a word on the user's screen **must align along a horizontal baseline and increase from left to right**. Sorting by `(x, y)` completely bypasses DOM tree obfuscation.

### 2. Elimination of `feedBox` Heuristics (v8.19.0 Evolution)
Earlier versions attempted to discover the feed container by finding a `div` with the highest number of child cards (`feedBox()`).
- **Failure Mode**: On live Facebook Comet markup, `feedBox` frequently anchored to an unrelated 4-child wrapper, completely missing stories streaming elsewhere.
- **Evolution**: v8.19.0 eliminated container guessing for ad matching. Ad retirement now operates on a **direct label-to-story climb** (`storyOf`):
  ```javascript
  function storyOf(el, main) {
    const r = el.getBoundingClientRect();
    let n = el;
    for (let i = 0; i < 18 && n.parentElement; i++) {
      n = n.parentElement;
      if (n === main || n === document.body) break;
      const rr = n.getBoundingClientRect();
      if (rr.width >= 400 && rr.height >= 150 && r.top - rr.top <= 160) return n;
    }
    return null;
  }
  ```

### 3. Layout Width Compensation (1100px Feed Widen)
Hiding the left navigation and right sponsored sidebar frees up roughly half of a desktop viewport. `Web Cleaner` dynamically injects reflow rules to prevent awkward whitespace:
```css
html.fcf-s [role="main"] {
  max-width: none !important;
  width: 100% !important;
  margin: 0 auto !important;
}
html.fcf-s [data-fcf-feed] {
  width: min(1100px, 97vw) !important;
  max-width: none !important;
  margin: 0 auto !important;
}
```

### 4. Stateful Feed Column Suppression (`hideFeed`)
Provides an opt-in toggle to hide the entire feed column while leaving Messenger, Groups, and Profiles accessible.
Because a `display: none` container measures 0x0 and loses bounding dimensions, standard detectors would cascade down the page hiding adjacent containers. `Web Cleaner` uses a dedicated stateful controller (`feedHider`) that latches onto the feed node across SPA re-renders and releases only upon route change.

---

## 3. Architecture Evaluation & Trade-offs

### Strengths
- **Immune to CSS Layout Tricks**: Reconstructing strings via physical pixel positions (`getClientRects()`) renders flexbox `order` and CSS decoy shifts completely ineffective.
- **Pure CSS Non-Destructive Hiding**: Units are tagged with attributes (`data-fcf`) and hidden via stylesheet; toggling off instantly restores the original feed without page reloads.
- **Desktop & Mobile Responsive Unification**: Inspects actual markup characteristics rather than relying on `m.facebook.com` hostname checks.

### Limitations
- **Reflow Triggers on Coordinate Lookups**: `getClientRects()` forces layout reflows; bounding-box checks must be gated by viewport bounds (`innerHeight ± 400px`) to prevent scroll jank.
- **Userscript Scope Restrictions**: Sandboxed userscript managers require targeting `unsafeWindow` to hook native endpoints; on strict Content Security Policy (CSP) sites with Trusted Types, custom control panels can fail to mount.
