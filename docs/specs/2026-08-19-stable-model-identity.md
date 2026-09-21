# Command Code OpenCode Provider — Stable Identity and Runtime Resilience

Status: draft (updated 2026-08-28)

## Goal

Keep Command Code working reliably in OpenCode while preserving user model preferences (favorites, recents, variants) across plugin startups.

This spec covers:
- Stable model identity for persistence
- Safe handling of renamed/removed models
- Multiple active model flavors shown as separate entries
- Optional `(new)` UI labeling
- **Runtime resilience against Command Code release drift**
- **Non-blocking startup (no leaked loading output into OpenCode UI)**
- **Reasoning metadata and reasoning trace compatibility**

## Current Breakage (verified 2026-08-28)

Observed on local machine with:
- OpenCode 1.18.x
- `command-code@1.37.0` (global) / `@1.38.0` (latest npm)
- Hybrid config: FanFan plugin for metadata + `@ai-sdk/openai-compatible` for inference

### Root cause 1: catalog extraction hard-fails on newer Command Code

`loadCatalogFromLocalCommandCode()` currently returns `null` when **cost extraction** fails, even if model catalog extraction succeeds.

Verified on `command-code@1.38.0`:
- model catalog extraction: **success** (~65 models)
- cost extraction: **fail** (`Could not evaluate cost data map`)
- net result: plugin treats catalog as unavailable

Impact:
- plugin falls back to bundled `models.json` (stale, `_version.txt` = `1.1.0`)
- reasoning efforts/variants missing or wrong
- favorites appear broken when model IDs no longer match current catalog
- connect may appear broken because provider metadata is incomplete/outdated

### Root cause 2: startup output leaks into OpenCode loading UI

Plugin currently uses `console.log` / `console.warn` during `config` hook:
- `[commandcode] Loaded N models from ...`
- version update warnings

OpenCode startup surfaces plugin stdout/stderr in loading UI. This is useful for debugging but unacceptable as default UX.

### Root cause 3: reasoning traces vs reasoning metadata are conflated

Hybrid transport (`@ai-sdk/openai-compatible` → `/provider/v1/chat/completions`) and native transport (`/alpha/generate` with custom stream parser) behave differently.

Two separate features must be specified:
1. **Reasoning metadata** (model capabilities + effort variants for `/models`, `Ctrl+T`)
2. **Reasoning traces** (streamed thinking content shown in session UI)

Using openai-compatible transport can preserve effort selection while **not** guaranteeing reasoning trace rendering unless stream parts are mapped correctly.

## Problem (persistence)

OpenCode persists model state in `~/.local/state/opencode/model.json` using exact tuples:
- `favorite[]`: `{ providerID, modelID }`
- `recent[]`: `{ providerID, modelID }`
- `variant{}` keyed by `providerID/modelID`

If model IDs drift between startups, persisted entries no longer match `provider.models[modelID]`.

## Non-Goals

- Do not change OpenCode core behavior.
- Do not use fuzzy name matching to migrate IDs.
- Do not auto-delete user favorites when a model disappears.
- Do not use undocumented `/alpha/generate` as default transport (GOAT must stay on documented Provider API).

## Design Overview

Introduce a deterministic catalog reconciliation pipeline:

1. Load bundled `models.json` (CI-synced; primary runtime source). No local `command-code` install required.
2. Optionally enrich with Provider API `/v1/models` (availability/context).
3. Resolve costs with the CI waterfall (CLI → official docs → optional trusted API → hardcoded last). **Never fail catalog load because costs are missing.** Runtime uses whatever costs were bundled; it does not fetch prices at OpenCode startup.
4. Optional maintainer override: extract from a local `command-code` package only when `commandCodePackagePath` or `COMMANDCODE_PACKAGE_PATH` is set.
5. Apply explicit alias mappings for known renames.
6. Preserve distinct active flavors as separate models.
7. Migrate local model state with safe, idempotent rules.
8. Run startup work asynchronously/non-blocking; log to plugin diagnostics channel, not stdout by default.

ponytail: cost parsing is optional enrichment; model catalog is the hard requirement. Local CLI scrape is opt-in, not the default path.

