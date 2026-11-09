#!/usr/bin/env bun
// Build for publication: compile TS into dist/ so hosts without a TS loader
// (the opencode IDE server runs plain Node inside Electron) can execute the
// plugin, then copy the bundled catalog assets next to the emitted files.
import { copyFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const ASSETS = ["models.json", "_version.txt", "manifest.json"];
const REQUIRED_OUTPUTS = ["index.js", "plugin.js", "plugin-opencode2.js", "src/opencode2.js"];

rmSync(DIST, { recursive: true, force: true });

const proc = Bun.spawn(["bunx", "tsc", "-p", "tsconfig.json"], {
  cwd: ROOT,
  stdout: "inherit",
  stderr: "inherit",
});
const exitCode = await proc.exited;
if (exitCode !== 0) process.exit(exitCode);

for (const output of REQUIRED_OUTPUTS) {
  if (!existsSync(join(DIST, output))) {
    console.error(`build output missing: dist/${output}`);
    process.exit(1);
  }
}

for (const asset of ASSETS) {
  copyFileSync(join(ROOT, asset), join(DIST, asset));
}

console.log(`built dist/ (${REQUIRED_OUTPUTS.length} entrypoints, ${ASSETS.length} assets)`);
