import { expect, test, describe } from "bun:test";
import {
  declaredEntrypoints,
  missingEntrypoints,
  parseTarListing,
  type PackPackageJson,
} from "../../src/pack-contract.ts";

const PUBLISHED: PackPackageJson = {
  main: "dist/index.js",
  types: "dist/index.d.ts",
  exports: {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./server": { types: "./dist/plugin-opencode2.d.ts", import: "./dist/plugin-opencode2.js" },
  },
};

describe("parseTarListing", () => {
  test("strips the package/ prefix and keeps every entry", () => {
    const files = parseTarListing("package/dist/index.js\npackage/models.json\n");
    expect(files).toEqual(["dist/index.js", "models.json"]);
  });

  test("normalizes CRLF output so entrypoints match on Windows", () => {
    const files = parseTarListing("package/dist/index.js\r\npackage/models.json\r\n");
    expect(files).toEqual(["dist/index.js", "models.json"]);
    expect(files).toContain("dist/index.js");
  });
});

describe("declaredEntrypoints", () => {
  test("collects main, types and every exports target without duplicates", () => {
    expect(declaredEntrypoints(PUBLISHED)).toEqual([
      "dist/index.js",
      "dist/index.d.ts",
      "dist/plugin-opencode2.js",
      "dist/plugin-opencode2.d.ts",
    ]);
  });

  test("accepts string exports and bare paths", () => {
    expect(
      declaredEntrypoints({
        main: "./dist/index.js",
        exports: { ".": "./dist/index.js", "./server": "./dist/server.js" },
      }),
    ).toEqual(["dist/index.js", "dist/server.js"]);
  });

  test("returns nothing when package.json declares no entrypoints", () => {
    expect(declaredEntrypoints({})).toEqual([]);
  });
});

describe("missingEntrypoints", () => {
  test("reports a tarball that shipped only TypeScript sources", () => {
    const missing = missingEntrypoints(PUBLISHED, [
      "index.ts",
      "plugin.ts",
      "models.json",
      "manifest.json",
      "package.json",
    ]);
    expect(missing).toContain("dist/index.js");
    expect(missing).toContain("dist/plugin-opencode2.js");
    expect(missing).toHaveLength(4);
  });

  test("reports each entrypoint individually so the error names the gap", () => {
    const missing = missingEntrypoints(PUBLISHED, ["dist/index.js", "dist/index.d.ts"]);
    expect(missing).toEqual(["dist/plugin-opencode2.js", "dist/plugin-opencode2.d.ts"]);
  });

  test("accepts a tarball that ships the whole build", () => {
    expect(missingEntrypoints(PUBLISHED, declaredEntrypoints(PUBLISHED))).toEqual([]);
  });
});