## Command Code Compatibility Policy

### Supported extraction contract

The plugin must treat these as independent subsystems:
- `modelCatalog`: required
- `costCatalog`: optional
- `providerApiModels`: optional

Failure matrix:

| Subsystem failure | Required behavior |
|---|---|
| bundled `models.json` missing/corrupt | last-good cache if present; else empty models map; auth/connect still works |
| costCatalog missing after full waterfall | continue with hardcoded fallback for those models; `degraded=true` |
| provider API fails | continue with bundled catalog only |
| opt-in local extract fails | ignore override; use bundled catalog |
| all sources fail | provider still registers; auth/connect works; models list may be empty |

### Version tracking

Track and log:
- bundled `commandCodeVersion` from `manifest.json` (not a local CLI version)
- catalog model count
- reasoning-capable model count
- source used (`bundled`, `cache`, `opt-in-local`, `mixed`)

CI automation (see [2026-08-28-ci-catalog-automation.md](./2026-08-28-ci-catalog-automation.md)) watches `command-code@latest` and syncs `models.json`. When `NPM_TOKEN` is set it also publishes plugin patches. Users do **not** need local `command-code` or `bun run sync`.

### Pinning guidance for users

Document recommended install:
- after first npm publish: `"plugin": ["@brainervirus/commandcode-go-opencode-provider@latest"]` (or pin)
- until then: `file://` checkout (no auto-update; `git pull` after CI/catalog commits)
- no local `command-code` required for catalog updates
- if startup degraded, update the plugin package (or pull this repo); do not install the CLI as a fix
- local `command-code` scrape remains opt-in via `commandCodePackagePath`

## Identity Rules

### 1) Canonical ID

Each model entry has:
- `canonicalId`: stable persistence identity (string)
- `providerModelId`: current API request ID (string)

In most cases these are equal.

Canonical ID authority order (deterministic):
1. Explicit alias resolution target (if legacy ID mapped)
2. Bundled catalog ID (`models.json`)
3. Opt-in local `command-code` extracted ID (only when override is enabled)
4. Provider API ID (`/provider/v1/models`)

Conflict rule:
- If bundled catalog and API disagree on ID shape in one startup, prefer bundled ID and record API ID as `providerModelId`.
- Never rewrite `canonicalId` based only on display name changes.

### 2) Stable Key in OpenCode Model Map

The key used in `provider.commandcode.models` must be stable and derived from `canonicalId`.

Rule:
- `modelKey = canonicalId.toLowerCase()`
- keep `/` segments (do not shorten to suffix-only keys)

Example:
- `deepseek/deepseek-v4-flash` stays `deepseek/deepseek-v4-flash`

### 3) Flavors Stay Separate

If two models have different `canonicalId`s and both are callable, both remain visible as standalone entries, even if display names are similar.

Display disambiguation rule for active same-name models:
- append stable suffix (display-only):
  - preferred: `(<providerModelId suffix>)`
  - fallback: `(<canonicalId suffix>)`

## Rename and Alias Policy

### Alias Table

```ts
type AliasMap = Record<string, string>
// legacyId -> canonicalId
```

Constraints:
- exact-string matches only
- provider-aware where needed
- no regex/fuzzy behavior
- versioned and reviewed in-repo

Lifecycle policy:
- aliases append-only by default
- removal only after one minor release cycle with zero unresolved migration hits
- each alias entry documents source/reason/first plugin version

### Alias Application

When a legacy ID exists in user state:
- if exactly one canonical target is mapped and exists, migrate it
- if target does not exist, keep original entry and mark unresolved in logs
- if ambiguous, skip migration and log warning

## Removed Model Policy

If a favorited model no longer exists in current catalog:
- keep it in state (do not delete automatically)
- surface as unresolved in startup summary
- unresolved entries must never block plugin startup

## New Model Labeling

Support metadata tags without changing identity:
- `isNew: boolean`
- `firstSeenAt` timestamp in plugin-managed metadata file

Behavior:
- `isNew=true` for models first seen within configurable window (default 14 days)
- append ` (new)` to display name only

