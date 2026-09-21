# Unblock Command Code Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/2026-08-28-unblock-catalog/spec.md`
**Branch:** `feature/2026-08-28-unblock-catalog`

**Goal:** OpenCode loads Command Code models from a current bundled catalog with no local `command-code` CLI, no startup stdout leak, and no hard-fail when CLI cost extraction breaks.

**Architecture:** Split bundle load so models are required and costs are optional. Plugin `config` reads bundled `models.json` by default (opt-in local scrape). Sync fills costs from CLI then official docs, then commits `models.json`. Diagnostics go to a JSON file, not stdout.

**Tech Stack:** TypeScript, Bun (`bun test`), existing `src/catalog.ts` extractors, `fetch` for docs/tarball.

## Global Constraints

- Never fail catalog load because costs are missing.
- No `console.log` / `console.warn` in the plugin startup path unless `debugStartupLogs` is true.
- Local `command-code` scrape only when `commandCodePackagePath` or `COMMANDCODE_PACKAGE_PATH` is set.
- Exact id then exact display name for cost matching; no fuzzy matching.
- Do not add GitHub Actions, npm rename, identity aliases, or third-party cost APIs in this plan.
- Tests: `bun test tests/unit/` from repo root `/home/cristhofer-pincetti/Documents/projects/personal/opencode-commandcode-provider`.
- Plugin imports stay as `./src/catalog.js` (existing pattern). Test imports stay as `../../src/catalog.ts`.
- Each task lands exactly one contiguous non-empty commit range (`base..head`).
- Implementation runs on `feature/2026-08-28-unblock-catalog` (create from base via branch setup; tree is currently dirty on `main`).

---

### Task 1: Costless bundle catalog load

**Files:**
- Modify: `src/catalog.ts` (`loadCatalogFromBundle`)
- Test: `tests/unit/catalog.test.ts`

