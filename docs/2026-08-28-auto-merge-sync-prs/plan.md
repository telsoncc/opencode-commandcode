# Auto-merge sync PRs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/2026-08-28-auto-merge-sync-prs/spec.md`
**Branch:** `feature/2026-08-28-auto-merge-sync-prs`

**Goal:** Queue GitHub auto-merge on bot catalog and post-release manifest PRs; fail the job if queueing fails.

**Architecture:** Keep `gh pr merge --auto --squash --delete-branch`. Remove the swallow on the release job. Call the same command from `catalog-sync-ci.ts` after create and after updating an existing PR. Tests assert the workflow/script strings. Repo `allow_auto_merge` is enabled via GitHub API (already done).

**Tech Stack:** GitHub Actions, `gh`, Bun tests (`tests/unit/release-workflow.test.ts`).

## Global Constraints

- PRs against `BrainerVirus/opencode-commandcode` base `main`. Squash + delete source branch.
- In-place `feature/2026-08-28-auto-merge-sync-prs` (no worktrees).
- Conventional commit `ci:` so path-gated semantic-release does not publish.
- Do not fold this package into workit.

---

### Task 1: Fail loud on manifest auto-merge; queue catalog PRs

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/catalog-sync-ci.ts`
- Modify: `tests/unit/release-workflow.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

In `tests/unit/release-workflow.test.ts`, on the sync step `run` string:

- still contains `gh pr merge --auto --squash --delete-branch`
- does **not** contain `auto-merge unavailable` or `|| echo`

On `scripts/catalog-sync-ci.ts` source: contains `gh pr merge --auto --squash --delete-branch`.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
bun test tests/unit/release-workflow.test.ts
```

- [ ] **Step 3: Implement**

`release.yml`: drop `|| echo "auto-merge unavailable — merge the sync PR after CI is green"`.

`catalog-sync-ci.ts`: after `gh pr create` and after logging an updated existing PR, run `gh pr merge --auto --squash --delete-branch` (stdio inherit, same cwd). Do not swallow errors.

README Development: catalog and manifest-sync PRs auto-merge when the five checks are green.

- [ ] **Step 4: Run tests and `bun run check`**

```bash
bun test tests/unit/release-workflow.test.ts
bun run check
```
