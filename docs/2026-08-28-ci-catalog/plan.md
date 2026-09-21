# CI Catalog + npm Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/2026-08-28-ci-catalog/spec.md`
**Parent:** `docs/specs/2026-08-28-ci-catalog-automation.md`
**Branch:** `feature/2026-08-28-ci-catalog`

**Goal:** Cron catalog sync, scoped npm publish, and GitHub tags/releases that follow workit’s token pattern so OpenCode can install `@brainervirus/commandcode-go-opencode-provider@latest`.

**Architecture:** Pure policy/manifest modules with unit tests. Thin CI scripts commit generated catalog files, publish only unpublished versions, then tag. Workflow YAML is asserted in tests (NPMJS → NODE_AUTH_TOKEN, tag after publish).

**Tech Stack:** TypeScript, Bun, GitHub Actions, npm.

## Global Constraints

- Secret name is `NPMJS`, mapped to `NPM_TOKEN` and `NODE_AUTH_TOKEN`.
- `publishConfig.access` is `public`. Package name is `@brainervirus/commandcode-go-opencode-provider`.
- Never tag or `gh release` before npm publish succeeds.
- Catalog workflow must not commit `src/`, tests, or workflow files.
- Tests: `bun test tests/unit/` from `/home/cristhofer-pincetti/Documents/projects/personal/opencode-commandcode-provider`.
- Plugin imports use `.js` suffix; tests import `.ts`.
- Do not fold this package into workflow-toolkit.
- Do not change the user’s hybrid Provider API transport.

---

### Task 1: Manifest schema and publish policy

**Files:**
- Create: `src/manifest.ts`, `src/publish-policy.ts`
- Test: `tests/unit/manifest.test.ts`, `tests/unit/publish-policy.test.ts`

**Interfaces:**
- `buildManifest(...)` → `CatalogManifest` with `status` healthy/degraded/broken and `costSources`
- `bumpPatch("0.5.0")` → `"0.5.1"`
- `meetsModelCountFloor(count, lastSuccessful)` → `count >= max(20, floor(last * 0.5))`; last missing → 20
- `decideCatalogSync({ force, latestCommandCodeVersion, bundledCommandCodeVersion, pluginVersion, publishedPluginVersions })` → `{ extract, publishRetry, exit }`
- `decidePublish({ pluginVersion, publishedPluginVersions, npmTokenSet })` → `"publish" | "skip-no-token" | "skip-already-published"`

- [ ] **Step 1:** Write failing tests for status, floor, bump, skip-extract + publish-retry, skip when already published.
- [ ] **Step 2:** Run `bun test tests/unit/manifest.test.ts tests/unit/publish-policy.test.ts` and confirm they fail.
- [ ] **Step 3:** Implement the modules.
- [ ] **Step 4:** Re-run tests; they pass.
- [ ] **Step 5:** Commit.

---

### Task 2: Sync writes manifest; CI scripts

**Files:**
- Modify: `scripts/sync-models.ts`, `src/costs-docs.ts` (optional out-set of doc-filled ids)
- Create: `scripts/catalog-sync-ci.ts`, `scripts/publish-if-needed.ts`, `scripts/catalog-break.ts`
- Test: `tests/unit/catalog-break.test.ts`; extend costs-docs if return shape changes

**Behavior:**
- Sync writes `models.json`, `_version.txt`, `manifest.json` (pluginVersion from `package.json`).
- CI extract path bumps patch only when command-code version or models.json content changes.
- Model extract throw → catalog-break title/body helpers; no bump, no publish.
- `publish-if-needed` is a no-op when version is already on npm or token missing.

- [ ] **Step 1:** Write failing tests for catalog-break title/body and manifest writer round-trip.
- [ ] **Step 2:** Run tests; confirm fail.
- [ ] **Step 3:** Implement writer + scripts.
- [ ] **Step 4:** Re-run unit tests.
- [ ] **Step 5:** Commit.

---

### Task 3: Package rename, workflows, README, startup manifest

**Files:**
- Modify: `package.json`, `plugin.ts`, `README.md`, `CHANGELOG.md`, `opencode.json`
- Create: `.github/workflows/catalog-sync.yml`, `.github/workflows/release.yml`, `.github/workflows/test.yml`, `.github/ISSUE_TEMPLATE/catalog-break.yml`
- Test: `tests/unit/release-workflow.test.ts`; startup/plugin tests for degraded-from-manifest

**Assertions:**
- Package name + `publishConfig.access: public` + repository URLs point at BrainerVirus.
- Both publish jobs set `NPM_TOKEN` and `NODE_AUTH_TOKEN` from `secrets.NPMJS`.
- `setup-node` has `registry-url: https://registry.npmjs.org`.
- Catalog cron `0 */6 * * *`; `workflow_dispatch` with `force`.
- README install string is `@brainervirus/commandcode-go-opencode-provider@latest` (plugin) with hybrid provider override documented.
- Plugin reads `manifest.json` for `commandCodeVersion` / `degraded`; no stdout.

- [ ] **Step 1:** Write failing workflow + package.json tests.
- [ ] **Step 2:** Run tests; confirm fail.
- [ ] **Step 3:** Add workflows, rename package, update README/plugin.
- [ ] **Step 4:** `bun test tests/unit/` passes.
- [ ] **Step 5:** Commit.

---

### Task 4: First npm publish and GitHub tag

**Files:** none beyond version `0.5.0` already in package.json.

- [ ] **Step 1:** `npm publish --dry-run` from repo root; tarball includes `models.json`, `plugin.ts`, `manifest.json`, `src/`; excludes tests/docs.
- [ ] **Step 2:** `npm publish --access public`.
- [ ] **Step 3:** After publish succeeds, `git tag v0.5.0` and `gh release create` on the commit that is on `main` (or the feature commit if publishing before merge).
- [ ] **Step 4:** Confirm `npm view @brainervirus/commandcode-go-opencode-provider version` is `0.5.0`.
