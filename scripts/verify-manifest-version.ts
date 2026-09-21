#!/usr/bin/env bun
// Prepack guard: manifest.pluginVersion must equal package.json version.
// Accepts an optional root path so tests can exercise the mismatch case in a
// temporary directory. Exits non-zero on mismatch, before npm packs/publishes.
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = process.argv[2] ? join(process.argv[2]) : join(import.meta.dir, "..");

const pkgPath = join(ROOT, "package.json");
const manifestPath = join(ROOT, "manifest.json");

if (!existsSync(pkgPath) || !existsSync(manifestPath)) {
  console.error(`missing package.json or manifest.json under ${ROOT}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
  pluginVersion?: string;
};

if (pkg.version !== manifest.pluginVersion) {
  console.error(
    `manifest pluginVersion ${manifest.pluginVersion ?? "(missing)"} != package.json ${pkg.version ?? "(missing)"}`,
  );
  process.exit(1);
}

console.log(`manifest version matches package.json (${pkg.version})`);
