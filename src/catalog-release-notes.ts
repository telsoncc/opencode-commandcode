import type { CatalogManifest, CatalogReview, CatalogStatus, CostSources } from "./manifest.js";

export type PricedModel = {
  id: string;
  name: string;
  cost: { input: number; output: number };
};

export type CatalogReleaseInput = {
  pluginVersion: string;
  commandCodeVersion: string;
  modelCount: number;
  reasoningModelCount: number;
  status: CatalogStatus;
  costSources: CostSources;
  models: PricedModel[];
  review?: CatalogReview;
};

const DEFAULT_COST = { input: 0.5, output: 2 };

export function partitionPrices(
  models: PricedModel[],
  review: CatalogReview | undefined,
): { thirdParty: PricedModel[]; free: PricedModel[]; unmatched: PricedModel[] } {
  const byId = new Map(models.map((m) => [m.id, m]));
  if (review) {
    return {
      thirdParty: review.thirdParty.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])),
      free: review.free.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])),
      unmatched: review.unmatched.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])),
    };
  }
  const thirdParty: PricedModel[] = [];
  const free: PricedModel[] = [];
  const unmatched: PricedModel[] = [];
  for (const model of models) {
    if (model.cost.input === 0 && model.cost.output === 0) free.push(model);
    else if (model.cost.input === DEFAULT_COST.input && model.cost.output === DEFAULT_COST.output) {
      unmatched.push(model);
    }
  }
  return { thirdParty, free, unmatched };
}

function n(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function headline(status: CatalogStatus): string {
  if (status === "healthy") {
    return "**Catalog is complete.** Prices come from Command Code, official docs, models.dev, or free SKUs.";
  }
  if (status === "broken") {
    return "**Do not use this catalog.** Model extraction failed; OpenCode would not get a current model list.";
  }
  return "**Safe to use.** Every model is listed. Some prices have no listed source — expand the sections below to review them.";
}

function priceSummary(sources: CostSources): string {
  const parts: string[] = [];
  if (sources.cli > 0) parts.push(`${sources.cli} CLI`);
  if (sources.officialDocs > 0) parts.push(`${sources.officialDocs} official docs`);
  if (sources.thirdParty > 0) parts.push(`${sources.thirdParty} models.dev`);
  if (sources.free > 0) parts.push(`${sources.free} free`);
  if (sources.fallback > 0)
    parts.push(`${sources.fallback} hardcoded fallback${sources.fallback === 1 ? "" : "s"}`);
  if (sources.unmatched > 0) parts.push(`${sources.unmatched} no listed price`);
  return parts.join(" · ") || "none";
}

function money(n: number): string {
  return `$${n}`;
}

function modelTable(models: PricedModel[]): string {
  const rows = models
    .map((m) => `| ${m.name} | \`${m.id}\` | ${money(m.cost.input)} / ${money(m.cost.output)} |`)
    .join("\n");
  return `| Model | Id | In / out per 1M |\n| --- | --- | --- |\n${rows}`;
}

function details(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

export function renderCatalogReleaseNotes(input: CatalogReleaseInput): string {
  const { thirdParty, free, unmatched } = partitionPrices(input.models, input.review);
  const sections = [
    headline(input.status),
    "",
    `| Plugin | ${input.pluginVersion} |`,
    "| --- | --- |",
    `| Command Code | ${input.commandCodeVersion} |`,
    `| Models | ${input.modelCount} (${input.reasoningModelCount} with reasoning) |`,
    `| Prices | ${priceSummary(input.costSources)} |`,
  ];

  if (thirdParty.length > 0) {
    sections.push(
      "",
      details(
        n(
          thirdParty.length,
          "model with a models.dev reference price",
          "models with models.dev reference prices",
        ),
        modelTable(thirdParty),
      ),
    );
  }
  if (free.length > 0) {
    sections.push(
      "",
      details(n(free.length, "free model ($0)", "free models ($0)"), modelTable(free)),
    );
  }
  if (unmatched.length > 0) {
    sections.push(
      "",
      details(
        n(
          unmatched.length,
          "model with no listed price ($0.50 / $2)",
          "models with no listed price ($0.50 / $2)",
        ),
        modelTable(unmatched),
      ),
    );
  }

  sections.push(
    "",
    details(
      "Machine-readable catalog",
      "```json\n" +
        JSON.stringify(
          {
            status: input.status,
            pluginVersion: input.pluginVersion,
            commandCodeVersion: input.commandCodeVersion,
            modelCount: input.modelCount,
            reasoningModelCount: input.reasoningModelCount,
            costSources: input.costSources,
          },
          null,
          2,
        ) +
        "\n```",
    ),
  );

  return sections.join("\n") + "\n";
}

export function catalogReleaseNotesFromFiles(input: {
  manifest: CatalogManifest;
  models: PricedModel[];
  pluginVersion?: string;
}): string {
  return renderCatalogReleaseNotes({
    pluginVersion: input.pluginVersion ?? input.manifest.pluginVersion,
    commandCodeVersion: input.manifest.commandCodeVersion,
    modelCount: input.manifest.modelCount,
    reasoningModelCount: input.manifest.reasoningModelCount,
    status: input.manifest.status,
    costSources: input.manifest.costSources,
    models: input.models,
    review: input.manifest.review,
  });
}