**Interfaces:**
- Consumes: existing `extractModelCatalog`, `extractCostData`, `buildCostMap`, `buildModelEntry`
- Produces: `loadCatalogFromBundle(source: string): ModelEntry[]` — returns models even when `extractCostData` throws; uses empty cost map then `FALLBACK_COSTS` / default `{ input: 0.5, output: 2 }` via `buildModelEntry`

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("loadCatalogFromBundle")` in `tests/unit/catalog.test.ts` (keep the existing happy-path test):

```ts
  test("returns models when cost extraction fails", () => {
    const source = [
      '(Wt={ANTHROPIC:"anthropic",OPENAI:"openai",VERCEL_AI_GATEWAY:"vercel-ai-gateway"});',
      'var Aa="chatComplete",Ba="responses",qt=Vt[0];',
      'var Sn=(Wt=>({',
      'SONNET_4_6:{id:"claude-sonnet-4-6",provider:Wt.ANTHROPIC,spec:Aa,label:"Sonnet",name:"Claude Sonnet 4.6",description:"d",reasoning:!0,reasoningEfforts:["low","medium","high"],contextWindow:2e5}',
      '}))(Wt);',
    ].join("")

    const entries = loadCatalogFromBundle(source)
    const sonnet = entries.find((e) => e.id === "claude-sonnet-4-6")
    expect(sonnet).toBeDefined()
    expect(sonnet!.reasoningEfforts).toEqual(["low", "medium", "high"])
    expect(sonnet!.cost).toEqual({ input: 0.5, output: 2 })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/catalog.test.ts`

Expected: FAIL — `loadCatalogFromBundle` throws `Could not find cost data anchor` or `Could not evaluate cost data map`.

- [ ] **Step 3: Write minimal implementation**

In `src/catalog.ts`, replace `loadCatalogFromBundle` with:

```ts
export function loadCatalogFromBundle(source: string): ModelEntry[] {
  const models = extractModelCatalog(source)
  let costMap = new Map<string, CostEntry>()
  try {
    costMap = buildCostMap(extractCostData(source))
  } catch {
    // ponytail: CLI cost map is optional; buildModelEntry applies FALLBACK_COSTS / defaults
  }

  const entries: ModelEntry[] = []
  for (const model of Object.values(models)) {
    if (!model || typeof model !== "object" || typeof model.id !== "string") continue
    const entry = buildModelEntry(model, costMap)
    if (entry) entries.push(entry)
  }

  for (const extra of HARDCODED_EXTRAS) {
    if (!entries.some((e) => e.id === extra.id)) {
      const entry = buildModelEntry(extra, costMap)
      if (entry) entries.push(entry)
    }
  }

  return sortModelEntries(entries)
}
```

Do not change `extractCostData` (it may still throw). `loadCatalogFromLocalCommandCode` already calls `loadCatalogFromBundle` and will stop returning `null` on cost-only failure.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/catalog.test.ts`

Expected: PASS (existing costful fixture still extracts numeric costs; new fixture uses default cost).

- [ ] **Step 5: Commit**

```bash
git add src/catalog.ts tests/unit/catalog.test.ts
git commit -m "$(cat <<'EOF'
fix: load command-code models when cost extraction fails

EOF
)"
```

---

### Task 2: Quiet bundled startup

**Files:**
- Modify: `plugin.ts`
- Test: `tests/unit/plugin.test.ts`
- Create: `src/startup.ts`

**Interfaces:**
- Consumes: `loadModels` path via bundled `models.json`; `loadCatalogFromLocalCommandCode` only when override is set; `generateOpencodeModels`
- Produces:
  - `pluginStateDir(): string` → `join(homedir(), ".local/state/opencode/commandcode-provider")`
  - `catalogCachePath(): string` → `join(pluginStateDir(), "catalog-cache.json")`
  - `startupSummaryPath(): string` → `join(pluginStateDir(), "startup.json")`
  - `readCatalogCache(): ModelEntry[] | null`
  - `writeCatalogCache(models: ModelEntry[]): void`
  - `writeStartupSummary(summary: StartupSummary): void`
  - `type StartupSummary = { catalogSource: "bundled" | "cache" | "opt-in-local"; commandCodeVersion: string | null; modelCount: number; reasoningModelCount: number; degraded: boolean; degradedReason: string | null }`
  - Plugin `config` never calls `console.log` / `console.warn` unless `debugStartupLogs === true`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/plugin.test.ts`:

```ts
test("config does not write to stdout or stderr by default", async () => {
  const logs: unknown[][] = []
  const warns: unknown[][] = []
  const origLog = console.log
  const origWarn = console.warn
  console.log = (...args: unknown[]) => {
    logs.push(args)
  }
  console.warn = (...args: unknown[]) => {
    warns.push(args)
  }
  try {
    const plugin = await pluginFn()
    const config: Record<string, unknown> = { provider: { commandcode: {} } }
    await plugin.config(config)
    expect(logs).toEqual([])
    expect(warns).toEqual([])
    const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
    expect(cc.models).toBeDefined()
    expect(Object.keys(cc.models as object).length).toBeGreaterThan(0)
  } finally {
    console.log = origLog
    console.warn = origWarn
  }
})
```

Add `tests/unit/startup.test.ts`:

```ts
import { expect, test, describe } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  readCatalogCache,
  writeCatalogCache,
  writeStartupSummary,
  type ModelEntry,
} from "../../src/startup.ts"

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
]

describe("catalog cache", () => {
  test("round-trips models and returns null for missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-cache-"))
    try {
      expect(readCatalogCache(dir)).toBeNull()
      writeCatalogCache(dir, sample)
      expect(readCatalogCache(dir)).toEqual(sample)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("startup summary", () => {
  test("writes startup.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-sum-"))
    try {
      writeStartupSummary(dir, {
        catalogSource: "bundled",
        commandCodeVersion: "1.38.0",
        modelCount: 1,
        reasoningModelCount: 1,
        degraded: false,
        degradedReason: null,
      })
      const parsed = JSON.parse(readFileSync(join(dir, "startup.json"), "utf-8"))
      expect(parsed.catalogSource).toBe("bundled")
      expect(parsed.modelCount).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/startup.test.ts tests/unit/plugin.test.ts`

Expected: FAIL — `src/startup.ts` not found; plugin test FAIL if `console.log` still runs (or PASS for plugin if bundled path already silent — then the new plugin test still documents the contract).

- [ ] **Step 3: Write `src/startup.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import type { ModelEntry } from "./catalog.js"

export type StartupSummary = {
  catalogSource: "bundled" | "cache" | "opt-in-local"
  commandCodeVersion: string | null
  modelCount: number
  reasoningModelCount: number
  degraded: boolean
  degradedReason: string | null
}

export function pluginStateDir(): string {
  return join(homedir(), ".local/state/opencode/commandcode-provider")
}

export function readCatalogCache(dir = pluginStateDir()): ModelEntry[] | null {
  const path = join(dir, "catalog-cache.json")
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed as ModelEntry[]
  } catch {
    return null
  }
}

export function writeCatalogCache(dir: string, models: ModelEntry[]): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "catalog-cache.json"), JSON.stringify(models) + "\n", "utf-8")
}

