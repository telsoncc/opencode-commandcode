import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  COMMANDCODE_ENV_NAMES,
  COMMANDCODE_PROVIDER_ID,
  applyIntegration,
  applyProviderInventory,
  applyRemoteAvailability,
  attachRemoteRefreshRunner,
  buildProviderInfo,
  buildV2Models,
  fetchRemoteAvailability,
  loadCatalogForV2,
  modelEntryToV2,
  persistRefreshedModels,
  refreshCatalogFromRemote,
  remoteRefreshRunnerCount,
  writeRemoteRefreshSummary,
  type V2IntegrationDraft,
  type V2ProviderEditor,
} from "../../src/opencode2.ts";
import type { ModelEntry } from "../../src/catalog.ts";

const sampleEntry: ModelEntry = {
  id: "Qwen/Qwen3.7-Max",
  name: "Qwen 3.7 Max",
  tier: "open-source",
  reasoning: true,
  reasoningEfforts: ["low", "high"],
  tool_call: true,
  cost: { input: 2.5, output: 7.5, cache_read: 0.5, cache_write: 3.13 },
  limit: { context: 1000000, output: 131072 },
  attachment: false,
  modalities: { input: ["text"], output: ["text"] },
};

test("modelEntryToV2 maps ids, capabilities, cost, limits and variants", () => {
  const info = modelEntryToV2(sampleEntry);
  expect(info.id).toBe("qwen3.7-max");
  expect(info.modelID).toBe("Qwen/Qwen3.7-Max");
  expect(info.providerID).toBe(COMMANDCODE_PROVIDER_ID);
  expect(info.name).toBe("Qwen 3.7 Max");
  expect(info.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] });
  expect(info.limit).toEqual({ context: 1000000, output: 131072 });
  expect(info.status).toBe("active");
  expect(info.enabled).toBe(true);
  expect(info.time).toEqual({ released: 0 });
  expect(info.cost).toEqual([{ input: 2.5, output: 7.5, cache: { read: 0.5, write: 3.13 } }]);
  expect(info.variants).toEqual([
    { id: "low", settings: { reasoningEffort: "low" } },
    { id: "high", settings: { reasoningEffort: "high" } },
  ]);
});

test("modelEntryToV2 defaults to text-only and no variants", () => {
  const info = modelEntryToV2({
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    tier: "open-source",
    reasoning: false,
    tool_call: true,
    cost: { input: 0.1, output: 0.3 },
    limit: { context: 1000000, output: 131072 },
  });
  expect(info.id).toBe("deepseek-v4-flash");
  expect(info.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] });
  expect(info.variants).toEqual([]);
  expect(info.cost).toEqual([{ input: 0.1, output: 0.3, cache: { read: 0, write: 0 } }]);
});

test("buildV2Models maps every entry", () => {
  const infos = buildV2Models([sampleEntry]);
  expect(infos.length).toBe(1);
  expect(infos[0]?.id).toBe("qwen3.7-max");
});

test("buildProviderInfo uses the native openai-compatible runtime", () => {
  const info = buildProviderInfo();
  expect(info.id).toBe(COMMANDCODE_PROVIDER_ID);
  expect(info.name).toBe("Command Code");
  expect(info.activation).toBe("enabled");
  expect(info.package).toBe("@opencode/ai/providers/openai-compatible");
  expect(info.integrationID).toBe("commandcode");
  expect(info.settings).toEqual({ baseURL: "https://api.commandcode.ai/provider/v1" });
});

test("applyProviderInventory is a no-op while empty", () => {
  let adds = 0;
  const editor: V2ProviderEditor = {
    add: () => {
      adds++;
    },
  };
  applyProviderInventory(editor, [], undefined);
  expect(adds).toBe(0);
});

test("applyProviderInventory publishes models and binds the connection", () => {
  const seen: Array<{ info: unknown; models: unknown; sourceConnection?: unknown }> = [];
  const editor: V2ProviderEditor = {
    add: (input) => {
      seen.push(input);
    },
  };
  const connection = { type: "env", name: "COMMANDCODE_API_KEY" };
  applyProviderInventory(editor, [sampleEntry], connection);
  expect(seen.length).toBe(1);
  expect(seen[0]?.sourceConnection).toEqual(connection);
  const models = seen[0]?.models as Array<{ id: string }>;
  expect(models.map((m) => m.id)).toEqual(["qwen3.7-max"]);
});

test("applyIntegration registers key and env methods", () => {
  const updates: string[] = [];
  const methods: unknown[] = [];
  const draft: V2IntegrationDraft = {
    update: (id, fn) => {
      updates.push(id);
      fn({ id, name: "" });
    },
    method: {
      update: (input) => {
        methods.push(input);
      },
    },
  };
  applyIntegration(draft);
  expect(updates).toEqual(["commandcode"]);
  expect(methods).toEqual([
    { integrationID: "commandcode", method: { type: "key", label: "API Key" } },
    { integrationID: "commandcode", method: { type: "env", names: [...COMMANDCODE_ENV_NAMES] } },
  ]);
});

let testStateDir: string;
let prevStateDir: string | undefined;
let prevPackagePath: string | undefined;

