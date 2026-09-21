#!/usr/bin/env bun
import { readFileSync } from "fs";
import { join } from "path";
import { catalogReleaseNotesFromFiles } from "../src/catalog-release-notes.js";
import type { CatalogManifest } from "../src/manifest.js";
import type { PricedModel } from "../src/catalog-release-notes.js";

const ROOT = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf-8")) as CatalogManifest;
const models = JSON.parse(readFileSync(join(ROOT, "models.json"), "utf-8")) as PricedModel[];
const pluginVersion = process.argv[2];
process.stdout.write(catalogReleaseNotesFromFiles({ manifest, models, pluginVersion }));
