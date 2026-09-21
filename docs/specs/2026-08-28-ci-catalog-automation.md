# CI Catalog Automation — Zero Local Command Code

Status: draft (2026-08-28)

## Goal

Keep the OpenCode Command Code plugin working without requiring a locally installed `command-code` CLI. CI watches upstream releases, syncs the model catalog into the repo, publishes npm patch releases automatically, and opens a GitHub issue when automation cannot recover.

User intervention is only needed when extraction logic itself must change (e.g. bundle format drift), not for routine catalog updates.

## Non-Goals

- Runtime fetch of catalog from GitHub. Delivery is the installed plugin artifact (npm package or git/`file://` checkout), not a live HTTP manifest.
- Fuzzy matching or heuristic catalog repair in CI.
- Auto-fixing broken extraction anchors in CI (that requires human code changes).

## Design Summary

```
command-code npm publish
        │
        ▼
  GitHub Actions (cron + manual)
        │
        ├─ download tarball
        ├─ extract model catalog (required)
        ├─ extract costs (CLI, then official docs, then optional API)
        ├─ write models.json + manifest.json
        │
        ├─ SUCCESS ──► bump patch + commit ──► npm publish if NPM_TOKEN set ──► GitHub Release
        │
        └─ MODEL FAIL ──► open/update issue (catalog-break) ──► fail workflow
             COST FAIL only ──► degraded manifest ──► still release (patch)
```

## Repo Artifacts

### `models.json` (existing)

Bundled catalog shipped with the plugin. Default runtime source. Local `command-code` is not required.

### `manifest.json` (new, committed)

Human- and CI-readable metadata about the bundled catalog. Shipped with the plugin; not fetched from GitHub at runtime.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-28T17:00:00.000Z",
  "pluginVersion": "0.4.2",
  "commandCodeVersion": "1.38.0",
  "commandCodeTarball": "https://registry.npmjs.org/command-code/-/command-code-1.38.0.tgz",
  "modelCount": 65,
  "reasoningModelCount": 18,
  "extraction": {
    "modelCatalog": "ok",
    "costCatalog": "docs",
    "costCatalogError": null
  },
  "costSources": {
    "cli": 40,
    "officialDocs": 25,
    "thirdParty": 0,
    "free": 0,
    "fallback": 0,
    "unmatched": 0
  },
  "status": "healthy"
}
```

Write order: bump `package.json` version first, then write `manifest.json` with that `pluginVersion`, then one commit. Do not store `gitCommit` in the file (unknown until after commit; put SHA on the GitHub Release instead).

`status` rules:
- `healthy`: model catalog ok **and** every model has a sourced price (`cli`, `officialDocs`, `thirdParty` / models.dev, or `free`). `unmatched` = 0
- `degraded`: model catalog ok, but at least one model still has the unmatched placeholder `{ input: 0.5, output: 2 }`
- `broken`: model catalog extraction failed

`extraction.costCatalog` is the **best** source that contributed (`cli` | `docs` | `thirdParty` | `free` | `fallback` | `missing`).

Status values:

| status | Meaning | CI action |
|---|---|---|
| `healthy` | models ok; costs from CLI, official docs, models.dev, and/or free SKUs | release |
| `degraded` | models ok; some costs have no listed source | release + note which models fell through |
| `broken` | model catalog extraction failed | no release, open issue |

### `_version.txt` (existing)

Tracks bundled `command-code` version. CI keeps in sync with `manifest.json`.

## Cost Enrichment Policy

Costs are resolved **in CI / `bun run sync`**, then written into `models.json`. OpenCode startup never fetches prices.

Waterfall, per model, first hit wins. Later steps only fill models still missing costs.

1. **CLI bundle** — `extractCostData` from the `command-code` tarball. Failure here does not fail the job.
2. **Official Command Code docs** (required attempt when CLI left gaps):
   - Preferred parse target: [https://commandcode.ai/models](https://commandcode.ai/models) (per-model table: Input/M, Output/M, Cache read, Cache write).
   - Fallback page: [https://commandcode.ai/docs/resources/pricing-limits](https://commandcode.ai/docs/resources/pricing-limits) if `/models` fetch or parse fails.
   - Store the **current billed** per-1M USD rates shown on the page (deal-adjusted when the page shows an effective price). Do not invent deal math.
3. **Free SKUs** — catalog id/name matching `\bfree\b` or id ending `-free` → `{ input: 0, output: 0 }`. Runs **before** models.dev so Command Code free SKUs stay $0 even when models.dev lists a paid twin (e.g. Tencent Hy3).
4. **models.dev** — `GET https://models.dev/api.json` for remaining **paid** gaps. Exact id (case-insensitive), then last path segment as id, then exact display name. Reference prices, not Command Code billed rates. Do not apply to free SKUs.
5. **Unmatched placeholder** `{ input: 0.5, output: 2 }` — last resort so the catalog still ships. These are the only models that mark the catalog `degraded`.

