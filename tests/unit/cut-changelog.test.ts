import { expect, test, describe } from "bun:test";
import { cutKeepAChangelog } from "../../src/cut-changelog.ts";

const HEADER = `# Changelog

All notable changes to this project will be documented in this file.

`;

describe("cutKeepAChangelog", () => {
  test("moves Unreleased body under the new version and leaves Unreleased empty", () => {
    const before = `${HEADER}## [Unreleased]

### Added

- New thing.

## [0.5.0] - 2026-08-01

### Fixed

- Old thing.
`;
    const after = cutKeepAChangelog(before, "0.6.0", "2026-08-28");
    expect(after).toContain("## [Unreleased]\n\n## [0.6.0] - 2026-08-28\n");
    expect(after).toContain("### Added\n\n- New thing.\n");
    expect(after.indexOf("## [0.6.0]")).toBeLessThan(after.indexOf("## [0.5.0]"));
    expect(after.indexOf("- New thing.")).toBeGreaterThan(after.indexOf("## [0.6.0]"));
    expect(after.indexOf("- New thing.")).toBeLessThan(after.indexOf("## [0.5.0]"));
  });

  test("is a no-op when the version heading already exists", () => {
    const already = `${HEADER}## [Unreleased]

## [0.6.0] - 2026-08-28

### Added

- Already cut.
`;
    expect(cutKeepAChangelog(already, "0.6.0", "2026-08-29")).toBe(already);
  });
});
