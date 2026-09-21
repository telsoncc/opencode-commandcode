import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

test("verify:release-candidate packs without publishing", () => {
  const result = spawnSync("bun", ["run", "verify:release-candidate"], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(result.stdout).toContain("verified");
});
