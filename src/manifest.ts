import { writeFileSync } from "fs";

export type CatalogStatus = "healthy" | "degraded" | "broken";
export type CostCatalogBest = "cli" | "docs" | "thirdParty" | "free" | "fallback" | "missing";

export type CostSources = {
  cli: number;
  officialDocs: number;
  thirdParty: number;
  free: number;
  fallback: number;
  unmatched: number;
};

export type UnavailableEntry = {
  id: string;
  reason: "not-listed-by-provider-api";
};

export type CatalogReview = {
  thirdParty: string[];
  free: string[];
  unmatched: string[];
  unavailable?: UnavailableEntry[];
};

export type CatalogManifest = {
  schemaVersion: 1;
  generatedAt: string;
  pluginVersion: string;
  commandCodeVersion: string;
  commandCodeTarball: string;
  modelCount: number;
  reasoningModelCount: number;
  extraction: {
    modelCatalog: "ok" | "failed";
    costCatalog: CostCatalogBest;
    costCatalogError: string | null;
  };
  costSources: CostSources;
  review?: CatalogReview;
  status: CatalogStatus;
};

export type BuildManifestInput = {
  pluginVersion: string;
  commandCodeVersion: string;
  commandCodeTarball: string;
  modelCount: number;
  reasoningModelCount: number;
  modelCatalogOk: boolean;
  costSources: CostSources;
  review?: CatalogReview;
  generatedAt: string;
  costCatalogError?: string | null;
};

export function withUnavailableIds(
  review: CatalogReview | undefined,
  unavailable: string[],
): CatalogReview | undefined {
  const entries: UnavailableEntry[] = [...unavailable]
    .sort()
    .map((id) => ({ id, reason: "not-listed-by-provider-api" as const }));
  if (entries.length === 0) return review;
  return { ...(review ?? { thirdParty: [], free: [], unmatched: [] }), unavailable: entries };
}

/** Update only the embedded plugin version; reject a missing target version. */
export function withPluginVersion(manifest: CatalogManifest, version: string): CatalogManifest {
  if (!version || typeof version !== "string" || version.trim().length === 0) {
    throw new Error("target plugin version must be a non-empty string");
  }
  return { ...manifest, pluginVersion: version };
}

export function bumpPatch(version: string): string {
  const parts = version.split(".");
  const patch = Number(parts[2] ?? "0");
  return `${parts[0] ?? "0"}.${parts[1] ?? "0"}.${patch + 1}`;
}

export function meetsModelCountFloor(modelCount: number, lastSuccessful: number | null): boolean {
  const floor = Math.max(20, Math.floor((lastSuccessful ?? 20) * 0.5));
  // ponytail: when there is no prior catalog, lastSuccessful is null and the floor is 20
  return modelCount >= (lastSuccessful === null ? 20 : floor);
}

export function bestCostCatalog(sources: CostSources): CostCatalogBest {
  if (sources.cli > 0) return "cli";
  if (sources.officialDocs > 0) return "docs";
  if (sources.thirdParty > 0) return "thirdParty";
  if (sources.free > 0) return "free";
  if (sources.fallback > 0) return "fallback";
  return "missing";
}

export function catalogStatus(modelCatalogOk: boolean, sources: CostSources): CatalogStatus {
  if (!modelCatalogOk) return "broken";
  if (sources.unmatched > 0) return "degraded";
  return "healthy";
}

export function commandCodeTarballUrl(version: string): string {
  return `https://registry.npmjs.org/command-code/-/command-code-${version}.tgz`;
}

export function buildManifest(input: BuildManifestInput): CatalogManifest {
  const status = catalogStatus(input.modelCatalogOk, input.costSources);
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    pluginVersion: input.pluginVersion,
    commandCodeVersion: input.commandCodeVersion,
    commandCodeTarball: input.commandCodeTarball,
    modelCount: input.modelCount,
    reasoningModelCount: input.reasoningModelCount,
    extraction: {
      modelCatalog: input.modelCatalogOk ? "ok" : "failed",
      costCatalog: bestCostCatalog(input.costSources),
      costCatalogError: input.costCatalogError ?? null,
    },
    costSources: { ...input.costSources },
    ...(input.review ? { review: input.review } : {}),
    status,
  };
}

export function writeManifest(path: string, manifest: CatalogManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

export function lastSuccessfulModelCount(manifest: CatalogManifest | null): number | null {
  if (!manifest) return null;
  if (manifest.status === "broken") return null;
  return manifest.modelCount;
}

export function countCostSources(input: {
  modelIds: string[];
  cliIds: Set<string>;
  officialDocIds: Set<string>;
  thirdPartyIds: Set<string>;
  freeIds: Set<string>;
  fallbackIds?: Set<string>;
}): CostSources {
  const fallbackIds = input.fallbackIds ?? new Set<string>();
  const sources: CostSources = {
    cli: 0,
    officialDocs: 0,
    thirdParty: 0,
    free: 0,
    fallback: 0,
    unmatched: 0,
  };
  for (const id of input.modelIds) {
    if (input.cliIds.has(id)) sources.cli++;
    else if (input.officialDocIds.has(id)) sources.officialDocs++;
    else if (input.thirdPartyIds.has(id)) sources.thirdParty++;
    else if (input.freeIds.has(id)) sources.free++;
    else if (fallbackIds.has(id)) sources.fallback++;
    else sources.unmatched++;
  }
  return sources;
}

export function bumpPackageVersionField(pkgJson: string): { json: string; version: string } {
  const pkg = JSON.parse(pkgJson) as { version: string };
  const version = bumpPatch(pkg.version);
  const json = pkgJson.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${version}$3`);
  return { json, version };
}
