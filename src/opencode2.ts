import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  MODELS_API_URL,
  filterCatalogByAvailability,
  parseAvailabilityIds,
  toConfigKey,
  loadCatalogFromLocalCommandCode,
  type ModelEntry,
} from "./catalog.js";
import { buildEstimatedEntry, loadModelsDevRows, type ModelsDevRow } from "./costs-models-dev.js";
import {
  readCatalogCache,
  writeCatalogCache,
  writeStartupSummary,
  pluginStateDir,
  type StartupSummary,
} from "./startup.js";
import type { CatalogManifest } from "./manifest.js";

// OpenCode 2.0 support: in-memory provider inventory + integration.
//
// The 2.0 host API is duck-typed on purpose (mirrors
// oakimov/cursor-opencode-provider `src/opencode2/types.ts`): importing
// `@opencode/plugin` as a runtime dependency would force a plugin bump on
// every OpenCode release. These shapes only cover what this plugin publishes
// or calls; extra host fields are ignored at runtime.

export const COMMANDCODE_PROVIDER_ID = "commandcode";
export const COMMANDCODE_INTEGRATION_ID = "commandcode";
export const COMMANDCODE_PROVIDER_NAME = "Command Code";
export const COMMANDCODE_BASE_URL = "https://api.commandcode.ai/provider/v1";
export const COMMANDCODE_PACKAGE = "@opencode/ai/providers/openai-compatible";
export const COMMANDCODE_ENV_NAMES = ["COMMANDCODE_API_KEY"];

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const MODELS_PATH = join(MODULE_DIR, "..", "models.json");
const VERSION_PATH = join(MODULE_DIR, "..", "_version.txt");
const MANIFEST_PATH = join(MODULE_DIR, "..", "manifest.json");

export type V2Cost = {
  tier?: { type: "context"; size: number };
  input: number;
  output: number;
  cache: { read: number; write: number };
};

export type V2Variant = {
  id: string;
  settings?: Record<string, unknown>;
};

export type V2ModelInfo = {
  id: string;
  /** Wire id sent to the provider. Lets one upstream model back one entry. */
  modelID: string;
  providerID: string;
  name: string;
  capabilities: { tools: boolean; input: string[]; output: string[] };
  limit: { context: number; output: number };
  variants: V2Variant[];
  status: "active";
  enabled: true;
  time: { released: number };
  cost: V2Cost[];
  settings?: Record<string, unknown>;
};

export type V2ProviderInfo = {
  id: string;
  name: string;
  activation: "enabled";
  package: string;
  integrationID: string;
  settings: Record<string, unknown>;
};

export interface V2ProviderEditor {
  add(input: {
    info: V2ProviderInfo;
    models: readonly V2ModelInfo[];
    sourceConnection?: unknown;
  }): void;
}

export interface V2IntegrationDraft {
  update(id: string, update: (integration: { id: string; name: string }) => void): void;
  readonly method: {
    update(
      input:
        | { readonly integrationID: string; readonly method: { type: "key"; label?: string } }
        | { readonly integrationID: string; readonly method: { type: "env"; names: string[] } },
    ): void;
  };
}

export interface V2SetupContext {
  readonly provider: {
    readonly transform: (
      callback: (editor: V2ProviderEditor) => void,
    ) => Promise<{ dispose: () => Promise<void> }>;
    readonly reload: () => Promise<void>;
  };
  readonly integration: {
    readonly transform: (
      callback: (draft: V2IntegrationDraft) => void,
    ) => Promise<{ dispose: () => Promise<void> }>;
    readonly connection: {
      readonly active: (integrationID: string) => Promise<unknown>;
    };
  };
  readonly event?: {
    readonly subscribe: (...args: unknown[]) => AsyncIterable<{ type?: unknown }>;
  };
}

interface PluginFileConfig {
  disableModelSync?: boolean;
  commandCodePackagePath?: string;
  debugStartupLogs?: boolean;
}