export function writeStartupSummary(dir: string, summary: StartupSummary): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "startup.json"), JSON.stringify(summary) + "\n", "utf-8")
}
```

- [ ] **Step 4: Rewrite plugin config hook**

Replace `plugin.ts` so that:

1. Delete `checkModelVersion` entirely.
2. `loadModels` returns `ModelEntry[] | null` instead of throwing.
3. Default catalog = bundled; call `loadCatalogFromLocalCommandCode` only when `pluginCfg.commandCodePackagePath` or `process.env.COMMANDCODE_PACKAGE_PATH` is set.
4. If bundled read fails, use `readCatalogCache()`; if that fails, `models = []` and still set `cc.npm` / `cc.env` / `cc.models = {}`.
5. After a successful non-empty load, `writeCatalogCache(pluginStateDir(), models)`.
6. Always `writeStartupSummary(pluginStateDir(), ...)`.
7. `console.log` / `console.warn` only when `pluginCfg.debugStartupLogs === true`.
8. Do not call `fetchModelsFromApi` in this increment (optional API merge is out of scope here; it can hang startup for 5s).

Keep auth block unchanged.

`loadPluginConfig` interface:

```ts
interface PluginFileConfig {
  disableModelSync?: boolean
  commandCodePackagePath?: string
  debugStartupLogs?: boolean
}
```

Config hook body (replace the current `config` function):

```ts
    config: async (config: Record<string, unknown>) => {
      if (!(config as Record<string, unknown>).provider) {
        ;(config as Record<string, unknown>).provider = { commandcode: {} }
      }
      const cc = ((config as Record<string, unknown>).provider as Record<string, Record<string, unknown>>)
        ?.commandcode as Record<string, unknown> | undefined
      if (!cc) return

      const pluginCfg = loadPluginConfig()
      const debug = pluginCfg.debugStartupLogs === true
      const override =
        pluginCfg.commandCodePackagePath?.trim() ||
        process.env.COMMANDCODE_PACKAGE_PATH?.trim() ||
        ""

      if (!cc.npm) cc.npm = "commandcode-go-opencode-provider"
      if (!cc.name) cc.name = "Command Code"
      if (!cc.env) cc.env = ["COMMANDCODE_API_KEY"]

      if (cc.models) return

      let models: ModelEntry[] = []
      let catalogSource: "bundled" | "cache" | "opt-in-local" = "bundled"
      let commandCodeVersion: string | null = null
      let degraded = false
      let degradedReason: string | null = null

      if (override) {
        const localCatalog = loadCatalogFromLocalCommandCode({ packagePath: override })
        if (localCatalog && localCatalog.models.length > 0) {
          models = localCatalog.models
          catalogSource = "opt-in-local"
          commandCodeVersion = localCatalog.version
        }
      }

      if (models.length === 0) {
        const bundled = loadBundledModels()
        if (bundled) {
          models = bundled
          catalogSource = "bundled"
          commandCodeVersion = readBundledVersion()
        } else {
          const cached = readCatalogCache()
          if (cached) {
            models = cached
            catalogSource = "cache"
            degraded = true
            degradedReason = "bundled models.json unreadable; using last-good cache"
          } else {
            degraded = true
            degradedReason = "no bundled catalog and no cache"
          }
        }
      }

      if (models.length > 0) {
        try {
          writeCatalogCache(pluginStateDir(), models)
        } catch {
          // ignore cache write
        }
      }

      cc.models = generateOpencodeModels(models)

      const summary = {
        catalogSource,
        commandCodeVersion,
        modelCount: models.length,
        reasoningModelCount: models.filter((m) => m.reasoning).length,
        degraded,
        degradedReason,
      }
      try {
        writeStartupSummary(pluginStateDir(), summary)
      } catch {
        // ignore
      }
      if (debug) {
        console.warn("[commandcode]", JSON.stringify(summary))
      }
    },