Metadata reset behavior:
- if metadata file missing/corrupt, rebuild from current catalog
- mark only unknown entries as new from rebuild time
- do not mark all models as new when backup exists

## Startup Lifecycle (must not leak into OpenCode loading UI)

### Requirements

1. `config` hook must return quickly; heavy work should be deferrable/non-blocking where OpenCode allows.
2. Default logging target is plugin diagnostics (structured), **not stdout/stderr**.
3. `console.log`/`console.warn` in startup path are forbidden unless `debugStartupLogs=true`.
4. Version check (`npm latest`) must never block model registration.
5. Provider auth/connect registration must succeed even when catalog is degraded.

### Startup phases

1. **Register auth/connect immediately** (always).
2. **Load catalog** (best effort, bounded timeout).
3. **Apply alias migration** to `model.json` (optional, safe).
4. **Publish startup summary** to diagnostics channel.

### Degraded mode UX

When degraded:
- show one concise warning in diagnostics (not repeated per startup line)
- include actionable hint: update the plugin npm package (or `git pull` if using `file://`); do not tell users to install `command-code` locally
- keep previously working favorites if IDs still resolvable

## Reasoning Support

### A) Reasoning metadata (required)

For each model with `reasoningEfforts` in Command Code catalog:
- set `reasoning: true`
- generate OpenCode variants:
  - `variants[effort] = { reasoningEffort: effort }`

If catalog extraction fails and fallback catalog lacks efforts, mark model as reasoning-capable only when explicitly known; do not invent effort levels.

### B) Reasoning traces (stream content)

Define transport capability explicitly:

| Transport | Endpoint | Effort param | Reasoning trace rendering |
|---|---|---|---|
| Hybrid (`@ai-sdk/openai-compatible`) | `/provider/v1/chat/completions` | via `reasoning_effort` | depends on OpenCode + SDK stream mapping |
| Native provider adapter | `/alpha/generate` | custom request builder | full reasoning-delta mapping in plugin |

Policy:
- GOAT production default remains hybrid/documented Provider API.
- Reasoning trace gaps in hybrid mode are treated as **compatibility limitations**, not silent success.
- Plugin must expose capability flag per transport in startup summary:
  - `reasoningVariants: true/false`
  - `reasoningTraceStreaming: supported|limited|unsupported`

Acceptance for hybrid:
- effort cycling works for models with declared efforts
- if trace parts are absent, UI may show no thinking block (expected limitation unless stream adapter added)

Future optional enhancement (out of initial scope):
- add Provider-API-compatible stream adapter that maps reasoning chunks without switching to `/alpha/generate`.

## State Migration

### Files

OpenCode state file:
- `~/.local/state/opencode/model.json`

Backup file:
- `~/.local/state/opencode/model.json.bak`

Path fallback:
- resolve via OpenCode runtime state directory when available
- fallback `~/.local/state/opencode/model.json`
- if unreadable/unwritable: skip migration, continue startup

### Migration scope

- `favorite[]`
- `recent[]`
- `variant{}` keys

### Migration safety rules

1. backup once before first write
2. rewrite only deterministic alias mappings
3. never drop unknown entries
4. atomic write
5. idempotent
6. migration errors never fail plugin startup

## Logging and Observability

Startup summary fields:
- `catalogSource` (`bundled|cache|opt-in-local|mixed`)
- `commandCodeVersion`
- `modelCount`
- `reasoningModelCount`
- `migratedCount`
- `unresolvedCount`
- `ambiguousCount`
- `newModelCount`
- `degraded` (boolean)
- `degradedReason` (string|null)
- `reasoningVariantsEnabled`
- `reasoningTraceMode` (`supported|limited|unsupported`)

Warn-level diagnostics for:
- ambiguous alias target
- alias target missing
- state file I/O skipped
- modelCatalog extraction failure
- costCatalog extraction failure (non-fatal)

## Config Flags

`~/.config/opencode/commandcode-go-opencode-provider.json`:

