# CI Catalog Sync + npm Publish

Status: approved (2026-08-28)
**Branch:** `feature/2026-08-28-ci-catalog`
Parent: [docs/specs/2026-08-28-ci-catalog-automation.md](../specs/2026-08-28-ci-catalog-automation.md)

## Goal

Watch `command-code` on npm every 6 hours, refresh the bundled catalog, publish `@brainervirus/commandcode-go-opencode-provider` patches, tag GitHub Releases only after npm succeeds, and open a `catalog-break` issue when model extraction cannot be auto-fixed.

## Locked (do not reopen)

- npm name: `@brainervirus/commandcode-go-opencode-provider` with `publishConfig.access: "public"`.
- GitHub Actions secret name: `NPMJS` (same as workit). Map it to **both** `NPM_TOKEN` and `NODE_AUTH_TOKEN`. `setup-node` `registry-url` writes an `.npmrc` that only reads `NODE_AUTH_TOKEN`; `NPM_TOKEN` alone is not enough.
- Tag + GitHub Release **after** successful `npm publish` only. Never tag a version that is not on the registry.
- Catalog auto-commit uses `GITHUB_TOKEN` (or `CATALOG_PUSH_TOKEN` if protection blocks it). Those commits do **not** trigger other workflows, so catalog-sync must publish in the **same job**.
- Human merges to `main` run a separate release job that publishes only if `package.json` version is unpublished (code fixes).
- Cost-only CLI failure still ships (`degraded` only if unmatched placeholder costs remain). Model extract failure → no publish, `catalog-break` issue.
- Runtime catalog stays bundled `models.json`. No GitHub fetch at OpenCode startup.
- Hybrid OpenCode transport stays `@ai-sdk/openai-compatible` + Provider API; this package is the **plugin**, not the SDK `npm` field.

## First publish

Repo has no prior `@brainervirus/...` package. First version is `0.5.0`. Local `npm whoami` is `brainervirus`. After this lands on `main`, cron owns later catalog patches.
