# Project Conventions & Engineering Guardrails

> Developer topic file. Start at the hub: [DEVELOPMENT.md](../DEVELOPMENT.md).

This file is the authoritative home for **FB Diet-specific** conventions. It was relocated here from `AGENTS.md`, which now only carries the project-agnostic engineering contract.

### Project Workflow Preferences

- **Documentation language**: `README.md` stays English (open-source / Chrome Web Store standard); `DEVELOPMENT.md` and code comments are English; planning documents, task breakdowns and walkthroughs are written in Traditional Chinese (繁體中文).
- **Testing mode**: Node unit tests (`npm test` / `node tests/run.js`) plus **manual** in-browser verification. Browser automation is forbidden (see Testing Strategy in `workflow.md`).
- **Branch & commit workflow**: non-trivial work happens on a dedicated branch (`docs/…`, `feat/…`, `fix/…`). The AI may create checkpoint commits freely inside its own working branch; merging back into `master` and bumping the version in `manifest.json` are **user-approved only**.
- **Commit messages**: English, imperative, conventional prefix (e.g. `fix(classify): refine suggested group join state selector`).
- **Markdown links**: strictly relative (`[DEVELOPMENT.md](../DEVELOPMENT.md)` from inside `docs/`), never absolute paths.

### Documentation Ownership (where each doc lives)

- **`README.md`**: User-facing overview, features, installation, and permissions.
- **`DEVELOPMENT.md`** (hub): Contents index, project structure, and documentation ownership.
- **`docs/conventions.md`** (this file): Project conventions & engineering guardrails (authoritative FB Diet-specific rules).
- **`docs/workflow.md`**: Local development workflow, release packaging, and testing strategy.
- **`docs/architecture.md`**: Dual-world architecture, module breakdown, and runtime data flows.
- **`docs/debugging.md`**: In-browser diagnostic consoles and debugging.
- **`AGENTS.md`**: Project-agnostic engineering contract — Git workflow, task decomposition, commit granularity, verification discipline, and autonomy boundaries.
- **`STRATEGY.md`**: Feed classification strategy, Relay field mapping, and the authoritative decision log to consult before touching `classify.js` or `fold.js`.
- **`docs/research/`**: Reverse engineering notes, algorithm teardowns, and comparison matrices of external/competitor projects (e.g., esuit).

### Extension Coding Style & Design Discipline

#### One Accent Color Per Project

- Every focus ring, active toggle and prominent CTA uses the single brand accent defined by `--accent-gradient`, together with its glow partner `--accent-glow`.
- Keep those custom properties synchronized between `src/popup/popup.css` and `src/options/options.css`.
- Never introduce a secondary brand hue mid-project.

#### Reuse Existing CSS Patterns

Before styling anything new, reuse the existing tokens and classes:

- Feature rows: `.feature-item` + `.feature-title` / `.feature-desc`; dropdowns: `.feature-select`.
- Section headers: `.section-header` + `.section-label`.
- Buttons: `.settings-btn` (full width), `.reset-btn` (compact ghost).
- Toggles: `.switch` + `.slider.round`.
- Cards & stats: `.stat-card`, `.stat-info`, `.stat-number`, `.sub-value`; feed badges: `.fb-diet-badge` + group modifier.

If no existing pattern fits, extend the nearest class with a modifier instead of inventing a parallel style.

#### No Magic Numbers

- **CSS**: colors, timings and dimensions belong in the `:root` custom properties; do not scatter raw values inside component rules.
- **JavaScript**: tuning knobs and schemas live in shared module constants — `src/shared/defaults.js` (`DEFAULT_SETTINGS`, `DEFAULT_COUNTS`, `GROUP_BY_CATEGORY`, `GROUP_META`) or the owning module's top-level constants (`CATEGORY` in `classify.js`, `LOG_FLUSH_DELAY_MS` / `MAX_PERSISTED_LOGS` in `content.js`). Avoid inline literals and duplicate local copies of shared values.

#### Accessibility (a11y) & Focus Visibility

- **Screen reader labels**: every toggle `<input type="checkbox">` must carry a descriptive `aria-label`, because `.switch` visually hides the native checkbox. Both master toggles (`#enabled` in `src/popup/popup.html` and `src/options/options.html`) carry `aria-label="Master Toggle"`; the engine-mode radios are named by their wrapping `.mode-option` label text.
- **Keyboard navigation**: interactive elements (`button`, `.switch input`, `a`) must expose a distinct `:focus-visible` outline — the existing implementations are `.lang-switch`, `.reset-btn`, `.feature-select` and `.segment-btn`.

#### MV3 Security & Chrome Web Store Review Red Lines

- **Zero inline handlers**: never use `onclick="…"` in HTML; always wire events with `addEventListener` from JS.
- **Zero dynamic `innerHTML`**: the #1 reason for Chrome Web Store rejection. Use `textContent`, `document.createElement` or safe templates, and never assign dynamic or untrusted strings to `innerHTML`.
- **Zero remote scripts**: every script, stylesheet and asset ships locally inside the extension.

### Performance, React Tree & Storage Discipline

- **Preserve the React tree (1x1 squash)**: never manipulate Facebook's native React DOM nodes from the MAIN world; always wrap through the pure React `FBDietFold` decorator. Folded units are never detached or unmounted — they collapse into a `1x1` container with `overflow: hidden` so Facebook video players, GraphQL subscriptions and `IntersectionObserver` instances stay alive.
- **Storage asynchrony & batching**: never assume storage reads are synchronous — always supply defaults. Chrome throttles high-frequency writes, so `content.js` buffers counter updates and flushes them every 3 seconds, while the `fbDietLog` diagnostic buffer flushes every 2 seconds and is capped at `MAX_PERSISTED_LOGS = 300` entries.
- **In-memory expansion state**: user expand/collapse state lives in memory in `bridge.js` (`expandedSet`, keyed by `unitId`), surviving virtual-scroll recycling without hitting disk storage.
- **Resilient lifecycle (`shutdown`)**: when `chrome.runtime?.id` becomes unavailable (e.g. extension reload), gracefully disconnect observers, clear timers and silence storage callbacks to eliminate `Extension context invalidated` errors.
- **Clarification triggers in this project**: DOM hiding vs React wrapping, a new toggle vs extending an existing group, or any change to storage keys and defaults are architectural decisions — present Option A / Option B with trade-offs instead of choosing silently.
- **Constructive pushback**: prefer pure Relay store traversal over heavyweight DOM parsing or injected third-party parsers, and surface the simpler path first when a request pulls in unnecessary complexity.

### Pre-Flight Checklist (Project)

Before presenting completed code or notifying the user:

- [ ] **Surgical precision**: no unrelated lines, comments or formatting touched.
- [ ] **Zero dynamic `innerHTML`**: no HTML injection into the DOM.
- [ ] **No magic numbers**: tunables live in `:root`, `defaults.js` or module-level constants.
- [ ] **Accessibility**: new inputs carry `aria-label`; new interactive elements have `:focus-visible`.
- [ ] **React tree preserved**: folded units use the non-destructive `1x1` squash and are never detached.
- [ ] **Relative links only**: no absolute paths in markdown.
- [ ] **Tests green**: `npm test` passes without regressions.
- [ ] **Scope honoured**: no merge into `master` and no version bump without explicit approval.
