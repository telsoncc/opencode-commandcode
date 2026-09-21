#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cutKeepAChangelog } from "../src/cut-changelog.ts";

const version = process.argv[2];
const date = process.argv[3] ?? new Date().toISOString().slice(0, 10);
if (!version) throw new Error("usage: cut-changelog.ts <version> [YYYY-MM-DD]");
const path = join(import.meta.dir, "..", "CHANGELOG.md");
writeFileSync(path, cutKeepAChangelog(readFileSync(path, "utf8"), version, date));
