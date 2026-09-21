#!/usr/bin/env bun
// After semantic-release, open a PR so protected main gets package.json / manifest
// versions that match the new v* tag (workit AR-15).
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ROOT = join(import.meta.dir, "..");

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf-8" }).trim();
}

function latestTag(): string {
  const tag = git("tag --list 'v*' --sort=-v:refname").split("\n")[0];
  if (!tag) throw new Error("no v* release tag found");
  return tag;
}

const tag = latestTag();
const version = tag.replace(/^v/, "");
const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
if (pkg.version === version) {
  console.log(`package.json already ${version}`);
  process.exit(0);
}

pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const manifestPath = join(ROOT, "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { pluginVersion?: string };
  manifest.pluginVersion = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`aligned manifests to ${tag}`);
