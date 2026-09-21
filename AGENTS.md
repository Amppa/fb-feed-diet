# AGENTS.md — Professional Engineering Discipline & AI Contract

This file serves as the behavioral contract and engineering standard for AI assistants and human developers working on this codebase. It encodes the practices, coding style, and mental model of a senior web extension engineer.

> [!IMPORTANT]
> **Primary Rule for AI Assistants**: Before proposing or implementing code modifications, always review:
> - **[DEVELOPMENT.md](DEVELOPMENT.md)** to understand the project architecture, Relay interception, module breakdown, runtime data flows, debugging consoles, and testing commands.
> - **[STRATEGY.md](STRATEGY.md)** to review the authoritative feed classification rules and historical decision logs before touching `classify.js` or `fold.js`.

---

## 1. Project Onboarding & Alignment Questionnaire

When initiating a new feature or onboarding with a user, the AI assistant must proactively confirm the user's preferences on the following 4 core workflow decisions (or fall back to the sensible defaults):

1. **`README.md` Language**:
   - *Default*: English (standard for open-source / Chrome Web Store).
   - *Question for User*: Would you like `README.md` to remain in English, or be switched to Traditional Chinese (繁體中文) or bilingual?
2. **Testing Mode**:
   - *Default*: Node unit tests (`npm test` / `node tests/run.js`) + manual in-browser verification.
   - *Question for User*: Does this project require automated unit tests, or do you prefer manual testing without browser automation?
3. **Git Commit Workflow**:
   - *Default*: Manual confirmation (AI never commits proactively; wait for user to test and explicitly confirm).
   - *Question for User*: Should git commits be performed automatically after each verified task, or should the AI always wait for your manual testing and approval before committing?
4. **Version Bumping Management**:
   - *Default*: User manual management (or bump upon user request).
   - *Question for User*: Would you like the AI to automatically manage and bump semantic versions in `manifest.json` on releases, or do you prefer manual version control?

---

## 2. Professional Workflow & Git Discipline

- **Git Commit Protocol**:
  - **Never run `git commit` proactively** unless explicitly authorized by the user above. Always wait for explicit user review and confirmation.
  - Read-only git commands (`git status`, `git diff`, `git log`) are allowed at any time.
  - **Commit messages must strictly be in English** (imperative tone, e.g., `fix(classify): refine suggested group join state selector`).
- **Language & Communication**:
  - Planning documents, tasks, and walkthroughs: Traditional Chinese (繁體中文).
  - Code comments and git commit messages: English.
  - User documentation (`README.md`): English by default; strictly use relative links (e.g. `[DEVELOPMENT.md](DEVELOPMENT.md)`), never use absolute paths.
- **Testing Guardrail**:
  - **No automated browser testing**. Do not introduce Puppeteer, Playwright, or browser automation tools. Verify frontend and extension behavior manually or via isolated Node unit tests.

---

## 3. Core Architectural Philosophy

### Simplicity First (Minimum Viable Code)
- Minimum code that solves the problem. Nothing speculative.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- If 50 lines can do the job, never write 200 lines.

### Surgical Changes
- **Touch only what you must.** Do not refactor adjacent code, reformat styling, or tweak unrelated comments.
- Match existing code style perfectly.
- If your change makes something obsolete (e.g. removed a rule or helper), clean up your own mess in the same pass.
- Do not remove pre-existing dead code unless explicitly requested.

### Think Before Coding & Clarification Triggers
- **Never guess or assume silently**. If uncertain, stop and ask.
- **Clarification Triggers (Must STOP and ask before coding)**:
  1. *Multiple architectural paths*: If a feature can be implemented in multiple distinct ways (e.g. DOM hiding vs React wrapping, new toggle vs sub-option), do NOT choose silently. Present Option A and Option B with tradeoffs.
  2. *Breaking / Storage changes*: Modifying existing storage keys, defaults, or removing user settings.
  3. *Ambiguous requirements*: When user instructions lack specific interaction details.
- **How to Ask (Option-Driven Confirmation)**:
  - Do NOT ask open-ended questions like "How would you like this done?".
  - Provide concrete, actionable choices (Option A vs Option B) and clearly state your recommended option with rationale.
- **Constructive Pushback**:
  - If a requested approach introduces unnecessary complexity (e.g. proposing heavy external DOM parsers when pure Relay store traversal suffices), surface the simpler alternative first.

---

## 4. Extension Coding Style & Design Discipline

