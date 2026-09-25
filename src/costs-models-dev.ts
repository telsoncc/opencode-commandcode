import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { pluginStateDir } from "./startup.js";
import type { ModelEntry } from "./catalog.js";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const MODELS_DEV_TIMEOUT_MS = 30_000;
export const MODELS_DEV_CACHE_TTL_MS = 24 * 3600_000;
export const MODELS_DEV_CACHE_FILE = "models-dev-cache.json";
export const ESTIMATED_CONTEXT_TOKENS = 200000;
export const ESTIMATED_OUTPUT_TOKENS = 65536;
export const FREE_COST = { input: 0, output: 0 } as const;
export const TEXT_ONLY_MODALITIES = { input: ["text"], output: ["text"] } as const;

export type ModelsDevRow = {
  id: string;
  name: string;
  cost: { input: number; output: number; cache_read?: number; cache_write?: number };
  attachment?: boolean;
  modalities?: { input: string[]; output: string[] };
  reasoning?: boolean;
  reasoningEfforts?: string[];
  toolCall?: boolean;
  limit?: { context: number; output: number };
};

type ReasoningOption = {
  type?: string;
  values?: unknown;
};

type ModelsDevModel = {
  id?: string;
  name?: string;
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  attachment?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  reasoning?: boolean;
  reasoning_options?: ReasoningOption[];
  tool_call?: boolean;
  limit?: { context?: number; output?: number };
};

type ModelsDevProvider = { models?: Record<string, ModelsDevModel> };

function lastSegment(id: string): string {
  const i = id.lastIndexOf("/");
  return i >= 0 ? id.slice(i + 1) : id;
}

export function isFreeSku(model: { id: string; name: string }): boolean {
  if (/-free$/i.test(model.id)) return true;
  return /\bfree\b/i.test(`${model.id} ${model.name}`);
}

export function parseModelsDev(json: string): ModelsDevRow[] {
  const data = JSON.parse(json) as Record<string, ModelsDevProvider>;
  const rows: ModelsDevRow[] = [];
  const seen = new Set<string>();
  for (const provider of Object.keys(data).sort()) {
    const models = data[provider]?.models ?? {};
    for (const model of Object.values(models)) {
      if (!model?.id || model.cost?.input === undefined || model.cost?.output === undefined)
        continue;
      const key = model.id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const cost: ModelsDevRow["cost"] = { input: model.cost.input, output: model.cost.output };
      if (model.cost.cache_read !== undefined) cost.cache_read = model.cost.cache_read;
      if (model.cost.cache_write !== undefined) cost.cache_write = model.cost.cache_write;
      const row: ModelsDevRow = { id: model.id, name: model.name ?? model.id, cost };
      if (typeof model.attachment === "boolean") row.attachment = model.attachment;
      if (typeof model.reasoning === "boolean") row.reasoning = model.reasoning;
      const efforts = extractEffortValues(model.reasoning_options);
      if (efforts) row.reasoningEfforts = efforts;
      if (typeof model.tool_call === "boolean") row.toolCall = model.tool_call;
      const limit = extractLimit(model.limit);
      if (limit) row.limit = limit;
      const input = model.modalities?.input?.filter((x) => typeof x === "string");
      const output = model.modalities?.output?.filter((x) => typeof x === "string");
      if (input?.length || output?.length) {
        row.modalities = {
          input: input?.length ? input : [...TEXT_ONLY_MODALITIES.input],
          output: output?.length ? output : [...TEXT_ONLY_MODALITIES.output],
        };
      }
      rows.push(row);
    }
  }
  return rows;
}

function indexRows(rows: ModelsDevRow[]) {
  const byId = new Map<string, ModelsDevRow>();
  const bySegment = new Map<string, ModelsDevRow>();
  const byName = new Map<string, ModelsDevRow>();
  for (const row of rows) {
    const idKey = row.id.toLowerCase();
    if (!byId.has(idKey)) byId.set(idKey, row);
    const segment = lastSegment(row.id).toLowerCase();
    if (!bySegment.has(segment)) bySegment.set(segment, row);
    const nameKey = row.name.toLowerCase();
    if (!byName.has(nameKey)) byName.set(nameKey, row);
  }
  return { byId, bySegment, byName };
}