Match docs/API rows to catalog models with **exact** id (case-insensitive) then **exact** display name (case-insensitive). models.dev also tries the last `/` segment of the catalog id as an exact id. No fuzzy matching. Unmatched models go to the next step.

Never fail the sync because costs are incomplete. Model catalog remains the hard requirement.

## CI Workflows

### 1. `catalog-sync.yml` (primary)

Triggers:
- cron: every 6 hours (`0 */6 * * *`)
- `workflow_dispatch` with optional `force=true` (re-extract even if version matches)

Out of scope: `repository_dispatch` watchers.

Steps:
1. Read npm `command-code@latest` version.
2. **Idempotency (do not skip publish retry):**
   - If `commandCodeVersion` unchanged and `force` is false: skip extraction.
   - Still run **publish retry** if the current `package.json` version is not on npm (previous job committed but publish failed).
   - If version unchanged, npm already has that plugin version, and `force` is false: exit.
3. Download tarball (reuse logic from `scripts/sync-models.ts --remote`).
4. Extract models (required) then run the **cost waterfall**:
   - model catalog fail → status `broken`, stop (no commit, no publish).
   - CLI costs fail or partial → continue; fill gaps from official docs, then free SKUs ($0), then models.dev, then unmatched placeholder.
   - Record `costSources` on the manifest. `degraded` only if any model is still unmatched.
5. Sanity floor: `modelCount >= max(20, floor(lastSuccessfulModelCount * 0.5))`. `lastSuccessfulModelCount` is `modelCount` from the last committed manifest with `status` `healthy` or `degraded`. Fail as `broken` if below. If no prior manifest, use `20`.
6. Write `models.json`, `_version.txt`, bump patch in `package.json`, write `manifest.json`.
7. Run unit tests (including 1.38 costless fixture).
8. If status is `broken`: call issue opener, fail job.
9. If models changed or command-code version changed:
   - auto-commit to `main` (catalog + manifest + version only)
   - npm publish if `NPM_TOKEN` is set; if missing, skip publish and record that in the workflow summary (Phase D not wired)
   - GitHub Release after successful publish only

Commit strategy (locked):
- **Auto-commit to `main`** for catalog-only generated files (`models.json`, `manifest.json`, `_version.txt`, `package.json` version).
- **Human PR required** for any change to `src/`, tests, or workflow files. The catalog workflow must never commit extraction-code changes.

ponytail: auto-commit is for deterministic generated data only.

Workflow permissions: `contents: write`, `issues: write`. If branch protection blocks GITHUB_TOKEN pushes, use a fine-grained PAT stored as `CATALOG_PUSH_TOKEN` — do not fall back to a second “open a PR instead” path in the same workflow.

### 2. `catalog-break-issue.yml` (called from sync on failure)

When model extraction fails:
1. Search open issues with label `catalog-break`.
2. If none: create issue from template (see below).
3. If one exists: add comment with new `command-code` version + error snippet + link to failed workflow run.
4. Do **not** publish npm release.

