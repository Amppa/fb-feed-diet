# Public Test Suites

This directory contains public-safe essential contract test suites distributed to the public repository.
All test suites here must use synthetic data only and never include private captures or personally identifiable information.

## Scope & Policy

Per the public-mirror contract policy, this directory carries only the public filtering contracts and packaging sanity:
- `defaults.test.js`: Settings schema, category mappings, and storage defaults.
- `dom-sponsored.test.js`: Synthetic DOM-based sponsored post detection contracts.
- `relay-classify.test.js`: Core Relay feed unit classification contracts.
- `package.test.js`: Multi-browser manifest generation and zip packaging verification.

All internal implementation tests (Comet loader injection hooks, UI fold state machines, runtime message ports, probes, and diagnostic telemetry) reside exclusively in `tests/private/`.