function findRow(model: ModelEntry, index: ReturnType<typeof indexRows>): ModelsDevRow | undefined {
  return (
    index.byId.get(model.id.toLowerCase()) ??
    index.bySegment.get(lastSegment(model.id).toLowerCase()) ??
    index.byName.get(model.name.toLowerCase())
  );
}

export function applyFreeCosts(
  models: ModelEntry[],
  skipIds: Set<string>,
  filledIds?: Set<string>,
): number {
  let filled = 0;
  for (const model of models) {
    if (skipIds.has(model.id) || !isFreeSku(model)) continue;
    model.cost = { ...FREE_COST };
    filledIds?.add(model.id);
    filled++;
  }
  return filled;
}

function textOnly(): { input: string[]; output: string[] } {
  return { input: [...TEXT_ONLY_MODALITIES.input], output: [...TEXT_ONLY_MODALITIES.output] };
}

function extractEffortValues(options: ReasoningOption[] | undefined): string[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const values = options.flatMap((o) =>
    o?.type === "effort" && Array.isArray(o.values) ? o.values : [],
  );
  const unique = [
    ...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0)),
  ];
  return unique.length > 0 ? unique : undefined;
}

function extractLimit(
  limit: { context?: number; output?: number } | undefined,
): { context: number; output: number } | undefined {
  if (!limit || typeof limit.context !== "number" || typeof limit.output !== "number") {
    return undefined;
  }
  if (!(limit.context > 0) || !(limit.output > 0)) return undefined;
  return { context: limit.context, output: limit.output };
}

function prettifyModelId(id: string): string {
  return lastSegment(id)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Match a models.dev row by exact id, last path segment, or display name. */
export function findModelsDevRow(
  rows: ModelsDevRow[],
  id: string,
  name?: string,
): ModelsDevRow | undefined {
  const index = indexRows(rows);
  return (
    index.byId.get(id.toLowerCase()) ??
    index.bySegment.get(lastSegment(id).toLowerCase()) ??
    (name ? index.byName.get(name.toLowerCase()) : undefined)
  );
}

/**
 * Build a provisional catalog entry for a remote id missing locally.
 * Costs/capabilities come from models.dev (list prices, close to but not
 * equal to Command Code billing); the entry is replaced on the next catalog
 * sync. Returns null when nothing can ground an estimate.
 */
export function buildEstimatedEntry(id: string, rows: ModelsDevRow[]): ModelEntry | null {
  const displayName = prettifyModelId(id);
  if (isFreeSku({ id, name: displayName })) {
    return {
      id,
      name: `${displayName} (est.)`,
      tier: "open-source",
      reasoning: false,
      tool_call: true,
      cost: { ...FREE_COST },
      limit: { context: ESTIMATED_CONTEXT_TOKENS, output: ESTIMATED_OUTPUT_TOKENS },
      attachment: false,
      modalities: textOnly(),
      estimated: true,
    };
  }
  const row = findModelsDevRow(rows, id);
  if (!row) return null;
  const cost: ModelEntry["cost"] = { input: row.cost.input, output: row.cost.output };
  if (row.cost.cache_read !== undefined) cost.cache_read = row.cost.cache_read;
  if (row.cost.cache_write !== undefined) cost.cache_write = row.cost.cache_write;
  const modalities = row.modalities
    ? { input: [...row.modalities.input], output: [...row.modalities.output] }
    : textOnly();
  return {
    id,
    name: `${row.name} (est.)`,
    tier: "open-source",
    reasoning: row.reasoning ?? (row.reasoningEfforts?.length ?? 0) > 0,
    ...(row.reasoningEfforts ? { reasoningEfforts: [...row.reasoningEfforts] } : {}),
    tool_call: row.toolCall ?? true,
    cost,
    limit: row.limit ?? {
      context: ESTIMATED_CONTEXT_TOKENS,
      output: ESTIMATED_OUTPUT_TOKENS,
    },
    attachment: row.attachment ?? modalities.input.includes("image"),
    modalities,
    estimated: true,
  };
}

export interface ModelsDevCache {
  fetchedAt: number;
  json: string;
}

function readModelsDevCache(cacheDir: string): ModelsDevCache | null {
  const path = join(cacheDir, MODELS_DEV_CACHE_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<ModelsDevCache>;
    if (typeof parsed.json !== "string" || typeof parsed.fetchedAt !== "number") return null;
    return { fetchedAt: parsed.fetchedAt, json: parsed.json };
  } catch {
    return null;
  }
}

function writeModelsDevCache(cacheDir: string, json: string): void {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, MODELS_DEV_CACHE_FILE),
      JSON.stringify({ fetchedAt: Date.now(), json }),
      "utf-8",
    );
  } catch {
    // ignore cache write
  }
}