beforeAll(() => {
  testStateDir = mkdtempSync(join(tmpdir(), "cc-opencode2-state-"));
  prevStateDir = process.env.COMMANDCODE_PROVIDER_STATE_DIR;
  prevPackagePath = process.env.COMMANDCODE_PACKAGE_PATH;
  process.env.COMMANDCODE_PROVIDER_STATE_DIR = testStateDir;
  delete process.env.COMMANDCODE_PACKAGE_PATH;
});

afterAll(() => {
  if (prevStateDir === undefined) delete process.env.COMMANDCODE_PROVIDER_STATE_DIR;
  else process.env.COMMANDCODE_PROVIDER_STATE_DIR = prevStateDir;
  if (prevPackagePath === undefined) delete process.env.COMMANDCODE_PACKAGE_PATH;
  else process.env.COMMANDCODE_PACKAGE_PATH = prevPackagePath;
  rmSync(testStateDir, { recursive: true, force: true });
});

test("loadCatalogForV2 resolves the bundled catalog", () => {
  const catalog = loadCatalogForV2();
  expect(catalog.source).toBe("bundled");
  expect(catalog.models.length).toBeGreaterThan(20);
  expect(catalog.commandCodeVersion).toMatch(/^\d+\.\d+\.\d+/);
});

function testEntry(id: string): ModelEntry {
  return {
    id,
    name: id,
    tier: "open-source",
    reasoning: false,
    tool_call: true,
    cost: { input: 0.1, output: 0.2 },
    limit: { context: 1000, output: 100 },
  };
}

function stubFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const availabilityPayload = (ids: string[]): string =>
  JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) });

test("applyRemoteAvailability splits retained, retired and new ids", () => {
  const base = [testEntry("a/one"), testEntry("a/two")];
  const result = applyRemoteAvailability(base, ["a/two", "b/three", "b/three"]);
  expect(result.models.map((m) => m.id)).toEqual(["a/two"]);
  expect(result.unavailable).toEqual(["a/one"]);
  expect(result.pendingNew).toEqual(["b/three"]);
  expect(result.remoteCount).toBe(3);
});

test("fetchRemoteAvailability parses the provider list payload", async () => {
  const restore = stubFetch(async (input) => {
    expect(String(input)).toContain("/models");
    return new Response(availabilityPayload(["a/one"]), { status: 200 });
  });
  try {
    await expect(fetchRemoteAvailability(1000)).resolves.toEqual(["a/one"]);
  } finally {
    restore();
  }
});

test("fetchRemoteAvailability throws on HTTP errors", async () => {
  const restore = stubFetch(async () => new Response("nope", { status: 500 }));
  try {
    await expect(fetchRemoteAvailability(1000)).rejects.toThrow("HTTP 500");
  } finally {
    restore();
  }
});

test("fetchRemoteAvailability throws on malformed payloads", async () => {
  const restore = stubFetch(
    async () => new Response(JSON.stringify({ object: "list", data: [] }), { status: 200 }),
  );
  try {
    await expect(fetchRemoteAvailability(1000)).rejects.toThrow(/non-empty array/);
  } finally {
    restore();
  }
});

test("refreshCatalogFromRemote reconciles the base catalog", async () => {
  const restore = stubFetch(
    async () => new Response(availabilityPayload(["a/two", "c/new"]), { status: 200 }),
  );
  try {
    const result = await refreshCatalogFromRemote(
      [testEntry("a/one"), testEntry("a/two")],
      1000,
    );
    expect(result.models.map((m) => m.id)).toEqual(["a/two"]);
    expect(result.unavailable).toEqual(["a/one"]);
    expect(result.pendingNew).toEqual(["c/new"]);
  } finally {
    restore();
  }
});

test("writeRemoteRefreshSummary records the remote source", () => {
  const result = applyRemoteAvailability([testEntry("a/one")], ["a/one", "b/new"]);
  writeRemoteRefreshSummary(result, "1.65.2");
  const summary = JSON.parse(readFileSync(join(testStateDir, "startup.json"), "utf-8")) as {
    catalogSource: string;
    modelCount: number;
    pendingNewCount: number;
    degraded: boolean;
  };
  expect(summary.catalogSource).toBe("remote");
  expect(summary.modelCount).toBe(1);
  expect(summary.pendingNewCount).toBe(1);
  expect(summary.degraded).toBe(false);
});

test("persistRefreshedModels refreshes the disk cache", () => {
  persistRefreshedModels([testEntry("a/one")]);
  const cached = JSON.parse(
    readFileSync(join(testStateDir, "catalog-cache.json"), "utf-8"),
  ) as Array<{ id: string }>;
  expect(cached.map((m) => m.id)).toEqual(["a/one"]);
  persistRefreshedModels([]);
  const kept = JSON.parse(
    readFileSync(join(testStateDir, "catalog-cache.json"), "utf-8"),
  ) as Array<{ id: string }>;
  expect(kept.map((m) => m.id)).toEqual(["a/one"]);
});

test("attachRemoteRefreshRunner shares one timer and detaches", async () => {
  expect(remoteRefreshRunnerCount()).toBe(0);
  let calls = 0;
  const detach = attachRemoteRefreshRunner(async () => {
    calls++;
  }, 10);
  expect(remoteRefreshRunnerCount()).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls).toBeGreaterThan(0);
  detach();
  detach();
  expect(remoteRefreshRunnerCount()).toBe(0);
  const frozen = calls;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(calls).toBe(frozen);
});
