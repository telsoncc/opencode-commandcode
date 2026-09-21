const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

// Keep a Changelog: promote ## [Unreleased] into ## [version] - date during
// prepare. The post-release sync PR commits CHANGELOG.md (protected main).
module.exports = {
  prepare(_config, context) {
    const version = context.nextRelease.version;
    const date = new Date().toISOString().slice(0, 10);
    execFileSync("bun", [join(__dirname, "cut-changelog.ts"), version, date], {
      stdio: "inherit",
    });
  },
};