```

Rename current `loadModels` to `loadBundledModels(): ModelEntry[] | null` (return `null` on throw). Add `readBundledVersion()` that reads `_version.txt` first line or `null`.

Import `readCatalogCache`, `writeCatalogCache`, `writeStartupSummary`, `pluginStateDir` from `./src/startup.js`.

- [ ] **Step 5: Run tests**

Run: `bun test tests/unit/plugin.test.ts tests/unit/startup.test.ts tests/unit/catalog.test.ts`

Expected: PASS. Existing plugin tests still see `cc.models` from bundled `models.json`.

- [ ] **Step 6: Commit**

```bash
git add plugin.ts src/startup.ts tests/unit/plugin.test.ts tests/unit/startup.test.ts
git commit -m "$(cat <<'EOF'
fix: load bundled catalog without leaking plugin logs into OpenCode

EOF
)"
```

---

### Task 3: Official-docs costs and refresh bundled catalog

**Files:**
- Create: `src/costs-docs.ts`
- Create: `tests/unit/costs-docs.test.ts`
- Create: `tests/fixtures/command-code/models-page.md`
- Modify: `scripts/sync-models.ts`
- Modify: `models.json` (generated)
- Modify: `_version.txt` (generated)

**Interfaces:**
- Consumes: `ModelEntry` from `src/catalog.ts`; `loadCatalogFromBundle` (Task 1)
- Produces:
  - `parseMoneyCell(cell: string): number | undefined`
  - `parseModelsTable(markdown: string): DocCostRow[]`
  - `applyDocCosts(models: ModelEntry[], rows: DocCostRow[]): { filled: number }`
  - `type DocCostRow = { name: string; id?: string; input: number; output: number; cache_read?: number; cache_write?: number }`
  - `sync-models.ts` after CLI extract: fetch `https://commandcode.ai/models`, apply docs costs for models still on default `{ input: 0.5, output: 2 }` **or** missing from CLI cost map. Simpler rule: apply docs cost when the row matches and CLI did not set a cost from `extractCostData`. Track CLI hits by calling `extractCostData` in try/catch in the sync script and passing ids that already have CLI costs.

Sync fill rule (locked):
- If CLI cost map has the model id, keep CLI cost.
- Else if a docs row matches exact id (case-insensitive) or exact `name` (case-insensitive), apply docs cost.
- Else leave `buildModelEntry` fallback.

- [ ] **Step 1: Write fixture + failing tests**

Create `tests/fixtures/command-code/models-page.md`:

```markdown
| Model | Context | Input | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- | --- |
| Claude Sonnet 4.6 | 200K | $3.00 | $15.00 | $0.30 | $3.75 |
| Gemini 3.7 Flash-50% | 1M | $1.50$0.75 | $7.50$3.75 | $0.15$0.075 | — |
| Laguna S 2.1FREE | 256K | Free | Free | Free | — |
```

Create `tests/unit/costs-docs.test.ts`:

