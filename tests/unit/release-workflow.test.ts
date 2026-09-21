import { expect, test, describe } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "os";
import { join } from "path";
import { buildManifest, withPluginVersion } from "../../src/manifest.ts";

const buildManifestForVersion = (pluginVersion: string) =>
  buildManifest({
    pluginVersion,
    commandCodeVersion: "1.38.1",
    commandCodeTarball: "https://registry.npmjs.org/command-code/-/command-code-1.38.1.tgz",
    modelCount: 2,
    reasoningModelCount: 1,
    modelCatalogOk: true,
    costSources: { cli: 2, officialDocs: 0, thirdParty: 0, free: 0, fallback: 0, unmatched: 0 },
    generatedAt: "2026-08-28T17:00:00.000Z",
  });

const ROOT = join(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");
const json = <T>(rel: string) => JSON.parse(read(rel)) as T;

const NPMJS = "${{ secrets.NPMJS }}";

describe("CHANGELOG.md", () => {
  test("records shipped versions under Keep a Changelog headings", () => {
    const log = read("CHANGELOG.md");
    expect(log).toContain("## [Unreleased]");
    expect(log).toContain("## [0.6.1]");
    expect(log).toContain("## [0.6.0]");
    expect(log).toContain("## [0.5.1]");
    expect(log).toContain("## [0.5.0]");
  });
});

describe("README credits", () => {
  test("does not restate Command Code wiring or MIT copyright in the thanks sentence", () => {
    const readme = read("README.md");
    expect(readme).toContain("Brent for the original plugin, catalog extraction.");
    expect(readme).not.toContain(
      "and Command Code wiring. The license remains MIT; copyright stays with Brent Weatherall.",
    );
  });
});

describe("package.json publish identity", () => {
  test("is the scoped public package on telsoncc/opencode-commandcode", () => {
    const pkg = json<{
      name: string;
      publishConfig?: { access?: string };
      repository?: { url?: string };
      bugs?: { url?: string };
      homepage?: string;
      files?: string[];
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>("package.json");
    expect(pkg.name).toBe("@telsoncc/opencode-commandcode");
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.repository?.url).toContain("telsoncc/opencode-commandcode");
    expect(pkg.bugs?.url).toContain("telsoncc/opencode-commandcode");
    expect(pkg.homepage).toContain("telsoncc/opencode-commandcode");
    expect(pkg.files).toContain("manifest.json");
    expect(pkg.scripts?.["verify:release-candidate"]).toContain("verify-release-candidate.ts");
    expect(pkg.scripts?.lint).toContain("oxlint --deny-warnings");
    expect(pkg.scripts?.format).toContain("oxfmt");
    expect(pkg.scripts?.["format:check"]).toContain("oxfmt --check");
    expect(pkg.scripts?.check).toContain("format:check");
    expect(pkg.devDependencies?.["@semantic-release/exec"]).toBeDefined();
    expect(pkg.devDependencies?.["@semantic-release/commit-analyzer"]).toBeUndefined();
  });
});

describe("ci.yml", () => {
  test("exposes named check jobs on pull requests to main", () => {
    const wf = Bun.YAML.parse(read(".github/workflows/ci.yml")) as {
      on: { pull_request?: { branches?: string[] }; push?: { branches?: string[] } };
      jobs: Record<string, { name?: string; steps: Array<{ run?: string }> }>;
    };
    expect(wf.on.pull_request?.branches).toContain("main");
    expect(wf.on.push?.branches).toContain("main");
    expect(wf.jobs.test.name).toBe("check (test)");
    expect(wf.jobs.typecheck.name).toBe("check (typecheck)");
    expect(wf.jobs.pack.name).toBe("check (pack)");
    expect(wf.jobs.lint.name).toBe("check (lint)");
    expect(wf.jobs.format.name).toBe("check (format)");
    const blob = Object.values(wf.jobs)
      .flatMap((j) => j.steps.map((s) => s.run ?? ""))
      .join("\n");
    expect(blob).toContain("bun test tests/unit/");
    expect(blob).toContain("bun run typecheck");
    expect(blob).toContain("verify:release-candidate");
    expect(blob).toContain("bun run lint");
    expect(blob).toContain("bun run format:check");
    expect(blob).not.toMatch(/\bnpm publish\b/);
    expect(blob).not.toContain("semantic-release");
  });
});

describe("release.yml", () => {
  test("runs semantic-release on main with the workit npm token mapping", () => {
    const wf = Bun.YAML.parse(read(".github/workflows/release.yml")) as {
      on: { push?: { branches?: string[] } };
      jobs: {
        release: {
          name?: string;
          steps: Array<{
            name?: string;
            uses?: string;
            with?: Record<string, string>;
            run?: string;
            env?: Record<string, string>;
          }>;
        };
      };
    };
    expect(wf.on.push?.branches).toContain("main");
    expect(wf.jobs.release.name).toBe("semantic-release");
    const setupNode = wf.jobs.release.steps.find((s) => s.uses?.startsWith("actions/setup-node"));
    expect(setupNode?.with?.["registry-url"]).toBe("https://registry.npmjs.org");
    const names = wf.jobs.release.steps.map((s) => s.name ?? "");
    expect(names.indexOf("Verify release candidate")).toBeGreaterThan(-1);
    expect(names.indexOf("Release")).toBeGreaterThan(names.indexOf("Verify release candidate"));
    expect(names.indexOf("Sync release manifests to main")).toBeGreaterThan(
      names.indexOf("Release"),
    );
    const release = wf.jobs.release.steps.find((s) => s.name === "Release");
    expect(release?.run).toContain("npx semantic-release");
    expect(release?.env?.NPM_TOKEN).toBe(NPMJS);
    expect(release?.env?.NODE_AUTH_TOKEN).toBe(NPMJS);
    const blob = wf.jobs.release.steps.map((s) => s.run ?? "").join("\n");
    expect(blob).not.toContain("publish-if-needed");
    const sync = wf.jobs.release.steps.find((s) => s.name === "Sync release manifests to main");
    expect(sync?.run).toContain("CHANGELOG.md");
    expect(sync?.run).toMatch(/git add package\.json manifest\.json CHANGELOG\.md/);
    expect(sync?.run).toContain("gh pr merge --auto --squash --delete-branch");
    expect(sync?.run).not.toContain("auto-merge unavailable");
    expect(sync?.run).not.toMatch(/\|\|\s*echo/);
  });
});

describe("catalog-sync.yml", () => {
  test("opens a catalog PR and does not publish", () => {
    const wf = Bun.YAML.parse(read(".github/workflows/catalog-sync.yml")) as {
      on: {
        schedule?: Array<{ cron: string }>;
        workflow_dispatch?: { inputs?: { force?: unknown } };
      };
      jobs: {
        sync: {
          name?: string;
          steps: Array<{ name?: string; run?: string; env?: Record<string, string> }>;
        };
      };
    };
    expect(wf.on.schedule?.[0]?.cron).toBe("0 */6 * * *");
    expect(wf.on.workflow_dispatch?.inputs?.force).toBeDefined();
    expect(wf.jobs.sync.name).toBe("catalog-pr");
    const blob = wf.jobs.sync.steps
      .map((s) => `${s.run ?? ""}\n${JSON.stringify(s.env ?? {})}`)
      .join("\n");
    expect(blob).toContain("catalog-sync-ci.ts");
    expect(read("scripts/catalog-sync-ci.ts")).toContain(
      "gh pr merge --auto --squash --delete-branch",
    );
    expect(blob).not.toMatch(/\bnpm publish\b/);
    expect(blob).not.toContain("semantic-release");
    expect(blob).not.toContain("publish-if-needed");
  });

  test("creates the catalog-break labels before syncing so break issues never fail", () => {
    const wf = Bun.YAML.parse(read(".github/workflows/catalog-sync.yml")) as {
      jobs: { sync: { steps: Array<{ name?: string; run?: string }> } };
    };
    const labelStep = wf.jobs.sync.steps.find((s) => s.name === "Ensure automation labels");
    expect(labelStep).toBeDefined();
    const run = labelStep!.run ?? "";
    expect(run).toContain("gh label create catalog-break");
    expect(run).toContain("gh label create automation");
    expect(run).toContain("--force");
    // must run before the sync step that opens break issues
    const steps = wf.jobs.sync.steps;
    expect(steps.findIndex((s) => s.name === "Ensure automation labels")).toBeLessThan(
      steps.findIndex((s) => (s.run ?? "").includes("catalog-sync-ci.ts")),
    );
  });
});

describe("release.config.cjs", () => {
  test("publishes the root package then GitHub Release", () => {
    const cfg = read("release.config.cjs");
    expect(cfg).toContain("@semantic-release/exec");
    expect(cfg).toContain("analyzeCommitsCmd");
    expect(cfg).toContain("scripts/analyze-release-scope.ts");
    expect(cfg).not.toContain("@semantic-release/commit-analyzer");
    expect(cfg).toContain("./scripts/semantic-release-catalog-notes.cjs");
    expect(cfg).toContain("./scripts/semantic-release-changelog.cjs");
    expect(cfg).toContain("@semantic-release/npm");
    expect(cfg).toContain("@semantic-release/github");
    expect(cfg.indexOf("@semantic-release/exec")).toBeLessThan(
      cfg.indexOf("semantic-release-catalog-notes.cjs"),
    );
    expect(cfg.indexOf("prepare-release-manifest")).toBeGreaterThan(
      cfg.indexOf("@semantic-release/exec"),
    );
    expect(cfg.lastIndexOf("@semantic-release/npm")).toBeGreaterThan(
      cfg.indexOf("prepare-release-manifest"),
    );
    expect(cfg.lastIndexOf("@semantic-release/github")).toBeGreaterThan(
      cfg.lastIndexOf("@semantic-release/npm"),
    );
  });

  test("sets the manifest version from nextRelease before packing", () => {
    const cfg = read("release.config.cjs");
    expect(cfg).toContain("prepare-release-manifest");
    expect(cfg).toContain("nextRelease.version");
    expect(cfg).toContain("prepareCmd");
  });
});

describe("prepare-release-manifest.ts", () => {
  test("sets only pluginVersion from the release version", () => {
    expect(read("scripts/prepare-release-manifest.ts")).toContain("withPluginVersion");
    const manifest = buildManifestForVersion("0.5.0");
    const updated = withPluginVersion(manifest, "0.6.0");
    expect(updated.pluginVersion).toBe("0.6.0");
    expect(updated.modelCount).toBe(manifest.modelCount);
  });
});

describe("verify-manifest-version.ts", () => {
  test("exits non-zero for mismatched versions and zero for equal versions", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-mmv-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ pluginVersion: "9.9.9" }));
      expect(spawnSync("bun", ["run", "scripts/verify-manifest-version.ts", dir]).status).not.toBe(
        0,
      );
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ pluginVersion: "1.0.0" }));
      const ok = spawnSync("bun", ["run", "scripts/verify-manifest-version.ts", dir], {
        encoding: "utf-8",
      });
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("1.0.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(json<{ scripts?: Record<string, string> }>("package.json").scripts?.prepack).toContain(
      "verify-manifest-version",
    );
  });
});

describe("semantic-release-catalog-notes.cjs", () => {
  test("passes nextRelease.version into the catalog notes script", () => {
    const src = read("scripts/semantic-release-catalog-notes.cjs");
    expect(src).toContain("nextRelease");
    expect(src).toContain("catalog-release-notes.ts");
  });
});

describe("verify-release-candidate.ts", () => {
  test("is pack-only", () => {
    const src = read("scripts/verify-release-candidate.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).toContain("npm pack");
    expect(src).not.toMatch(
      /\b(?:npm|npx|bun)\s+(?:publish|login|adduser)\b|\bgit\s+(?:push|tag)\b/,
    );
  });

  test("rejects a packed manifest whose pluginVersion differs from package.json", () => {
    const src = read("scripts/verify-release-candidate.ts");
    expect(src).toContain("pluginVersion");
    const packed = JSON.parse(read("manifest.json")) as { pluginVersion?: string };
    expect(packed.pluginVersion).toBe(
      (JSON.parse(read("package.json")) as { version: string }).version,
    );
  });
});
