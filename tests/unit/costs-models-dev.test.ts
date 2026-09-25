import { expect, test, describe } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  applyFreeCosts,
  applyModelsDevCosts,
  applyModelsDevModalities,
  buildEstimatedEntry,
  findModelsDevRow,
  isFreeSku,
  loadModelsDevRows,
  MODELS_DEV_CACHE_FILE,
  parseModelsDev,
  TEXT_ONLY_MODALITIES,
} from "../../src/costs-models-dev.ts";
import type { ModelEntry } from "../../src/catalog.ts";

function model(partial: Partial<ModelEntry> & Pick<ModelEntry, "id" | "name">): ModelEntry {
  return {
    tier: "open-source",
    reasoning: false,
    tool_call: true,
    cost: { input: 0.5, output: 2 },
    limit: { context: 200000, output: 65536 },
    ...partial,
  };
}

describe("isFreeSku", () => {
  test("detects free from name or id suffix", () => {
    expect(isFreeSku({ id: "tencent/Hy3", name: "Tencent Hy3 (Free)" })).toBe(true);
    expect(isFreeSku({ id: "inclusionai/ling-3.0-flash-free", name: "Ling 3.0 Flash" })).toBe(true);
    expect(isFreeSku({ id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" })).toBe(false);
  });
});

describe("parseModelsDev + applyModelsDevCosts", () => {
  const rows = parseModelsDev(
    readFileSync(join(import.meta.dir, "../fixtures/models-dev/api.subset.json"), "utf-8"),
  );

  test("fills by exact id and skips already priced models", () => {
    const models = [
      model({
        id: "google/gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        cost: { input: 0.5, output: 2 },
      }),
      model({ id: "kept", name: "Kept", cost: { input: 3, output: 15 } }),
    ];
    const filled = new Set<string>();
    const n = applyModelsDevCosts(models, rows, new Set(["kept"]), filled);
    expect(n).toBe(1);
    expect(models[0].cost).toEqual({ input: 1.5, output: 9, cache_read: 0.15 });
    expect(models[1].cost).toEqual({ input: 3, output: 15 });
    expect([...filled]).toEqual(["google/gemini-3.5-flash"]);
  });

  test("does not apply models.dev prices to Command Code free SKUs", () => {
    const models = [
      model({
        id: "minimax/minimax-m2.7-free",
        name: "MiniMax M2.7 Free",
        cost: { input: 0.5, output: 2 },
      }),
    ];
    const filled = new Set<string>();
    expect(applyModelsDevCosts(models, rows, new Set(), filled)).toBe(0);
    expect(models[0].cost).toEqual({ input: 0.5, output: 2 });
    expect(filled.size).toBe(0);
  });

  test("matches the last path segment of a catalog id", () => {
    const models = [
      model({ id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus", cost: { input: 0.5, output: 2 } }),
    ];
    const filled = new Set<string>();
    expect(applyModelsDevCosts(models, rows, new Set(), filled)).toBe(1);
    expect(models[0].cost).toEqual({ input: 0.5, output: 3, cache_read: 0.1 });
    expect([...filled]).toEqual(["Qwen/Qwen3.6-Plus"]);
  });
});

describe("applyModelsDevModalities", () => {
  const rows = parseModelsDev(
    readFileSync(join(import.meta.dir, "../fixtures/models-dev/api.subset.json"), "utf-8"),
  );

  test("keeps CLI modalities on unmatched SKUs and only enriches extras from models.dev", () => {
    const models = [
      model({
        id: "google/gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        attachment: true,
        modalities: { input: ["text", "image"], output: ["text"] },
      }),
      model({
        id: "unknown/cli-vision-only",
        name: "CLI Vision Only",
        attachment: true,
        modalities: { input: ["text", "image"], output: ["text"] },
      }),
      model({
        id: "tencent/hy4-preview",
        name: "Tencent Hy4 Preview",
        attachment: false,
        modalities: { input: ["text"], output: ["text"] },
      }),
      model({ id: "no-cli-no-dev", name: "Gap" }),
    ];
    const n = applyModelsDevModalities(models, rows);
    expect(n).toBe(1);
    expect(models[0].modalities).toEqual({
      input: ["text", "image", "video", "audio", "pdf"],
      output: ["text"],
    });
    expect(models[1].attachment).toBe(true);
    expect(models[1].modalities).toEqual({ input: ["text", "image"], output: ["text"] });
    expect(models[2].attachment).toBe(false);
    expect(models[2].modalities).toEqual({ ...TEXT_ONLY_MODALITIES });
    expect(models[3].attachment).toBe(false);
    expect(models[3].modalities).toEqual({ ...TEXT_ONLY_MODALITIES });
  });
});

describe("applyFreeCosts", () => {
  test("sets free SKUs to zero and leaves paid models alone", () => {
    const models = [
      model({ id: "tencent/Hy3", name: "Tencent Hy3 (Free)" }),
      model({ id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" }),
    ];
    const filled = new Set<string>();
    expect(applyFreeCosts(models, new Set(), filled)).toBe(1);
    expect(models[0].cost).toEqual({ input: 0, output: 0 });
    expect(models[1].cost).toEqual({ input: 0.5, output: 2 });
    expect([...filled]).toEqual(["tencent/Hy3"]);
  });
});

const RICH_MODELS_DEV_JSON = JSON.stringify({
  acme: {
    models: {
      "acme/new-pro": {
        id: "acme/New-Pro",
        name: "New Pro",
        cost: { input: 2, output: 8, cache_read: 0.2 },
        attachment: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["low", "max"] }],
        tool_call: true,
        limit: { context: 500000, output: 64000 },
      },
    },
  },
});

describe("findModelsDevRow", () => {
  const rows = parseModelsDev(RICH_MODELS_DEV_JSON);

  test("matches by exact id, segment and name", () => {
    expect(findModelsDevRow(rows, "acme/New-Pro")?.name).toBe("New Pro");
    expect(findModelsDevRow(rows, "other/New-Pro")?.name).toBe("New Pro");
    expect(findModelsDevRow(rows, "unrelated", "New Pro")?.name).toBe("New Pro");
    expect(findModelsDevRow(rows, "unrelated")).toBeUndefined();
  });
});

describe("buildEstimatedEntry", () => {
  const rows = parseModelsDev(RICH_MODELS_DEV_JSON);

  test("maps a matched row with estimate markers", () => {
    const entry = buildEstimatedEntry("acme/New-Pro", rows);
    expect(entry).not.toBeNull();
    expect(entry?.id).toBe("acme/New-Pro");
    expect(entry?.name).toBe("New Pro (est.)");
    expect(entry?.estimated).toBe(true);
    expect(entry?.cost).toEqual({ input: 2, output: 8, cache_read: 0.2 });
    expect(entry?.reasoning).toBe(true);
    expect(entry?.reasoningEfforts).toEqual(["low", "max"]);
    expect(entry?.tool_call).toBe(true);
    expect(entry?.limit).toEqual({ context: 500000, output: 64000 });
    expect(entry?.attachment).toBe(true);
    expect(entry?.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
  });

  test("matches by last path segment", () => {
    const entry = buildEstimatedEntry("some-vendor/New-Pro", rows);
    expect(entry?.cost).toEqual({ input: 2, output: 8, cache_read: 0.2 });
    expect(entry?.name).toBe("New Pro (est.)");
  });

  test("prices free SKUs at zero without a row", () => {
    const entry = buildEstimatedEntry("acme/spark-free", []);
    expect(entry?.cost).toEqual({ input: 0, output: 0 });
    expect(entry?.name).toBe("Spark Free (est.)");
    expect(entry?.estimated).toBe(true);
  });

  test("returns null when nothing grounds an estimate", () => {
    expect(buildEstimatedEntry("acme/unknown-model", rows)).toBeNull();
    expect(buildEstimatedEntry("acme/unknown-model", [])).toBeNull();
  });
});

describe("loadModelsDevRows", () => {
  function stubFetch(
    handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  ): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = handler as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  function writeCache(dir: string, fetchedAt: number, json: string): void {
    writeFileSync(join(dir, MODELS_DEV_CACHE_FILE), JSON.stringify({ fetchedAt, json }));
  }

  test("uses a fresh cache without fetching", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-modelsdev-"));
    try {
      writeCache(dir, Date.now(), RICH_MODELS_DEV_JSON);
      const restore = stubFetch(async () => {
        throw new Error("must not fetch");
      });
      try {
        const rows = await loadModelsDevRows({ cacheDir: dir });
        expect(rows.map((r) => r.id)).toEqual(["acme/New-Pro"]);
      } finally {
        restore();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refetches a stale cache and rewrites it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-modelsdev-"));
    try {
      writeCache(dir, Date.now() - 48 * 3600_000, JSON.stringify({}));
      const restore = stubFetch(async () => new Response(RICH_MODELS_DEV_JSON, { status: 200 }));
      try {
        const rows = await loadModelsDevRows({ cacheDir: dir, timeoutMs: 1000 });
        expect(rows.map((r) => r.id)).toEqual(["acme/New-Pro"]);
        const rewritten = JSON.parse(readFileSync(join(dir, MODELS_DEV_CACHE_FILE), "utf-8")) as {
          json: string;
        };
        expect(rewritten.json).toBe(RICH_MODELS_DEV_JSON);
      } finally {
        restore();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("falls back to stale cache and to [] without one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-modelsdev-"));
    try {
      writeCache(dir, Date.now() - 48 * 3600_000, RICH_MODELS_DEV_JSON);
      const restore = stubFetch(async () => new Response("down", { status: 500 }));
      try {
        const stale = await loadModelsDevRows({ cacheDir: dir, timeoutMs: 1000 });
        expect(stale.map((r) => r.id)).toEqual(["acme/New-Pro"]);
      } finally {
        restore();
      }
      rmSync(join(dir, MODELS_DEV_CACHE_FILE));
      const restore2 = stubFetch(async () => new Response("down", { status: 500 }));
      try {
        await expect(loadModelsDevRows({ cacheDir: dir, timeoutMs: 1000 })).resolves.toEqual([]);
      } finally {
        restore2();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
