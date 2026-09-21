import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  generateOpencodeModels,
  loadCatalogFromLocalCommandCode,
  type ModelEntry,
} from "./src/catalog.js";
import {
  readCatalogCache,
  writeCatalogCache,
  writeStartupSummary,
  pluginStateDir,
} from "./src/startup.js";
import type { CatalogManifest } from "./src/manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_PATH = join(__dirname, "models.json");
const VERSION_PATH = join(__dirname, "_version.txt");
const MANIFEST_PATH = join(__dirname, "manifest.json");

interface PluginFileConfig {
  disableModelSync?: boolean;
  commandCodePackagePath?: string;
  debugStartupLogs?: boolean;
}

function loadPluginConfig(): PluginFileConfig {
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

export type { ModelEntry };

function loadBundledModels(): ModelEntry[] | null {
  try {
    return JSON.parse(readFileSync(MODELS_PATH, "utf-8"));
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
    const parts = readFileSync(VERSION_PATH, "utf-8").split("\n");
    const first = parts[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

export default async function commandcodePlugin() {
  return {
    config: async (config: Record<string, unknown>) => {
      if (!(config as Record<string, unknown>).provider) {
        (config as Record<string, unknown>).provider = { commandcode: {} };
      }
      const cc = (
        (config as Record<string, unknown>).provider as Record<string, Record<string, unknown>>
      )?.commandcode as Record<string, unknown> | undefined;
      if (!cc) return;

      const pluginCfg = loadPluginConfig();
      const debug = pluginCfg.debugStartupLogs === true;
      const override =
        pluginCfg.commandCodePackagePath?.trim() ||
        process.env.COMMANDCODE_PACKAGE_PATH?.trim() ||
        "";

      if (!cc.npm) cc.npm = "commandcode-go-opencode-provider";
      if (!cc.name) cc.name = "Command Code";
      if (!cc.env) cc.env = ["COMMANDCODE_API_KEY"];

      if (cc.models) return;

      let models: ModelEntry[] = [];
      let catalogSource: "bundled" | "cache" | "opt-in-local" = "bundled";
      let commandCodeVersion: string | null = null;
      let degraded = false;
      let degradedReason: string | null = null;

      if (override) {
        const localCatalog = loadCatalogFromLocalCommandCode({ packagePath: override });
        if (localCatalog && localCatalog.models.length > 0) {
          models = localCatalog.models;
          catalogSource = "opt-in-local";
          commandCodeVersion = localCatalog.version;
        }
      }

      if (models.length === 0) {
        const bundled = loadBundledModels();
        if (bundled) {
          models = bundled;
          catalogSource = "bundled";
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
            catalogSource = "cache";
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

      cc.models = generateOpencodeModels(models);

      const summary = {
        catalogSource,
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
    },

    auth: {
      provider: "commandcode",
      methods: [
        {
          type: "api",
          label: "API Key",
          authorize: async (inputs: Record<string, unknown> | undefined) => {
            const rawKey = inputs?.key;
            if (typeof rawKey !== "string") return { type: "failed" as const };
            const key = rawKey.trim();
            if (!key) return { type: "failed" as const };
            return { type: "success" as const, key };
          },
        },
      ],
      loader: async (getAuth: () => Promise<{ type: string; key?: string } | null>) => {
        try {
          const auth = await getAuth();
          if (!auth) return {};
          if (auth.type === "api" && auth.key) return { apiKey: auth.key };
          return {};
        } catch {
          return {};
        }
      },
    },
  };
}
