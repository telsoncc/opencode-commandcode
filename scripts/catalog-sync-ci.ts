#!/usr/bin/env bun
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { catalogBreakTitle, renderCatalogBreakBody } from "../src/catalog-break.js";
import { decideCatalogSync } from "../src/publish-policy.js";
import { npmLatestVersion, npmPackageVersions } from "./npm-registry.js";

const ROOT = join(import.meta.dir, "..");
const CATALOG_FILES = ["models.json", "_version.txt", "manifest.json"];
const CATALOG_BRANCH = "chore/catalog-sync";

function bundledCommandCodeVersion(): string | null {
  const path = join(ROOT, "_version.txt");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8").split("\n")[0]?.trim() || null;
}

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf-8" }).trim();
}

function openOrUpdateCatalogBreak(input: { commandCodeVersion: string; error: string }): void {
  const title = catalogBreakTitle(input.commandCodeVersion);
  const body = renderCatalogBreakBody({
    commandCodeVersion: input.commandCodeVersion,
    error: input.error,
    workflowUrl:
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : "(local)",
    bundledCommandCodeVersion: bundledCommandCodeVersion(),
  });
  const existing = execSync(
    `gh issue list --label catalog-break --state open --json number,title`,
    { cwd: ROOT, encoding: "utf-8" },
  );
  const issues = JSON.parse(existing) as Array<{ number: number; title: string }>;
  if (issues.length === 0) {
    execSync(
      `gh issue create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --label catalog-break --label automation`,
      {
        cwd: ROOT,
        stdio: "inherit",
      },
    );
    return;
  }
  execSync(`gh issue comment ${issues[0].number} --body ${JSON.stringify(body)}`, {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function queuePrAutoMerge(): void {
  execSync("gh pr merge --auto --squash --delete-branch", { cwd: ROOT, stdio: "inherit" });
}

function openCatalogPr(commandCodeVersion: string): void {
  const status = git(`status --porcelain -- ${CATALOG_FILES.join(" ")}`);
  if (!status) {
    console.log("catalog files unchanged");
    return;
  }
  git('config user.name "github-actions[bot]"');
  git('config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
  execSync(`git checkout -B ${CATALOG_BRANCH}`, { cwd: ROOT, stdio: "inherit" });
  execSync(`git add ${CATALOG_FILES.join(" ")}`, { cwd: ROOT, stdio: "inherit" });
  execSync(
    `git commit -m ${JSON.stringify(`fix(catalog): sync command-code@${commandCodeVersion}`)}`,
    { cwd: ROOT, stdio: "inherit" },
  );
  execSync(`git push -u origin ${CATALOG_BRANCH} --force`, { cwd: ROOT, stdio: "inherit" });
  const existing = execSync(`gh pr list --head ${CATALOG_BRANCH} --base main --json number`, {
    cwd: ROOT,
    encoding: "utf-8",
  });
  const prs = JSON.parse(existing) as Array<{ number: number }>;
  if (prs.length > 0) {
    console.log(`updated catalog PR #${prs[0].number}`);
    queuePrAutoMerge();
    return;
  }
  execSync(
    `gh pr create --base main --head ${CATALOG_BRANCH} --title ${JSON.stringify(`fix(catalog): sync command-code@${commandCodeVersion}`)} --body ${JSON.stringify(`Automated catalog refresh from command-code@${commandCodeVersion}. Auto-merges when CI is green; semantic-release publishes the patch.`)}`,
    { cwd: ROOT, stdio: "inherit" },
  );
  queuePrAutoMerge();
}

async function main(): Promise<void> {
  const force = process.env.FORCE === "true" || process.argv.includes("--force");
  const pkgPath = join(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name: string; version: string };
  const latestCc = await npmLatestVersion("command-code");
  const published = await npmPackageVersions(pkg.name);
  const decision = decideCatalogSync({
    force,
    latestCommandCodeVersion: latestCc,
    bundledCommandCodeVersion: bundledCommandCodeVersion(),
    pluginVersion: pkg.version,
    publishedPluginVersions: published,
  });

  console.log(JSON.stringify({ latestCc, pluginVersion: pkg.version, decision }));

  if (!decision.extract) {
    console.log("no catalog extract (release job owns unpublished plugin versions)");
    return;
  }

  // sync-models.ts validates availability and the model-count floor before the
  // first artifact write, so any failure there leaves the last-good catalog
  // untouched and routes here through the catalog-break issue path.
  const beforeModels = existsSync(join(ROOT, "models.json"))
    ? readFileSync(join(ROOT, "models.json"), "utf-8")
    : "";
  const beforeVersion = bundledCommandCodeVersion();

  try {
    execSync("bun run scripts/sync-models.ts -- --remote", { cwd: ROOT, stdio: "inherit" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      openOrUpdateCatalogBreak({ commandCodeVersion: latestCc, error: message });
    } catch (issueErr) {
      console.error("failed to open catalog-break issue", issueErr);
    }
    process.exitCode = 1;
    return;
  }

  const afterModels = readFileSync(join(ROOT, "models.json"), "utf-8");

  const changed = afterModels !== beforeModels || bundledCommandCodeVersion() !== beforeVersion;
  if (!changed) {
    console.log("extract produced no catalog changes");
    return;
  }

  if (process.env.CI === "true") {
    openCatalogPr(bundledCommandCodeVersion() ?? latestCc);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
