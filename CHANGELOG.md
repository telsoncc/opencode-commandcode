# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.6] - 2026-09-24

## [1.0.5] - 2026-09-24

## [1.0.4] - 2026-09-23

## [1.0.3] - 2026-09-22

## [1.0.2] - 2026-09-22

## [1.0.1] - 2026-09-21

## [1.0.0] - 2026-09-21

## [0.7.73] - 2026-09-21

## [0.7.72] - 2026-09-20

## [0.7.71] - 2026-09-19

## [0.7.70] - 2026-09-19

## [0.7.69] - 2026-09-18

## [0.7.68] - 2026-09-18

## [0.7.67] - 2026-09-18

## [0.7.66] - 2026-09-17

## [0.7.65] - 2026-09-16

## [0.7.64] - 2026-09-16

## [0.7.63] - 2026-09-14

## [0.7.62] - 2026-09-12

## [0.7.61] - 2026-09-10

## [0.7.60] - 2026-09-09

## [0.7.59] - 2026-09-09

## [0.7.58] - 2026-09-09

## [0.7.57] - 2026-09-08

## [0.7.56] - 2026-09-08

## [0.7.55] - 2026-09-06

## [0.7.54] - 2026-09-05

## [0.7.53] - 2026-09-05

## [0.7.52] - 2026-09-04

## [0.7.51] - 2026-09-04

## [0.7.50] - 2026-09-03

## [0.7.49] - 2026-09-03

## [0.7.48] - 2026-09-02

## [0.7.47] - 2026-09-02

## [0.7.46] - 2026-09-02

## [0.7.45] - 2026-09-02

## [0.7.44] - 2026-09-02

## [0.7.43] - 2026-09-02

## [0.7.42] - 2026-09-02

## [0.7.41] - 2026-09-02

## [0.7.40] - 2026-09-02

## [0.7.39] - 2026-09-02

## [0.7.38] - 2026-09-02

## [0.7.37] - 2026-09-02

## [0.7.36] - 2026-09-02

## [0.7.35] - 2026-09-02

## [0.7.34] - 2026-09-02

## [0.7.33] - 2026-09-02

## [0.7.32] - 2026-09-02

## [0.7.31] - 2026-09-02

## [0.7.30] - 2026-09-02

## [0.7.29] - 2026-09-02

## [0.7.28] - 2026-09-02

## [0.7.27] - 2026-09-02

## [0.7.26] - 2026-09-02

## [0.7.25] - 2026-09-02

## [0.7.24] - 2026-09-02

## [0.7.23] - 2026-09-02

## [0.7.21] - 2026-09-02

## [0.7.20] - 2026-09-02

## [0.7.19] - 2026-09-02

## [0.7.18] - 2026-09-02

## [0.7.17] - 2026-09-02

## [0.7.16] - 2026-09-02

## [0.7.15] - 2026-09-02

## [0.7.14] - 2026-09-02

## [0.7.13] - 2026-09-02

## [0.7.12] - 2026-09-02

## [0.7.11] - 2026-09-02

## [0.7.10] - 2026-09-02

## [0.7.9] - 2026-09-02

## [0.7.8] - 2026-09-02

## [0.7.7] - 2026-09-02

## [0.7.6] - 2026-09-02

## [0.7.5] - 2026-09-02

## [0.7.4] - 2026-09-01

## [0.7.3] - 2026-09-01

## [0.7.2] - 2026-08-31

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