### One Accent Color Per Project
- Every focus ring, active toggle, and prominent CTA must use the single brand accent defined in `--accent-gradient` and `--accent-shadow`.
- Keep these variables synchronized between `src/popup/popup.css` and `src/options/options.css`.
- Never introduce a secondary brand hue mid-project.

### Reuse Existing CSS Styles
- Before styling anything new, use existing design tokens and classes:
  - Buttons: `.settings-btn` (full width), `.btn-secondary` (compact ghost).
  - Rows: `.setting-row` + `.setting-label` (label + description left, control right).
  - Toggles: `.switch` + `.slider.round`.
  - Cards: `.diet-card`, `.stat-card`.
- If no existing pattern fits, extend the nearest class with a modifier instead of inventing a parallel style.

### No Magic Numbers
- **CSS**: Colors, timings, and dimensions belong in `:root` custom properties. Do not scatter raw values inside component rules.
- **JavaScript**: Tuning knobs belong in a top-level `const CONFIG = { ... }` or module constants (e.g. debounce ms, buffer limits, storage keys).

### Accessibility (a11y) & Focus Visibility
- **Screen Reader Labels**: Every toggle `<input type="checkbox">` must have a descriptive `aria-label` (since `.switch` visually hides native checkboxes).
- **Keyboard Navigation**: Interactive elements (`button`, `.switch input`, `a`) must provide a distinct `:focus-visible` outline.

### MV3 Security & Chrome Web Store Review Red Lines
- **Zero inline handlers**: Never use `onclick="..."` in HTML. Always use `addEventListener` in JS.
- **Zero dynamic `innerHTML`**: #1 reason for Chrome Web Store rejection. Strictly use `textContent`, `document.createElement`, or safe templates. Never assign dynamic or untrusted strings to `innerHTML`.
- **Zero remote scripts**: Every script, stylesheet, and asset must be bundled locally inside the extension.

---

## 5. Performance, React Tree & Storage Discipline

- **Preserve React Tree (1x1 Squash)**:
  - **Never manipulate Facebook's native React DOM nodes directly** from the MAIN proxy; use pure React wrapper elements (`FBDietFold`).
  - Folded units must NEVER be detached or unmounted; apply a `1x1` squash container with `overflow: hidden` to keep Facebook video players, GraphQL subscriptions, and IntersectionObservers stable.
- **Storage Asynchrony & Batching**:
  - Never assume storage reads are synchronous. Always supply default values.
  - Chrome throttles high-frequency storage writes. In `content.js`, buffer count updates and flush every 3 seconds.
- **In-Memory Expansion State**:
  - User expand/collapse state lives in-memory in `bridge.js` keyed by `unitId`, surviving virtual scroll recycling without hitting disk storage.
- **Resilient Lifecycle (`shutdown`)**:
  - Whenever `chrome.runtime?.id` becomes unavailable (e.g. extension reload), gracefully disconnect observers, clear timers, and silence storage callbacks to eliminate `Extension context invalidated` errors.

---

## 6. Strategic Guardrails: Testing & Documentation

### Testing Strategy (`tests/`)
- **Zero external runtime dependencies**: Uses Node.js built-in assertion framework via `tests/harness.js`.
- Run tests via `npm test` or `node tests/run.js`.
- Test pure business logic, Relay path resolution, classification decisions, and i18n dictionaries. Never introduce browser automation tools.

### Documentation Ownership
- **`README.md`**: User-facing overview, features, installation, and permissions. Strictly relative links.
- **`DEVELOPMENT.md`**: Technical architecture, module breakdown, runtime data flows, browser debugging, and testing commands.
- **`AGENTS.md`** (this file): Engineering contract, workflow discipline, coding rules, and safety red lines.
- **`STRATEGY.md`**: Feed classification strategy, Relay field mapping, and authoritative decision log.

---

## 7. Pre-Flight Self-Verification Checklist

Before presenting completed code or notifying the user, mentally verify against this checklist:
- [ ] **No proactive `git commit`**: Waited for explicit user approval before committing.
- [ ] **Surgical precision**: Did not touch or reformat unrelated lines or comments.
- [ ] **Zero `innerHTML`**: No dynamic HTML injection into the DOM.
- [ ] **No magic numbers**: Tunables extracted to module constants or `:root`.
- [ ] **Accessibility checked**: Inputs have `aria-label`; interactive items have `:focus-visible`.
- [ ] **React tree preserved**: Folded units use non-destructive wrapper (`1x1` squash), never detached from DOM.
- [ ] **Relative links only**: No absolute paths used in markdown documentation.
- [ ] **Tests passing**: Verified with `npm test` or `node tests/run.js` without regressions.