/**
 * Load models.dev rows, cached on disk for a day. Falls back to stale cache
 * when the network fails; returns [] only when nothing is available.
 */
export async function loadModelsDevRows(
  options: { timeoutMs?: number; maxAgeMs?: number; cacheDir?: string } = {},
): Promise<ModelsDevRow[]> {
  const cacheDir = options.cacheDir ?? pluginStateDir();
  const maxAgeMs = options.maxAgeMs ?? MODELS_DEV_CACHE_TTL_MS;
  const cached = readModelsDevCache(cacheDir);
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) {
    try {
      return parseModelsDev(cached.json);
    } catch {
      // fall through to refetch
    }
  }
  try {
    const json = await fetchModelsDevJson(
      AbortSignal.timeout(options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS),
    );
    writeModelsDevCache(cacheDir, json);
    return parseModelsDev(json);
  } catch {
    if (cached) {
      try {
        return parseModelsDev(cached.json);
      } catch {
        // fall through to []
      }
    }
    return [];
  }
}

export function applyModelsDevModalities(models: ModelEntry[], rows: ModelsDevRow[]): number {
  const index = indexRows(rows);
  let filled = 0;
  for (const model of models) {
    const row = findRow(model, index);
    const current = model.modalities;
    if (current && model.attachment !== undefined) {
      const extra = row?.modalities?.input?.filter((x) => !current.input.includes(x)) ?? [];
      if (extra.length > 0) {
        model.modalities = {
          input: [...current.input, ...extra],
          output: [...current.output],
        };
        if (model.modalities.input.includes("image")) model.attachment = true;
        filled++;
      }
      continue;
    }
    if (row && (row.modalities || row.attachment !== undefined)) {
      const modalities = row.modalities
        ? { input: [...row.modalities.input], output: [...row.modalities.output] }
        : textOnly();
      model.modalities = modalities;
      model.attachment = row.attachment ?? modalities.input.includes("image");
      filled++;
    } else {
      model.attachment = false;
      model.modalities = textOnly();
    }
  }
  return filled;
}

export function applyModelsDevCosts(
  models: ModelEntry[],
  rows: ModelsDevRow[],
  skipIds: Set<string>,
  filledIds?: Set<string>,
): number {
  const index = indexRows(rows);
  let filled = 0;
  for (const model of models) {
    if (skipIds.has(model.id) || isFreeSku(model)) continue;
    const row = findRow(model, index);
    if (!row) continue;
    model.cost = { input: row.cost.input, output: row.cost.output };
    if (row.cost.cache_read !== undefined) model.cost.cache_read = row.cost.cache_read;
    if (row.cost.cache_write !== undefined) model.cost.cache_write = row.cost.cache_write;
    filledIds?.add(model.id);
    filled++;
  }
  return filled;
}

export async function fetchModelsDevJson(signal?: AbortSignal): Promise<string> {
  const resp = await fetch(MODELS_DEV_URL, {
    headers: {
      // ponytail: models.dev returns 403 without a browser-like UA; upgrade if they add a real API token
      "User-Agent":
        "Mozilla/5.0 (compatible; opencode-commandcode/0.5; +https://github.com/telsoncc/opencode-commandcode)",
      Accept: "application/json",
    },
    ...(signal ? { signal } : {}),
  });
  if (!resp.ok) throw new Error(`models.dev returned ${resp.status}`);
  return resp.text();
}
