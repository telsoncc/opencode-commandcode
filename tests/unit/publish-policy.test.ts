import { expect, test, describe } from "bun:test";
import { decideCatalogSync, decidePublish } from "../../src/publish-policy.ts";

describe("decideCatalogSync", () => {
  test("extracts when force is true even if versions match", () => {
    expect(
      decideCatalogSync({
        force: true,
        latestCommandCodeVersion: "1.38.1",
        bundledCommandCodeVersion: "1.38.1",
        pluginVersion: "0.5.0",
        publishedPluginVersions: ["0.5.0"],
      }),
    ).toEqual({ extract: true, publishRetry: false, exit: false });
  });

  test("extracts when command-code latest differs from the bundle", () => {
    expect(
      decideCatalogSync({
        force: false,
        latestCommandCodeVersion: "1.39.0",
        bundledCommandCodeVersion: "1.38.1",
        pluginVersion: "0.5.0",
        publishedPluginVersions: ["0.5.0"],
      }),
    ).toEqual({ extract: true, publishRetry: false, exit: false });
  });

  test("skips extraction and retries publish when the plugin version is unpublished", () => {
    expect(
      decideCatalogSync({
        force: false,
        latestCommandCodeVersion: "1.38.1",
        bundledCommandCodeVersion: "1.38.1",
        pluginVersion: "0.5.0",
        publishedPluginVersions: [],
      }),
    ).toEqual({ extract: false, publishRetry: true, exit: false });
  });

  test("exits when command-code is unchanged and the plugin version is already on npm", () => {
    expect(
      decideCatalogSync({
        force: false,
        latestCommandCodeVersion: "1.38.1",
        bundledCommandCodeVersion: "1.38.1",
        pluginVersion: "0.5.0",
        publishedPluginVersions: ["0.5.0"],
      }),
    ).toEqual({ extract: false, publishRetry: false, exit: true });
  });
});

describe("decidePublish", () => {
  test("publishes when the version is unpublished and a token is set", () => {
    expect(
      decidePublish({
        pluginVersion: "0.5.0",
        publishedPluginVersions: [],
        npmTokenSet: true,
      }),
    ).toBe("publish");
  });

  test("skips when the token is missing", () => {
    expect(
      decidePublish({
        pluginVersion: "0.5.0",
        publishedPluginVersions: [],
        npmTokenSet: false,
      }),
    ).toBe("skip-no-token");
  });

  test("skips when the version is already on npm", () => {
    expect(
      decidePublish({
        pluginVersion: "0.5.0",
        publishedPluginVersions: ["0.5.0"],
        npmTokenSet: true,
      }),
    ).toBe("skip-already-published");
  });
});
