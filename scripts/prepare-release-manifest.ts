#!/usr/bin/env bun
// Semantic Release prepare step: stamp manifest.pluginVersion from
// nextRelease.version before @semantic-release/npm packs. Catalog fields stay
// untouched; the post-release sync PR commits the stamped versions to main.
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { withPluginVersion, writeManifest, type CatalogManifest } from "../src/manifest.js";

const ROOT = join(import.meta.dir, "..");

function usage(): never {
  console.error("usage: prepare-release-manifest.ts <version>");
  process.exit(1);
}

const version = process.argv[2]?.trim() || "";
if (!version) usage();

const manifestPath = join(ROOT, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`manifest not found at ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as CatalogManifest;
writeManifest(manifestPath, withPluginVersion(manifest, version));
console.log(`stamped manifest pluginVersion to ${version}`);