Issue title format:
`[catalog-break] command-code@X.Y.Z — model extraction failed`

Issue body includes:
- failed command-code version
- extraction error message
- link to workflow run logs
- checklist for manual fix (`src/catalog.ts` anchors, tests, re-run sync)
- current bundled catalog version still in use

When a subsequent sync succeeds after manual fix:
- auto-close open `catalog-break` issues with comment referencing fix commit + release tag

## npm Release Policy

| Event | Version bump | Publish |
|---|---|---|
| New command-code catalog (healthy) | patch | yes |
| New command-code catalog (degraded: unmatched placeholder costs) | patch | yes |
| Model extraction broken | none | no |
| Plugin code fix (manual PR) | patch/minor per semver | yes (manual or on merge) |

Published npm name (locked, same account as workit: `brainervirus`):

```json
"plugin": ["@brainervirus/commandcode-go-opencode-provider@latest"]
```

`package.json` `name` becomes `@brainervirus/commandcode-go-opencode-provider` with `publishConfig.access: "public"`. This stays its own repo; it is not folded into `workflow-toolkit`.

Until Phase D (`NPM_TOKEN` GitHub secret — local `npm whoami` is not enough for Actions):
- maintainer install stays `file://.../plugin.ts`
- `file://` is **not** auto-updated by CI; catalog changes require `git pull` of this repo

## Runtime Plugin Changes

Align runtime with CI-first model (no local command-code required):

### Catalog source priority (revised)

1. **Bundled `models.json`** from the installed plugin (npm package or `file://` checkout). Default. Always available if the install is intact.
2. Last-good cache file (identity spec) — only if bundled file is missing/corrupt.
3. Optional local `command-code` override when `commandCodePackagePath` or `COMMANDCODE_PACKAGE_PATH` is set — maintainers only.
4. Optional Provider API merge for context lengths (existing).

Local `command-code` is not scraped at startup unless the override is set. CI keeps the committed bundle current.

### Startup behavior

- No stdout logging (per identity spec).
- Read `manifest.json` at startup for diagnostics only:
  - report `catalogSource: bundled`
  - report `commandCodeVersion` from manifest
  - report `degraded` if manifest status is `degraded`
- Auth/connect registers regardless of catalog state.

### Version nudge (optional, non-blocking)

Compare the **installed plugin npm version** to that package’s npm `latest` (not `command-code@latest`). If behind, one diagnostics hint: update the plugin package.

Do not compare against `command-code` itself: a catalog-break means command-code moved and the plugin correctly did not ship — that must not look like “plugin update available”. `file://` installs skip the npm version nudge.

## Extraction Code Requirements (prerequisite)

Phase 1 from identity spec must land before CI automation is reliable:

1. Split `loadCatalogFromBundle`: model required, cost optional.
2. `loadCatalogFromLocalCommandCode` must not return null on cost-only failure.
3. Unit test fixture for `command-code@1.38.0` tarball (models ok, costs fail).

Without this, CI would have falsely reported `broken` on 1.38 when only costs failed.

## Test Plan (CI)

### Required checks on every sync

- `bun test tests/unit/`
- Extract against latest `command-code` tarball (downloaded in CI; do not commit the tarball)
- Assert `modelCount >= max(20, floor(lastSuccessfulModelCount * 0.5))`
- Assert manifest `commandCodeVersion` matches the tarball version and `status` matches extraction

### Regression fixtures

Commit **extracted snapshots** (model JSON + expected counts/errors), not the proprietary CLI bundle:
- `tests/fixtures/command-code/1.38.0-cli-costs-fail.expected.json` — CLI cost extract fails, models still produced (not `broken`)
- Official-docs parser fixture: snapshot of `/models` table rows → mapped costs by exact id/name
- Live tarball download remains CI-only for “latest still extracts”

## GitHub Issue Template

`.github/ISSUE_TEMPLATE/catalog-break.yml`:
- labels: `catalog-break`, `automation`
- assignee: repo owner (if configured)
- fields: command-code version, error, workflow URL

