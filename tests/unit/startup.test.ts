import { expect, test, describe } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  pluginStateDir,
  readCatalogCache,
  writeCatalogCache,
  writeStartupSummary,
  type ModelEntry,
} from "../../src/startup.ts";

const sample: ModelEntry[] = [
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    tier: "premium",
    reasoning: true,
    tool_call: true,
    cost: { input: 3, output: 15 },
    limit: { context: 200000, output: 16000 },
  },
];

describe("pluginStateDir", () => {
  test("honors COMMANDCODE_PROVIDER_STATE_DIR when set", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-state-"));
    const prev = process.env.COMMANDCODE_PROVIDER_STATE_DIR;
    process.env.COMMANDCODE_PROVIDER_STATE_DIR = dir;
    try {
      expect(pluginStateDir()).toBe(dir);
    } finally {
      if (prev === undefined) delete process.env.COMMANDCODE_PROVIDER_STATE_DIR;
      else process.env.COMMANDCODE_PROVIDER_STATE_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("catalog cache", () => {
  test("round-trips models and returns null for missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-cache-"));
    try {
      expect(readCatalogCache(dir)).toBeNull();
      writeCatalogCache(dir, sample);
      expect(readCatalogCache(dir)).toEqual(sample);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("startup summary", () => {
  test("writes startup.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-sum-"));
    try {
      writeStartupSummary(dir, {
        catalogSource: "bundled",
        commandCodeVersion: "1.38.0",
        modelCount: 1,
        reasoningModelCount: 1,
        degraded: false,
        degradedReason: null,
      });
      const parsed = JSON.parse(readFileSync(join(dir, "startup.json"), "utf-8"));
      expect(parsed.catalogSource).toBe("bundled");
      expect(parsed.modelCount).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
