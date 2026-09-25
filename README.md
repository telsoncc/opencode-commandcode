# @telsoncc/opencode-commandcode

[![npm version](https://img.shields.io/npm/v/@telsoncc/opencode-commandcode)](https://www.npmjs.com/package/@telsoncc/opencode-commandcode)
[![CI](https://img.shields.io/github/actions/workflow/status/telsoncc/opencode-commandcode/ci.yml?branch=main&label=CI)](https://github.com/telsoncc/opencode-commandcode/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Command Code](https://commandcode.ai) API provider for [opencode](https://opencode.ai). Use Claude, GPT, Gemini, DeepSeek, Qwen, Kimi, GLM, MiniMax, Step, and other models through a single API key.

This package keeps a **bundled** model catalog current via CI. You do **not** need a local `command-code` CLI. Catalog patches publish automatically after a green PR merges to `main`.

Previously published as `@brainervirus/opencode-commandcode` (and before that `@brainervirus/commandcode-go-opencode-provider`). This fork publishes as `@telsoncc/opencode-commandcode` — use this name instead.

## Credits

This package is based on **[FanFan4204/opencode-commandcode-provider](https://github.com/FanFan4204/opencode-commandcode-provider)**. That work started from **[brent-weatherall/opencode-commandcode-provider](https://github.com/brent-weatherall/opencode-commandcode-provider)** by **[Brent Weatherall](https://github.com/brent-weatherall)**. Thank you both — FanFan for the OpenCode provider this repo continues, and Brent for the original plugin, catalog extraction.

Forked and currently maintained by **[telsoncc](https://github.com/telsoncc)** (OpenCode 2.x support and ongoing catalog updates).

### What this package adds

- Bundled `models.json` is the default runtime catalog (no local CLI scrape).
- CLI cost extraction can fail (as on `command-code@1.38.x`) without dropping models.
- Official docs fill missing costs; remaining paid gaps use [models.dev](https://models.dev) as a reference. Command Code free SKUs stay `$0`.
- Vision vs text-only comes from the Command Code CLI catalog (`inputModalities` on every SKU). [models.dev](https://models.dev) only adds extra inputs (video/audio/pdf) when it matches.
- Reasoning effort **variants** on models that declare `reasoningEfforts`.
- Quiet OpenCode startup (diagnostics go to `startup.json`, not stdout).
- Live catalog refresh on the 2.0 entrypoint: retired models are pruned and
  new ones are published with [models.dev](https://models.dev) estimates
  (marked `(est.)`) until the next catalog sync replaces them.
- Native **OpenCode 2.x** entrypoint (`plugin/opencode2`, also served as `server`):
  in-memory provider inventory via `ctx.provider.transform` (no config writes)
  plus a `commandcode` integration for `/connect`. See `docs/opencode-2.md`.

## Quick Start

Use one entrypoint per host. OpenCode 1.x loads the classic plugin;
OpenCode 2.x loads the 2.0 entrypoint from the same package.

### OpenCode 1.x — install the plugin

```json
{
  "plugin": ["@telsoncc/opencode-commandcode@latest"]
}
```

Pin a version instead of `@latest` if you do not want automatic catalog patches.

`file://` checkouts are **not** updated by npm; `git pull` after CI commits, or switch to the npm plugin line.

### OpenCode 1.x — provider transport (Command Code Provider API)

This plugin supplies model metadata. Point OpenCode at Command Code's documented Provider API:

```json
{
  "plugin": ["@telsoncc/opencode-commandcode@latest"],
  "provider": {
    "commandcode": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Command Code GOAT",
      "env": ["COMMANDCODE_API_KEY"],
      "options": {
        "baseURL": "https://api.commandcode.ai/provider/v1"
      }
    }
  }
}
```

### OpenCode 2.x — install the plugin (no provider block needed)

```jsonc
{
  "plugins": ["@telsoncc/opencode-commandcode"],
}
```

The host resolves the package's `./server` export, which serves the 2.0
entrypoint. (Do not append `/plugin/opencode2` in config: subpaths are
treated as local paths, not npm specifiers.)

The 2.0 entrypoint registers the `commandcode` provider (native
`openai-compatible` runtime, Provider API base URL) and its 71-model catalog
in memory — do **not** keep a hand-written `provider`/`providers.commandcode`
block (including models dumped by `bun run sync -- --update-global`): it
fights the plugin-owned inventory. `sync --update-global` is 1.x-only.
Full guide plus local-clone loading: `docs/opencode-2.md`.

Pin a version instead (`"@telsoncc/opencode-commandcode@<version>"`) if you do not
want automatic catalog patches.

### Connect

Run `/connect` in opencode, search for **Command Code**, and enter your API key, or set `COMMANDCODE_API_KEY`.

### Select a model

```
/models
```

On 2.x the catalog carries no release dates, so filter the picker by provider
**Command Code** if the global list looks empty.

## Live catalog refresh (2.x)

The 2.0 entrypoint re-checks the Provider API (`/models`, no auth) on setup
and every 6h on a process-shared timer:

- ids the API retired are pruned from the inventory;
- ids missing locally are published immediately with
  [models.dev](https://models.dev) cost/capability estimates, named
  `"<model> (est.)"`, and replaced by exact data on the next catalog sync;
- ids with no estimable data stay reported (not published) until the sync.

Estimates are list prices, close to but not equal to Command Code billing.
`startup.json` records `catalogSource: "remote"`, `pendingNewCount`, and
`estimatedCount`. Opt out with `disableModelSync: true` in
`~/.config/opencode/opencode-commandcode.json`.

## Optional local CLI override

Maintainers only. OpenCode will scrape a local `command-code` install when `COMMANDCODE_PACKAGE_PATH` or `commandCodePackagePath` in `~/.config/opencode/opencode-commandcode.json` is set.

## Development

```bash
git clone https://github.com/telsoncc/opencode-commandcode.git
cd opencode-commandcode
bun install
bun run check            # oxlint + oxfmt + bun test + tsc (same stack as workit)
```

```bash
bun run sync -- --remote  # refresh models.json + manifest.json from command-code@latest
```

CI (`.github/workflows/catalog-sync.yml`) opens a PR every 6 hours when Command Code ships a new catalog. That PR, and the post-release `chore/manifest-sync-v*` PR, auto-merge after **check (test)**, **check (typecheck)**, **check (lint)**, **check (format)**, and **check (pack)** are green. `.github/workflows/release.yml` then runs **semantic-release** (npm publish + GitHub Release + tag). Do not push to `main`.

The GitHub Actions secret name is `NPMJS` (same as workit). It is mapped to both `NPM_TOKEN` and `NODE_AUTH_TOKEN`. Use an npm **Automation** token (bypasses 2FA). A login token from `~/.npmrc` fails CI with `EOTP`. Catalog PRs get a real CI run when `RELEASE_SYNC_TOKEN` (or `CATALOG_PUSH_TOKEN`) is a PAT; `GITHUB_TOKEN` can open the PR but GitHub will not start workflows from that event.

## License

MIT — see [LICENSE](LICENSE). Original copyright [Brent Weatherall](https://github.com/brent-weatherall); modifications copyright [telsoncc](https://github.com/telsoncc).
