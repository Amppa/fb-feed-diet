# Development Guide

This hub links the developer documentation for **FB Diet**. Topic files live under [`docs/`](docs/); [AGENTS.md](AGENTS.md) only carries the project-agnostic contract.

## Contents

- [🛠️ Project Structure](#project-structure)
- [📐 Project Conventions & Engineering Guardrails](docs/conventions.md)
  - [Project Workflow Preferences](docs/conventions.md#project-workflow-preferences)
  - [Documentation Ownership (where each doc lives)](docs/conventions.md#documentation-ownership-where-each-doc-lives)
  - [Extension Coding Style & Design Discipline](docs/conventions.md#extension-coding-style-design-discipline)
  - [Performance, React Tree & Storage Discipline](docs/conventions.md#performance-react-tree-storage-discipline)
  - [Pre-Flight Checklist (Project)](docs/conventions.md#pre-flight-checklist-project)
- [💻 Local Workflow, Packaging & Testing](docs/workflow.md)
  - [Local Development Workflow](docs/workflow.md#local-development-workflow)
  - [Packaging for Release](docs/workflow.md#packaging-for-release)
  - [Testing Strategy (`tests/`)](docs/workflow.md#testing-strategy-tests)
- [🏗️ Architecture, Modules & Runtime Flows](docs/architecture.md)
  - [High-Level Architecture](docs/architecture.md#high-level-architecture)
  - [Directory & Module Breakdown](docs/architecture.md#directory-module-breakdown)
  - [Runtime Data & Control Flows](docs/architecture.md#runtime-data-control-flows)
- [🔍 Debugging & Diagnostics](docs/debugging.md)
- [Feed Classification Strategy & Decision Log](STRATEGY.md)
- [🔬 External Projects & Algorithm Research](docs/research/README.md)
  - [Cross-Project Comparison Matrix](docs/research/README.md#cross-project-comparison-matrix)
  - [esuit-suggest-blocker Teardown](docs/research/esuit.md)
- [Documentation Ownership](#documentation-ownership)
- [⚡ Current Stage Policy: Zero Backward Compatibility Overhead](#-current-stage-policy-zero-backward-compatibility-overhead)

## 🛠️ Project Structure

- **`src/inject/`**: Injected into Facebook's `MAIN` world (hooks `window.__d`, reads Relay store, extracts probe metadata, evaluates deterministic classification rules, renders React fold placeholders).
- **`src/content/`**: Runs in the `ISOLATED` extension world (DOM fallback heuristics, storage synchronization, throttled stats reporting, `postMessage` bridge).
- **`src/background/`**: Chrome MV3 Service Worker (settings storage sync, cross-tab broadcasts, context menu / badges).
- **`src/options/` & `src/popup/`**: User configuration dashboards and popup toggle UI.
- **`src/shared/` & `src/i18n/`**: Shared schemas, settings defaults, version constant, and multilingual localization dictionaries (`en`, `zh-TW`).
- **`tests/`**: Zero-dependency native Node.js test harness covering pure classification, Relay navigation, proxy wrapping, and fallback logic.
- **`docs/`**: Developer deep-dives covering architecture, debugging, conventions, and external research teardowns.
- **`scripts/`**: Zero-dependency release packagers producing clean distribution archives.

---

## Documentation Ownership

- **`README.md`**: User-facing overview, features, installation, and permissions.
- **`DEVELOPMENT.md`** (this file): Developer hub — contents index, project structure, and documentation ownership.
- **`docs/conventions.md`**: Project conventions & engineering guardrails (authoritative FB Diet-specific rules).
- **`docs/workflow.md`**: Local development workflow, release packaging, and testing strategy.
- **`docs/architecture.md`**: Dual-world architecture, module breakdown, and runtime data flows.
- **`docs/debugging.md`**: In-browser diagnostic consoles and debugging.
- **`AGENTS.md`**: Project-agnostic engineering contract — Git workflow, task decomposition, commit granularity, verification discipline, and autonomy boundaries.
- **`STRATEGY.md`**: Feed classification strategy, Relay field mapping, and the authoritative decision log to consult before touching `classify.js` or `fold.js`.

---

## ⚡ Current Stage Policy: Zero Backward Compatibility Overhead

> **Active Project Directive (Rapid Iteration Stage)**:
> - The project is currently maintained by and for core testers (user base: ~2).
> - **No Legacy Migrations**: Do not write, maintain, or introduce defensive code for legacy schema migrations (e.g. converting deprecated string settings `'mini'`/`'title'`, renaming obsolete storage keys, or juggling transitional preview formats).
> - **Clean State / Reset-on-Upgrade**: When settings schemas or key names evolve, storage is updated by shallow merging `FB_DIET_DEFAULTS.SETTINGS` with existing keys (`Object.assign({}, DEFAULT_SETTINGS, data.settings)`). If a breaking change occurs, a clean reset to defaults is the standard procedure.
> - **Code Simplicity Over Legacy Support**: Keep `background.js` and `options.js` lean, pure, and free of historical migration boilerplate. Full backward compatibility will only be introduced when the extension is prepared for broad public release.