function loadPluginFileConfig(): PluginFileConfig {
  const dir = join(homedir(), ".config", "opencode");
  const configPath = [
    join(dir, "opencode-commandcode.json"),
    join(dir, "commandcode-go-opencode-provider.json"),
  ].find((p) => existsSync(p));
  if (!configPath) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

export function modelEntryToV2(entry: ModelEntry): V2ModelInfo {
  const rawInput = entry.modalities?.input?.filter(
    (m): m is string => typeof m === "string" && m.length > 0,
  ) ?? ["text"];
  const input = rawInput.length > 0 ? [...rawInput] : ["text"];
  const variants: V2Variant[] = (entry.reasoningEfforts ?? []).map((effort) => ({
    id: effort,
    settings: { reasoningEffort: effort },
  }));
  return {
    id: toConfigKey(entry.id),
    modelID: entry.id,
    providerID: COMMANDCODE_PROVIDER_ID,
    name: entry.name,
    capabilities: { tools: entry.tool_call, input, output: ["text"] },
    limit: { context: entry.limit.context, output: entry.limit.output },
    variants,
    status: "active",
    enabled: true,
    // The bundled catalog carries no release dates; 0 sorts these last in the
    // picker, so filter by provider "Command Code" (same convention as the
    // cursor provider plugin).
    time: { released: 0 },
    cost: [
      {
        input: entry.cost.input,
        output: entry.cost.output,
        cache: { read: entry.cost.cache_read ?? 0, write: entry.cost.cache_write ?? 0 },
      },
    ],
  };
}

export function buildV2Models(entries: ModelEntry[]): V2ModelInfo[] {
  return entries.map(modelEntryToV2);
}

export function buildProviderInfo(): V2ProviderInfo {
  return {
    id: COMMANDCODE_PROVIDER_ID,
    name: COMMANDCODE_PROVIDER_NAME,
    activation: "enabled",
    package: COMMANDCODE_PACKAGE,
    integrationID: COMMANDCODE_INTEGRATION_ID,
    settings: { baseURL: COMMANDCODE_BASE_URL },
  };
}

/**
 * Publish the catalog into the live provider inventory. A no-op while empty
 * so a failed load keeps the last successful inventory (same convention as
 * the cursor provider plugin).
 */
export function applyProviderInventory(
  editor: V2ProviderEditor,
  models: ModelEntry[],
  sourceConnection?: unknown,
): void {
  if (models.length === 0) return;
  editor.add({
    info: buildProviderInfo(),
    models: buildV2Models(models),
    ...(sourceConnection === undefined ? {} : { sourceConnection }),
  });
}

/** Register the `commandcode` integration: API-key entry plus env fallback. */
export function applyIntegration(draft: V2IntegrationDraft): void {
  draft.update(COMMANDCODE_INTEGRATION_ID, (integration) => {
    integration.id = COMMANDCODE_INTEGRATION_ID;
    integration.name = COMMANDCODE_PROVIDER_NAME;
  });
  draft.method.update({
    integrationID: COMMANDCODE_INTEGRATION_ID,
    method: { type: "key", label: "API Key" },
  });
  draft.method.update({
    integrationID: COMMANDCODE_INTEGRATION_ID,
    method: { type: "env", names: [...COMMANDCODE_ENV_NAMES] },
  });
}

function loadBundledModels(): ModelEntry[] | null {
  try {
    const parsed = JSON.parse(readFileSync(MODELS_PATH, "utf-8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as ModelEntry[];
  } catch {
    return null;
  }
}

function readBundledManifest(): CatalogManifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as CatalogManifest;
  } catch {
    return null;
  }
}

function readBundledVersion(): string | null {
  const manifest = readBundledManifest();
  if (manifest?.commandCodeVersion) return manifest.commandCodeVersion;
  if (!existsSync(VERSION_PATH)) return null;
  try {
    const first = readFileSync(VERSION_PATH, "utf-8").split("\n")[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

export type V2CatalogSource = "bundled" | "cache" | "opt-in-local" | "remote";

export interface LoadedV2Catalog {
  models: ModelEntry[];
  source: V2CatalogSource;
  commandCodeVersion: string | null;
  degraded: boolean;
  degradedReason: string | null;
}

/**
 * Catalog resolution shared with the V1 `config` hook in `plugin.ts`:
 * opt-in local `command-code` scrape first, then the bundled `models.json`,
 * then the last-good cache. Always refreshes the cache and `startup.json`
 * when models resolve. Keep the two in sync when this changes.
 */
export function loadCatalogForV2(): LoadedV2Catalog {
  const pluginCfg = loadPluginFileConfig();
  const debug = pluginCfg.debugStartupLogs === true;
  const override =
    pluginCfg.commandCodePackagePath?.trim() || process.env.COMMANDCODE_PACKAGE_PATH?.trim() || "";

  let models: ModelEntry[] = [];
  // Mirrors the V1 `config` hook: stays "bundled" when nothing resolves.
  let source: V2CatalogSource = "bundled";
  let commandCodeVersion: string | null = null;
  let degraded = false;
  let degradedReason: string | null = null;

  if (override) {
    const localCatalog = loadCatalogFromLocalCommandCode({ packagePath: override });
    if (localCatalog && localCatalog.models.length > 0) {
      models = localCatalog.models;
      source = "opt-in-local";
      commandCodeVersion = localCatalog.version;
    }
  }

  if (models.length === 0) {
    const bundled = loadBundledModels();
    if (bundled) {
      models = bundled;
      source = "bundled";
      commandCodeVersion = readBundledVersion();
      const manifest = readBundledManifest();
      if (manifest?.status === "degraded" || manifest?.status === "broken") {
        degraded = true;
        degradedReason =
          manifest.status === "broken"
            ? "bundled catalog marked broken"
            : "bundled catalog has models with no listed price";
      }
    } else {
      const cached = readCatalogCache();
      if (cached) {
        models = cached;
        source = "cache";
        degraded = true;
        degradedReason = "bundled models.json unreadable; using last-good cache";
      } else {
        degraded = true;
        degradedReason = "no bundled catalog and no cache";
      }
    }
  }

  if (models.length > 0) {
    try {
      writeCatalogCache(pluginStateDir(), models);
    } catch {
      // ignore cache write
    }
  }

  const summary: StartupSummary = {
    catalogSource: source,
    commandCodeVersion,
    modelCount: models.length,
    reasoningModelCount: models.filter((m) => m.reasoning).length,
    degraded,
    degradedReason,
  };
  try {
    writeStartupSummary(pluginStateDir(), summary);
  } catch {
    // ignore
  }
  if (debug) {
    console.warn("[commandcode]", JSON.stringify(summary));
  }

  return { models, source, commandCodeVersion, degraded, degradedReason };
}

export const REMOTE_SYNC_TIMEOUT_MS = 15_000;
export const REMOTE_SYNC_INTERVAL_MS = 6 * 3600_000;

export interface RemoteRefreshResult {
  models: ModelEntry[];
  unavailable: string[];
  pendingNew: string[];
  remoteCount: number;
  /** Provisional entries published with models.dev estimates. */
  estimated: ModelEntry[];
}

/** Live availability ids from the Provider API. No auth required. */
export async function fetchRemoteAvailability(
  timeoutMs = REMOTE_SYNC_TIMEOUT_MS,
): Promise<string[]> {
  const response = await fetch(MODELS_API_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`availability request failed: HTTP ${response.status}`);
  }
  return parseAvailabilityIds(await response.json());
}

/**
 * Reconcile a local catalog with live availability: keep the ids the API
 * still serves, report retired ones, and list remote ids missing locally.
 * Missing ids stay pending here — refreshCatalogFromRemote tries to publish
 * them with models.dev estimates first.
 */
export function applyRemoteAvailability(
  base: ModelEntry[],
  remoteIds: string[],
): RemoteRefreshResult {
  const { retained, unavailable } = filterCatalogByAvailability(base, remoteIds);
  const known = new Set(base.map((m) => m.id));
  const pendingNew = [...new Set(remoteIds)].filter((id) => !known.has(id)).sort();
  return {
    models: retained,
    unavailable,
    pendingNew,
    remoteCount: remoteIds.length,
    estimated: [],
  };
}

export async function refreshCatalogFromRemote(
  base: ModelEntry[],
  timeoutMs = REMOTE_SYNC_TIMEOUT_MS,
): Promise<RemoteRefreshResult> {
  const result = applyRemoteAvailability(base, await fetchRemoteAvailability(timeoutMs));
  if (result.pendingNew.length === 0) return result;
  let rows: ModelsDevRow[] = [];
  try {
    rows = await loadModelsDevRows();
  } catch {
    return result;
  }
  if (rows.length === 0) return result;
  const usedKeys = new Set(base.map((m) => toConfigKey(m.id)));
  const estimated: ModelEntry[] = [];
  const stillPending: string[] = [];
  for (const id of result.pendingNew) {
    const key = toConfigKey(id);
    if (usedKeys.has(key)) {
      stillPending.push(id);
      continue;
    }
    const entry = buildEstimatedEntry(id, rows);
    if (!entry) {
      stillPending.push(id);
      continue;
    }
    usedKeys.add(key);
    estimated.push(entry);
  }
  return {
    models: [...result.models, ...estimated],
    unavailable: result.unavailable,
    pendingNew: stillPending,
    remoteCount: result.remoteCount,
    estimated,
  };
}

export function isRemoteSyncDisabled(): boolean {
  return loadPluginFileConfig().disableModelSync === true;
}

/** Overwrite the last-good disk cache with a refreshed inventory. */
export function persistRefreshedModels(models: ModelEntry[]): void {
  if (models.length === 0) return;
  try {
    writeCatalogCache(pluginStateDir(), models);
  } catch {
    // ignore cache write
  }
}

export function writeRemoteRefreshSummary(
  result: RemoteRefreshResult,
  commandCodeVersion: string | null,
): void {
  const summary: StartupSummary = {
    catalogSource: "remote",
    commandCodeVersion,
    modelCount: result.models.length,
    reasoningModelCount: result.models.filter((m) => m.reasoning).length,
    degraded: result.models.length === 0,
    degradedReason:
      result.models.length === 0 ? "remote availability matched no local models" : null,
    pendingNewCount: result.pendingNew.length,
    estimatedCount: result.estimated.length,
  };
  try {
    writeStartupSummary(pluginStateDir(), summary);
  } catch {
    // ignore
  }
}

const remoteRefreshRunners = new Set<() => Promise<void>>();
let remoteRefreshTimer: ReturnType<typeof setInterval> | null = null;

export function remoteRefreshRunnerCount(): number {
  return remoteRefreshRunners.size;
}

/**
 * Share one interval across setups in the process. Returns a detach
 * function; the timer stops after the last runner detaches.
 */
export function attachRemoteRefreshRunner(
  run: () => Promise<void>,
  intervalMs = REMOTE_SYNC_INTERVAL_MS,
): () => void {
  remoteRefreshRunners.add(run);
  if (!remoteRefreshTimer) {
    remoteRefreshTimer = setInterval(() => {
      for (const runner of remoteRefreshRunners) {
        void runner().catch(() => {
          // A failed refresh keeps the last inventory; the next tick retries.
        });
      }
    }, intervalMs);
    remoteRefreshTimer.unref?.();
  }
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    remoteRefreshRunners.delete(run);
    if (remoteRefreshRunners.size === 0 && remoteRefreshTimer) {
      clearInterval(remoteRefreshTimer);
      remoteRefreshTimer = null;
    }
  };
}
