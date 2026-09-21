import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeReleaseScope, latestTag } from "../../scripts/analyze-release-scope.ts";

type Repo = {
  root: string;
  cleanup(): void;
  commit(msg: string, files: Record<string, string>): void;
  tag(name: string): void;
};

function repo(): Repo {
  const root = mkdtempSync(path.join(os.tmpdir(), "cc-relscope-"));
  const g = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.name", "t"]);
  g(["config", "user.email", "t@t"]);
  writeFileSync(path.join(root, "seed.md"), "seed\n");
  g(["add", "-A"]);
  g(["commit", "-q", "-m", "chore: seed"]);
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    commit: (msg, files) => {
      for (const [rel, body] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), body);
      }
      g(["add", "-A"]);
      g(["commit", "-q", "-m", msg]);
    },
    tag: (name) => g(["tag", name]),
  };
}

describe("latestTag", () => {
  test("returns the newest semver-sorted v* tag", () => {
    const r = repo();
    try {
      r.commit("chore: a", { "x.txt": "a" });
      r.tag("v0.6.0");
      r.commit("chore: b", { "x.txt": "b" });
      r.tag("v0.6.1");
      expect(latestTag(r.root)).toBe("v0.6.1");
    } finally {
      r.cleanup();
    }
  });
});

describe("analyzeReleaseScope", () => {
  test("CI-only commits yield no release", () => {
    const r = repo();
    r.tag("v0.6.0");
    try {
      r.commit("fix(ci): workflow tweak", { ".github/workflows/ci.yml": "on: push\n" });
      expect(analyzeReleaseScope(r.root)).toEqual({ level: null });
    } finally {
      r.cleanup();
    }
  });

  test("tests or scripts alone yield no release", () => {
    const r = repo();
    r.tag("v0.6.0");
    try {
      r.commit("fix: coverage", { "tests/unit/x.test.ts": "test\n" });
      r.commit("ci: release helper", { "scripts/analyze-release-scope.ts": "export {}\n" });
      expect(analyzeReleaseScope(r.root)).toEqual({ level: null });
    } finally {
      r.cleanup();
    }
  });

  test("plugin source fix yields patch", () => {
    const r = repo();
    r.tag("v0.6.0");
    try {
      r.commit("fix: table header", { "src/catalog-release-notes.ts": "export {}\n" });
      expect(analyzeReleaseScope(r.root)).toEqual({ level: "patch" });
    } finally {
      r.cleanup();
    }
  });

  test("catalog file updates still release", () => {
    const r = repo();
    r.tag("v0.6.0");
    try {
      r.commit("fix(catalog): sync command-code@1.39.0", { "models.json": "[]\n" });
      expect(analyzeReleaseScope(r.root)).toEqual({ level: "patch" });
    } finally {
      r.cleanup();
    }
  });

  test("feat beats fix", () => {
    const r = repo();
    r.tag("v0.6.0");
    try {
      r.commit("fix: bug", { "plugin.ts": "export {}\n" });
      r.commit("feat: variants", { "index.ts": "export {}\n" });
      expect(analyzeReleaseScope(r.root).level).toBe("minor");
    } finally {
      r.cleanup();
    }
  });

  test("chore(scope) commits never yield a release even when they touch product files", () => {
    const r = repo();
    r.tag("v0.6.0");
    try {
      r.commit("chore(catalog): sync command-code@1.40.1", { "models.json": "[]\n" });
      r.commit("chore(release): sync manifests to v0.7.5", { "package.json": "{}" });
      expect(analyzeReleaseScope(r.root)).toEqual({ level: null });
    } finally {
      r.cleanup();
    }
  });
});