```ts
import { expect, test, describe } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { applyDocCosts, parseModelsTable, parseMoneyCell } from "../../src/costs-docs.ts"
import type { ModelEntry } from "../../src/catalog.ts"

describe("parseMoneyCell", () => {
  test("reads billed amount when a deal shows two prices", () => {
    expect(parseMoneyCell("$1.50$0.75")).toBe(0.75)
    expect(parseMoneyCell("$3.00")).toBe(3)
    expect(parseMoneyCell("Free")).toBe(0)
    expect(parseMoneyCell("—")).toBeUndefined()
  })
})

describe("parseModelsTable", () => {
  test("parses display names and billed rates", () => {
    const md = readFileSync(join(import.meta.dir, "../fixtures/command-code/models-page.md"), "utf-8")
    const rows = parseModelsTable(md)
    expect(rows.find((r) => r.name === "Claude Sonnet 4.6")).toEqual({
      name: "Claude Sonnet 4.6",
      input: 3,
      output: 15,
      cache_read: 0.3,
      cache_write: 3.75,
    })
    const gemini = rows.find((r) => r.name === "Gemini 3.7 Flash-50%")
    expect(gemini?.input).toBe(0.75)
    expect(gemini?.output).toBe(3.75)
    expect(rows.find((r) => r.name === "Laguna S 2.1FREE")?.input).toBe(0)
  })
})

describe("applyDocCosts", () => {
  test("fills by exact name and skips models that already have cli costs", () => {
    const models: ModelEntry[] = [
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        tier: "premium",
        reasoning: true,
        tool_call: true,
        cost: { input: 0.5, output: 2 },
        limit: { context: 200000, output: 16000 },
      },
      {
        id: "keep/cli",
        name: "Keep Cli",
        tier: "open-source",
        reasoning: false,
        tool_call: true,
        cost: { input: 9, output: 9 },
        limit: { context: 1000, output: 1000 },
      },
    ]
    const filled = applyDocCosts(models, parseModelsTable(
      readFileSync(join(import.meta.dir, "../fixtures/command-code/models-page.md"), "utf-8"),
    ), new Set(["keep/cli"]))
    expect(filled).toBe(1)
    expect(models[0].cost).toEqual({ input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 })
    expect(models[1].cost).toEqual({ input: 9, output: 9 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/costs-docs.test.ts`

Expected: FAIL — `src/costs-docs.ts` not found.

- [ ] **Step 3: Implement `src/costs-docs.ts`**

```ts
import type { ModelEntry } from "./catalog.js"

export type DocCostRow = {
  name: string
  id?: string
  input: number
  output: number
  cache_read?: number
  cache_write?: number
}

export function parseMoneyCell(cell: string): number | undefined {
  const trimmed = cell.trim()
  if (!trimmed || trimmed === "—" || trimmed === "-") return undefined
  if (/^free$/i.test(trimmed)) return 0
  const amounts = [...trimmed.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1]))
  if (amounts.length === 0) return undefined
  return amounts[amounts.length - 1]
}

export function parseModelsTable(markdown: string): DocCostRow[] {
  const rows: DocCostRow[] = []
  for (const line of markdown.split("\n")) {
    if (!line.includes("|")) continue
    const cells = line.split("|").map((c) => c.trim()).filter((c, i, arr) => !(i === 0 && c === "") && !(i === arr.length - 1 && c === ""))
    if (cells.length < 4) continue
    if (/^model$/i.test(cells[0]) || /^---/.test(cells[0])) continue
    const input = parseMoneyCell(cells[2] ?? "")
    const output = parseMoneyCell(cells[3] ?? "")
    if (input === undefined || output === undefined) continue
    const row: DocCostRow = { name: cells[0], input, output }
    const cacheRead = parseMoneyCell(cells[4] ?? "")
    const cacheWrite = parseMoneyCell(cells[5] ?? "")
    if (cacheRead !== undefined) row.cache_read = cacheRead
    if (cacheWrite !== undefined) row.cache_write = cacheWrite
    rows.push(row)
  }
  return rows
}

export function applyDocCosts(
  models: ModelEntry[],
  rows: DocCostRow[],
  cliIds: Set<string> = new Set(),
): number {
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]))
  const byId = new Map(rows.filter((r) => r.id).map((r) => [r.id!.toLowerCase(), r]))
  let filled = 0
  for (const model of models) {
    if (cliIds.has(model.id)) continue
    const row = byId.get(model.id.toLowerCase()) ?? byName.get(model.name.toLowerCase())
    if (!row) continue
    model.cost = { input: row.input, output: row.output }
    if (row.cache_read !== undefined) model.cost.cache_read = row.cache_read
    if (row.cache_write !== undefined) model.cost.cache_write = row.cache_write
    filled++
  }
  return filled
}

export async function fetchOfficialModelsMarkdown(): Promise<string> {
  const urls = [
    "https://commandcode.ai/models",
    "https://commandcode.ai/docs/resources/pricing-limits",
  ]
  for (const url of urls) {
    try {
      const resp = await fetch(url)
      if (!resp.ok) continue
      const text = await resp.text()
      if (parseModelsTable(text).length > 0) return text
    } catch {
      // try next
    }
  }
  return ""
}
```

