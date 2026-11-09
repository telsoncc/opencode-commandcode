# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Catalog-only releases after `0.7.1` (the automated `fix(catalog): sync
command-code@X.Y.Z` patch bumps) are documented in their GitHub release notes
instead of here: they only refresh `models.json` and carry no hand-written
entry. See the [releases page](https://github.com/telsoncc/opencode-commandcode/releases)
for the full history.

## [Unreleased]

## [0.7.1] - 2026-08-29

### Changed

- Catalog refresh and post-release manifest PRs auto-merge when required CI is green.

### Fixed

- Startup summary test reads the bundled command-code version from the manifest instead of pinning one release.

## [0.7.0] - 2026-08-28

### Changed

- npm publishes only when plugin or catalog files change since the last tag — CI, tests, and scripts-only merges skip a release.

### Added

- Catalog models include vision vs text-only from the Command Code CLI `inputModalities` field on every SKU. models.dev only adds extra inputs (video/audio/pdf) on matches.

## [0.6.1] - 2026-08-28

### Added

- semantic-release now cuts Keep a Changelog `[Unreleased]` into `## [version]` on publish and includes `CHANGELOG.md` in the post-release sync PR.

### Fixed

- Catalog GitHub release notes table no longer renders a blank header row above Plugin.
- Credits sentence no longer mentions Command Code wiring or restates MIT copyright.

## [0.6.0] - 2026-08-28

### Changed

- Renamed the published package and GitHub repository to `@brainervirus/opencode-commandcode`.

## [0.5.1] - 2026-08-28

### Fixed

- Price Command Code free SKUs at `$0` before models.dev, and fill remaining paid gaps from models.dev.

## [0.5.0] - 2026-08-28

### Added

- GitHub flow: PR-gated `main`, CI matrix (`check (test|typecheck|pack)`), semantic-release on merge, catalog updates as PRs.
- Release notes open with a catalog summary table and collapsed lists of fallback / unpriced models.
- `manifest.json` describing the bundled catalog (status, cost sources, command-code version).
- First publish of `@brainervirus/commandcode-go-opencode-provider`.
- Last-good catalog cache and silent `startup.json` diagnostics under the plugin state dir.

### Fixed

- Load the Command Code model catalog when CLI cost extraction fails (`command-code@1.38.x`).
- Stop plugin `console.log` / `console.warn` from leaking into the OpenCode loading UI.
- Default to bundled `models.json` (no local `command-code` install). Opt-in local scrape via `commandCodePackagePath` or `COMMANDCODE_PACKAGE_PATH`.
- Refresh bundled catalog from `command-code@1.38.1` and fill missing costs from official docs.
