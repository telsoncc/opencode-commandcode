#!/usr/bin/env bun
// Path-gated releases (workit AR-16): a releasable commit counts only when it
// touches package payload. CI/docs/tests/scripts-only merges cut no npm publish.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const PRODUCT_FILES = new Set([
  "plugin.ts",
  "index.ts",
  "models.json",
  "manifest.json",
  "_version.txt",
]);

export function isProductPath(file: string): boolean {
  return PRODUCT_FILES.has(file) || file.startsWith("src/");
}

const g = (root: string, args: string[]): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const SEMVER_TAG = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function latestTag(root = process.cwd()): string | null {
  const out = g(root, ["tag", "--list", "v*", "--sort=-v:refname"])
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => SEMVER_TAG.test(l));
  return out[0] ?? null;
}

type Level = "major" | "minor" | "patch";
const LEVEL_RANK: Record<Level, number> = { patch: 1, minor: 2, major: 3 };
// Releasable types only. "chore" (including chore(scope) like chore(release):
// sync manifests or chore(catalog)) is bookkeeping and must never cut a
// release — otherwise the post-release manifest-sync merge re-releases and
// loops forever.
const TYPE_LEVEL: Record<string, Level> = { fix: "patch", perf: "patch", feat: "minor" };

const subjectLevel = (commit: string): Level | null => {
  const firstLine = commit.split("\n")[0] ?? "";
  const m = /^(?:fix|perf|feat)(?:\([^)]*\))?!?:/.exec(firstLine);
  if (!m) return null;
  if (m[0].includes("!")) return "major";
  const body = commit.split("\n").slice(1).join("\n");
  const type = m[0].replace(/\(.*$/, "").replace(/!$/, "").replace(/:$/, "");
  return /BREAKING[- ]CHANGE:/.test(body) ? "major" : (TYPE_LEVEL[type] ?? null);
};

const commitsSince = (root: string, from: string): { message: string; files: string[] }[] => {
  const hashes = g(root, ["log", "--reverse", "--format=%H", `${from}..HEAD`])
    .split("\n")
    .filter(Boolean);
  return hashes.map((h) => ({
    message: g(root, ["show", "-s", "--format=%B", h]),
    files: g(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--root", "-z", h])
      .split("\0")
      .filter(Boolean),
  }));
};

export function analyzeReleaseScope(root = process.cwd()): { level: Level | null } {
  const from = latestTag(root);
  if (from === null) return { level: "minor" };
  const levels: Level[] = [];
  for (const { message, files } of commitsSince(root, from)) {
    if (!files.some(isProductPath)) continue;
    const lvl = subjectLevel(message);
    if (lvl) levels.push(lvl);
  }
  if (levels.length === 0) return { level: null };
  const level = levels.reduce<Level>(
    (best, l) => (LEVEL_RANK[l] > LEVEL_RANK[best] ? l : best),
    "patch",
  );
  return { level };
}

if (import.meta.main) {
  const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  const { level } = analyzeReleaseScope(root);
  if (level) process.stdout.write(`${level}\n`);
}
