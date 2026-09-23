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

## 🛠️ Project Structure

```text
fb-diet-feed/
├── manifest.json              # MV3 configuration with dual-world content scripts
├── package.json               # Test script and package metadata
├── README.md                  # User-facing summary and installation instructions
├── DEVELOPMENT.md             # Developer hub: contents index & project structure (this file)
├── AGENTS.md                  # Project-agnostic engineering discipline & AI contract
├── STRATEGY.md                # Feed classification strategy & decision log
├── docs/                        # Developer topic files (split from this hub)
│   ├── conventions.md           # Project conventions & engineering guardrails
│   ├── workflow.md              # Local workflow, packaging & testing
│   ├── architecture.md          # Architecture, modules & runtime flows
│   ├── debugging.md             # Diagnostic consoles & debugging
│   └── research/                # External projects & algorithm teardown research
│       ├── README.md            # Cross-project comparison matrix
│       └── esuit.md             # esuit-suggest-blocker v2.10.0 analysis
├── design/                    # Source design assets (e.g. Affinity fb-fd.af)
├── icons/                     # Extension asset icons (16, 32, 48, 128)
├── scripts/                   # Zero-dependency release packagers (NOT packaged)
│   ├── package.js             # Node.js packaging script
│   └── package.ps1            # Windows PowerShell packaging script
├── src/
│   ├── shared/
│   │   └── defaults.js        # Single source of truth for settings & stats schemas
│   ├── background/
│   │   └── background.js      # Service Worker: settings sync, tab broadcast
│   ├── content/
│   │   ├── content.css        # Responsive styling for inline placeholders
│   │   ├── content.js         # Isolated world: storage sync, throttled stats, bridge
│   │   ├── detector.js        # Multilingual regexes & DOM heuristics for fallback
│   │   └── fallback.js        # Isolated world: DOM fallback scanner & safe placeholders
│   ├── i18n/
│   │   └── i18n.js            # Shared en / zh-TW dictionary for options & popup pages
│   ├── inject/
│   │   ├── proxy.js           # Hooks window.__d, wraps React components safely
│   │   ├── relay.js           # Intercepts Relay Record Store and evaluates field paths
│   │   ├── metadata.js        # Probe enrichment: author / group / content / media / viewer
│   │   ├── classify.js        # Pure functions mapping feed props + Relay to categories
│   │   ├── classify-retired.js# Retired rules kept for reference (never injected)
│   │   ├── bridge.js          # In-memory settings, postMessage router, expansion state
│   │   ├── ui.js              # React placeholder bars (18px/36px), DOM extractors, badges
│   │   ├── probe.js           # Diagnostic JSON generator, copy probe button, tooltip popup
│   │   └── fold.js            # Lean coordinator: FBDietFold React decorator & registration
│   ├── options/
│   │   ├── options.html       # Full dashboard & group toggles
│   │   ├── options.css        # Dark glassmorphic styles
│   │   └── options.js         # Live stats breakdown and configuration sync
│   └── popup/
│       ├── popup.html         # Compact extension toolbar popup
│       ├── popup.css          # Minimalist dark popup UI
│       └── popup.js           # Master toggle and options page navigation
└── tests/
    ├── harness.js             # Lightweight Node test assertion framework
    ├── run.js                 # Test runner discovering *.test.js
    ├── defaults.test.js       # Unit tests for shared defaults schema
    ├── fallback.test.js       # Unit tests for DOM fallback placeholder & observation
    ├── proxy.test.js          # Unit tests for proxy.js registration & hooks
    ├── relay.test.js          # Unit tests for relay.js path navigation
    ├── classify.test.js       # Unit tests for feed unit classification
    ├── i18n.test.js           # Unit tests for language dictionaries & fallback
    └── fold.test.js           # Unit tests for folding wrapper logic
```

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