```json
{
  "enableStateMigration": true,
  "enableNewBadge": true,
  "newBadgeDays": 14,
  "migrationReadOnlyOnError": true,
  "debugStartupLogs": false,
  "startupCatalogTimeoutMs": 5000,
  "commandCodePackagePath": null
}
```

Defaults:
- migration: `true`
- new badge: `true`
- new badge window: `14`
- read-only on migration error: `true`
- debug startup logs: `false`
- startup catalog timeout: `5000`
- commandCodePackagePath: unset (bundled catalog; local CLI scrape is opt-in)

Costless catalog is always on at **runtime** (do not block OpenCode on prices). CI still tries to fill costs via the waterfall in [2026-08-28-ci-catalog-automation.md](./2026-08-28-ci-catalog-automation.md) before shipping the bundle.

## Related Specs

- [2026-08-28-ci-catalog-automation.md](./2026-08-28-ci-catalog-automation.md) — CI sync, npm auto-release, catalog-break issues

## Implementation Plan

Locked order (this spec + CI spec). Do not ship identity key changes before a current catalog is bundled.

### Phase 1 — unblock startup and catalog (priority)

1. Split catalog loader: model catalog required, cost optional (always).
2. Refresh committed `models.json` from latest `command-code` tarball plus official-docs cost fill (one-shot sync so bundled catalog is not `_version.txt` 1.1.0).
3. Add last-good catalog cache file in plugin state dir.
4. Remove stdout startup logs; route to diagnostics.
5. Ensure auth/connect registers before catalog finishes.
6. Add startup summary + degraded mode.
7. Default runtime source = bundled catalog; local CLI scrape only when override is set.

CI automation after Phase 1: [2026-08-28-ci-catalog-automation.md](./2026-08-28-ci-catalog-automation.md) Phases B–D.

### Phase 2 — identity persistence

1. Add `canonicalId` + stable key generation (`canonicalId.toLowerCase()`, keep `/`).
2. Ship alias map **including current `toConfigKey()` suffix-only keys → slash-qualified keys** so existing favorites survive the key-format change.
3. Add state migrator, flavor disambiguation, and `(new)` badge logic.

### Phase 3 — reasoning trace clarity

1. Document and test hybrid reasoning variant forwarding.
2. Add explicit `reasoningTraceMode` reporting.
3. Evaluate optional Provider-API stream adapter (only if needed).

## Test Plan

### Unit

- model catalog succeeds when cost extraction fails (1.38 fixture)
- degraded mode falls back to cache, then bundled models
- no stdout logs unless `debugStartupLogs=true`
- stable key generation preserves slash-qualified IDs
- alias migration idempotency
- same-name flavors remain separate with deterministic display suffix

### Integration

- OpenCode startup **without** a local `command-code` install registers provider and connect flow from bundled catalog
- `/models` includes current models with reasoning variants when the bundle has `reasoningEfforts`
- favorites persist across restart when alias mapping exists (including suffix-only → slash-qualified)
- hybrid request includes `reasoning_effort` for selected variant
- startup UI does not show plugin loading spam

## Risks and Mitigations

- Command Code bundle format drift  
  Mitigation: CI against latest tarball + costless catalog path.

- Incorrect alias migration  
  Mitigation: exact-only aliases + unresolved fallback + `.bak`.

- Reasoning trace expectation mismatch in hybrid mode  
  Mitigation: explicit capability reporting; docs state limitation clearly.

- Stale bundled fallback (`models.json`)  
  Mitigation: CI npm patch from latest tarball; last-good cache only if the installed bundle is corrupt. `file://` installs do not auto-update — git pull or switch to npm.

## Acceptance Criteria

- Plugin startup never hard-fails due to cost extraction regression in new Command Code releases.
- OpenCode loading UI is not polluted by plugin stdout logs by default.
- Connect/auth works even in degraded catalog mode.
- Favorites/recents/variants survive restarts for mapped IDs.
- Multiple active flavors remain standalone and selectable.
- Reasoning effort variants appear when the bundled catalog provides `reasoningEfforts`.
- Spec clearly distinguishes reasoning variants vs reasoning trace streaming behavior.
- Existing favorites using suffix-only keys migrate via explicit aliases when slash-qualified keys ship.