Note: live `/models` HTML may not match the markdown fixture. If `parseModelsTable(html)` returns 0 rows, add a second parser path that still uses `|` rows when present; do not scrape arbitrary DOM. If both live pages yield 0 rows, sync still writes models with CLI/fallback costs and does not fail.

If the live page uses a different column order, adjust `parseModelsTable` **only after** saving a real snippet into `tests/fixtures/command-code/models-page.live.md` and extending tests. Do not guess column indexes without a fixture.

- [ ] **Step 4: Run unit tests**

Run: `bun test tests/unit/costs-docs.test.ts`

Expected: PASS.

- [ ] **Step 5: Wire `scripts/sync-models.ts`**

After `loadCatalogFromBundle(bundle.source)` (or local catalog), compute `cliIds`:

```ts
import { extractCostData, buildCostMap } from "../src/catalog.js"
import { applyDocCosts, fetchOfficialModelsMarkdown, parseModelsTable } from "../src/costs-docs.js"

function cliCostIds(source: string): Set<string> {
  try {
    return new Set(buildCostMap(extractCostData(source)).keys())
  } catch {
    return new Set()
  }
}
```

In `main`, after `entries` is assigned:

```ts
  const sourceForCosts = local ? readFileSync(local /* need bundle path */) : (await fetchLatestBundle already discarded source)
```

Restructure so both local and remote keep the bundle `source` string in scope:

```ts
  let bundleSource: string | null = null
  const local = !forceRemote ? loadCatalogFromLocalCommandCode() : null
  if (local) {
    entries = local.models
    version = local.version
    const resolved = /* already inside loadCatalogFromLocalCommandCode — change it instead */
  }
```

Minimal change: extend `LocalCatalogResult` in `src/catalog.ts`:

```ts
export interface LocalCatalogResult {
  models: ModelEntry[]
  version: string
  root: string
  bundleSource: string
}
```

Set `bundleSource: source` in `loadCatalogFromLocalCommandCode`. `fetchLatestBundle` already returns `source`.

Then:

```ts
  const cliIds = bundleSource ? cliCostIds(bundleSource) : new Set<string>()
  const docsMd = await fetchOfficialModelsMarkdown()
  if (docsMd) applyDocCosts(entries, parseModelsTable(docsMd), cliIds)
```

Keep writing `models.json` and `_version.txt` as today. CLI `console.log` in the sync script is allowed (not the OpenCode plugin).

Default `forceRemote` stays as `--remote` flag; the one-shot refresh **must** be run with `--remote` so it does not depend on a local CLI.

- [ ] **Step 6: Refresh committed catalog**

Run from repo root:

```bash
bun run sync --remote
```

Expected: prints a current `command-code` version (not `1.1.0`), writes `models.json` with tens of models, updates `_version.txt`.

If network fails, stop and fix; do not commit the old 1.1.0 catalog as if it were refreshed.

- [ ] **Step 7: Re-run unit tests + plugin test**

Run: `bun test tests/unit/`

Expected: PASS. Plugin test `withVariants.length > 0` still holds if the new `models.json` includes `reasoningEfforts`.

If that plugin test fails because the live catalog uses a different shape, keep `reasoningEfforts` as extracted from the tarball (Task 1). Do not invent efforts.

- [ ] **Step 8: Commit**

```bash
git add src/costs-docs.ts src/catalog.ts scripts/sync-models.ts tests/unit/costs-docs.test.ts tests/fixtures/command-code/models-page.md models.json _version.txt
git commit -m "$(cat <<'EOF'
feat: fill catalog costs from official docs and refresh bundled models

EOF
)"
```

---

## Spec coverage (this increment)

| Requirement | Task |
|---|---|
| Costless `loadCatalogFromBundle` | 1 |
| No stdout leak; bundled default; opt-in local | 2 |
| Last-good cache; startup summary file | 2 |
| Auth still registers with empty models | 2 (`cc.models = {}`) |
| Official docs cost fill | 3 |
| Refresh `models.json` from latest tarball | 3 |
| CI workflow / npm publish / identity aliases | out of scope |