## Secrets and Permissions

| Secret | Purpose |
|---|---|
| `NPM_TOKEN` | publish plugin package (`brainervirus`) |
| `GITHUB_TOKEN` | commit, release, issues |
| `CATALOG_PUSH_TOKEN` | optional; only if branch protection blocks `GITHUB_TOKEN` |

If `main` is protected against `GITHUB_TOKEN`, set `CATALOG_PUSH_TOKEN`. One push path only.

## Acceptance Criteria

- User can run OpenCode with **no** global/local `command-code` install and get current models from the installed plugin (npm package, or a `file://` checkout that has been synced).
- Within 6 hours of a new `command-code` npm release, CI either commits a catalog update (and publishes a plugin patch if `NPM_TOKEN` is set) or opens/updates a `catalog-break` issue.
- Cost-only CLI regressions (like 1.38) still ship a catalog. Costs come from official docs, then free SKUs ($0), then models.dev; `degraded` only if models remain unmatched.
- Successful sync never requires local `bun run sync` from the user.
- Failed model extraction never publishes a misleading npm release.

## Implementation Phases

Same sequence as the identity spec. Phase 1 (A) must refresh `models.json` before anyone relies on “bundled is current”.

### Phase A (= identity Phase 1) — unblock extraction

1. Costless catalog path in `src/catalog.ts`.
2. Fixture: 1.38 cost-fail → catalog still produced.
3. Remove startup stdout leak.
4. One-shot remote sync: commit current `models.json` + `_version.txt` from latest tarball, with official-docs cost fill (unblocks `file://` users immediately).
5. Default runtime source = bundled; local scrape opt-in.

### Phase B — CI sync (no npm required)

1. `manifest.json` schema + writer in `scripts/sync-models.ts`.
2. Official-docs cost parser (`/models`, then pricing-limits page).
3. `.github/workflows/catalog-sync.yml` (extract, cost waterfall, commit, issues). Skip npm publish when `NPM_TOKEN` unset.
4. Issue template + opener; auto-close `catalog-break` on later success.

### Phase C — runtime diagnostics from manifest

1. Read `manifest.json` for startup summary (`commandCodeVersion`, `status`).
2. README: no local `command-code`; `file://` vs npm update paths.

### Phase D — npm publish wiring

1. Rename package to `@brainervirus/commandcode-go-opencode-provider`.
2. Store `NPM_TOKEN` (npm user `brainervirus`) as a GitHub Actions secret; `publishConfig.access: public`.
3. Enable publish + GitHub Release in the workflow.
4. Document `"plugin": ["@brainervirus/commandcode-go-opencode-provider@latest"]` vs pin.

## Plan decomposition

When writing implementation plans, split so each plan ships something usable:

1. **Unblock** — identity Phase 1 / CI Phase A (OpenCode works on current Command Code without the CLI).
2. **Watch + notify** — CI Phases B–C (cron, issues; works without npm).
3. **Identity** — identity Phases 2–3 (favorites, reasoning flags). Independent of CI after the bundle exists.
4. **Publish** — CI Phase D (`@brainervirus/commandcode-go-opencode-provider` + `NPM_TOKEN` on the GitHub repo). Local `npm whoami` does not publish from Actions.

Do not block Plan 1 on npm publishing.

## Risks

| Risk | Mitigation |
|---|---|
| CI auto-commit noise | skip extraction when tarball version unchanged |
| npm publish failure after commit | next cron retries publish for unpublished `package.json` version; tag/Release only after publish succeeds |
| Extraction anchors break silently | relative model-count floor + catalog-break issue |
| User on `file://` | CI cannot update that checkout; README says git pull or switch to npm |
| Wrong “update available” hint | nudge compares plugin npm version, not `command-code@latest` |

## Related Specs

- [2026-08-19-stable-model-identity.md](./2026-08-19-stable-model-identity.md) — identity, degraded mode, startup lifecycle
