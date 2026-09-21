const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

module.exports = {
  generateNotes(_config, context) {
    const args = [join(__dirname, "catalog-release-notes.ts")];
    if (context.nextRelease?.version) args.push(context.nextRelease.version);
    return execFileSync("bun", args, { encoding: "utf8" });
  },
};
