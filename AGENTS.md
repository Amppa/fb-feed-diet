# AGENTS.md — AI Engineering Contract
This file defines the engineering workflow and behavioral rules for AI coding agents.

## 1. Before Coding
- Inspect the repository structure and relevant existing code before modifying it.
- Read relevant project documentation and follow established architecture and conventions.
- Check git status before making changes.
- Never overwrite, discard, or reset pre-existing user changes.
- Do not silently guess when requirements or architecture are materially ambiguous. Ask with concrete options.

## 2. Project Context
- Project-specific architecture, conventions, debugging, testing, and decision records are documented in the relevant project files.
- When present, these files are authoritative for the areas they cover.

## 3. Keep Changes Surgical
- Implement the smallest reasonable change that satisfies the requirement.
- Reuse existing code, patterns, and abstractions.
- Do not introduce speculative features, abstractions, or dependencies without explicit user approval.
- Do not refactor, reformat, rename, or clean up unrelated code.
- Preserve existing behavior outside the task scope.

## 4. Git Branch Workflow
- `main` is the stable integration branch.
- For non-trivial work, create a dedicated branch (`feature/<name>`, `fix/<name>`, `refactor/<name>`).
- Keep all development work isolated from `main`.
- Trivial changes may remain on the current branch when a dedicated branch adds no meaningful benefit.
- AI may create commits inside its working branch.
- AI must NOT merge into `main` without explicit user approval.

## 5. Task Decomposition
- For multi-step or multi-file tasks:
  - Understand the complete task.
  - Identify logical implementation units.
  - Implement and verify them sequentially when practical.
- Do not continue unrelated work on top of a known failing state.
- Do not determine task or commit size by line count or file count.

## 6. Commit Granularity
- A commit should be the smallest meaningful, coherent, independently understandable, and reasonably verifiable logical change.
- Keep tightly coupled changes together (implementation + tests, API change + call-sites).
- Prefer separate commits for independent purposes (feature + refactor, bug fix + cleanup).
- Commits are recovery checkpoints. AI may reorganize its own working-branch commits before merge.
- Write commit messages in English using the imperative mood (e.g., `Add parser validation`, `Fix feed classification`).

## 7. Verification
- After each meaningful logical unit:
  - Run the most relevant tests/checks.
  - Inspect the diff.
  - Confirm all changes are intentional.
  - Commit when the unit forms a useful checkpoint.
- A passing test is necessary but not sufficient. Also verify requirements and architectural fit.
- For behavior changes: add or update tests in the existing infrastructure (`tests/`, no new framework), prefer deterministic cases, and never weaken or remove tests to make them pass. Never claim untested behavior was verified.
- If verification fails:
  - Stop advancing to unrelated work.
  - Diagnose the failure.
  - Fix or revert the current change.
  - Re-run verification before continuing.

## 8. Final Review
- Before requesting merge:
  - Run relevant tests and checks.
  - Review the complete diff against `main`.
  - Confirm no unrelated changes exist.
  - Confirm no known failures remain.
  - Confirm user changes were preserved.
  - Keep documentation consistent with behavior; update it when workflow, configuration, user-visible behavior, or architecture changes.
  - Report what changed, why, what was verified, and any remaining uncertainty, clearly separating observed facts from assumptions.
- The user controls the final merge into `main` (squash-merging is preferred for multi-checkpoint branches).

## 9. Safety & Compatibility
- Never hard-code or commit secrets, API keys, tokens, or credentials.
- Do not weaken input validation, permission checks, or output encoding.
- Do not expose sensitive data in logs, tests, error messages, or commits.
- Treat existing database schemas, storage keys, public interfaces, and configuration formats as compatibility contracts: do not silently invalidate stored data or user settings, and state migration or rollback implications when they change.

## 10. Core Principle
- **Branch** = isolation boundary
- **Logical unit** = unit of work
- **Commit** = recovery checkpoint
- **Verification** = quality gate
- **Merge** = human acceptance boundary

Optimize for safe, understandable, recoverable changes, not minimum commits or minimum lines.
