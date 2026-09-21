# Catalog Modalities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/2026-08-28-catalog-modalities/spec.md`
**Branch:** `feature/2026-08-28-catalog-modalities`

**Goal:** Bundled catalog models expose OpenCode `attachment` and `modalities` copied from models.dev, with unmatched SKUs defaulting to text-only.

**Architecture:** Extend the existing models.dev parser and matching index. A new `applyModelsDevModalities` runs on every catalog model (unlike the cost skip set). `generateOpencodeModels` always emits the fields. Sync uses one models.dev fetch for both costs and modalities.

**Tech Stack:** TypeScript, Bun (`bun test tests/unit/`), existing `src/costs-models-dev.ts` + `src/catalog.ts`.

## Global Constraints

- No vision allowlist. No session-prompt injection. No overwriting `limit` / `reasoning` / `tool_call`.
- Runtime does not fetch models.dev.
- Tests: `bun test tests/unit/` from `/home/cristhofer-pincetti/Documents/projects/personal/opencode-commandcode-provider`.
- Plugin imports stay `.js`; tests import `.ts`.
- Do not fold this package into workit. PRs against `BrainerVirus/opencode-commandcode` base `main`.
- Implementation on `feature/2026-08-28-catalog-modalities` (in-place checkout, no worktrees).

---

### Task 1: Parse and apply modalities from models.dev

**Files:**
- Modify: `src/costs-models-dev.ts`
- Modify: `tests/fixtures/models-dev/api.subset.json`
- Test: `tests/unit/costs-models-dev.test.ts`

**Interfaces:**
- Consumes: existing `parseModelsDev`, `findRow` / `indexRows` matching
- Produces:
  - `TEXT_ONLY_MODALITIES = { input: ["text"], output: ["text"] }`
  - `ModelsDevRow` gains optional `attachment?: boolean` and `modalities?: { input: string[]; output: string[] }`
  - `applyModelsDevModalities(models: ModelEntry[], rows: ModelsDevRow[]): number` — returns how many models matched a models.dev row with explicit attachment/modalities; every model is assigned fields

- [ ] **Step 1: Write the failing test**

Add vision + text-only rows to `tests/fixtures/models-dev/api.subset.json`:

```json
{
  "google": {
    "models": {
      "google/gemini-3.5-flash": {
        "id": "google/gemini-3.5-flash",
        "name": "Gemini 3.5 Flash",
        "attachment": true,
        "modalities": {
          "input": ["text", "image", "video", "audio", "pdf"],
          "output": ["text"]
        },
        "cost": { "input": 1.5, "output": 9, "cache_read": 0.15 }
      }
    }
  },
  "tencent": {
    "models": {
      "tencent/hy4-preview": {
        "id": "tencent/hy4-preview",
        "name": "Tencent Hy4 Preview",
        "attachment": false,
        "modalities": { "input": ["text"], "output": ["text"] },
        "cost": { "input": 0.834, "output": 2.501, "cache_read": 0.042 }
      }
    }
  }
}
```

Keep the existing `zai`, `vercel`, and `qwen` objects. Qwen stays cost-only (no modalities in the fixture) so the apply function must default it to text-only.

In `tests/unit/costs-models-dev.test.ts`, add:

```ts
import { applyModelsDevModalities, TEXT_ONLY_MODALITIES } from "../../src/costs-models-dev.ts";

describe("applyModelsDevModalities", () => {
  const rows = parseModelsDev(
    readFileSync(join(import.meta.dir, "../fixtures/models-dev/api.subset.json"), "utf-8"),
  );

  test("copies vision modalities and defaults unmatched plus cost-only rows to text-only", () => {
    const models = [
      model({ id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" }),
      model({ id: "tencent/hy4-preview", name: "Tencent Hy4 Preview" }),
      model({ id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus" }),
      model({ id: "unknown/not-on-models-dev", name: "Unknown" }),
      model({
        id: "inclusionai/ling-3.0-flash-free",
        name: "Ling 3.0 Flash Free",
        cost: { input: 0, output: 0 },
      }),
    ];
    const n = applyModelsDevModalities(models, rows);
    expect(n).toBe(2);
    expect(models[0].attachment).toBe(true);
    expect(models[0].modalities).toEqual({
      input: ["text", "image", "video", "audio", "pdf"],
      output: ["text"],
    });
    expect(models[1].attachment).toBe(false);
    expect(models[1].modalities).toEqual(TEXT_ONLY_MODALITIES);
    expect(models[2].attachment).toBe(false);
    expect(models[2].modalities).toEqual(TEXT_ONLY_MODALITIES);
    expect(models[3].attachment).toBe(false);
    expect(models[3].modalities).toEqual(TEXT_ONLY_MODALITIES);
    expect(models[4].attachment).toBe(false);
    expect(models[4].modalities).toEqual(TEXT_ONLY_MODALITIES);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/costs-models-dev.test.ts`

Expected: FAIL — `applyModelsDevModalities` / `TEXT_ONLY_MODALITIES` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/costs-models-dev.ts`:

```ts
export const TEXT_ONLY_MODALITIES = { input: ["text"], output: ["text"] } as const;

export type ModelsDevRow = {
  id: string;
  name: string;
  cost: { input: number; output: number; cache_read?: number; cache_write?: number };
  attachment?: boolean;
  modalities?: { input: string[]; output: string[] };
};
```

Extend `ModelsDevModel` with optional `attachment?: boolean` and `modalities?: { input?: string[]; output?: string[] }`.

In `parseModelsDev`, after building `cost`, copy:

```ts
if (typeof model.attachment === "boolean") row.attachment = model.attachment;
const input = model.modalities?.input?.filter((x) => typeof x === "string");
const output = model.modalities?.output?.filter((x) => typeof x === "string");
if (input?.length || output?.length) {
  row.modalities = {
    input: input?.length ? input : ["text"],
    output: output?.length ? output : ["text"],
  };
}
```

Add `applyModelsDevModalities` using the existing `indexRows` / `findRow`. For each model: if the row has `modalities` or `attachment !== undefined`, copy them (`attachment` defaults to `modalities.input.includes("image")` when omitted); otherwise assign `attachment: false` and `{ ...TEXT_ONLY_MODALITIES }` (spread into a mutable `{ input: string[]; output: string[] }`). Return the count of models that used an explicit models.dev attachment/modalities (not the default).

Extend `ModelEntry` in `src/catalog.ts`:

```ts
attachment?: boolean;
modalities?: { input: string[]; output: string[] };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/costs-models-dev.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (only if the user asked to commit)

```bash
git add src/costs-models-dev.ts src/catalog.ts tests/unit/costs-models-dev.test.ts tests/fixtures/models-dev/api.subset.json
git commit -m "feat: copy vision and text-only modalities from models.dev"
```

---

### Task 2: Emit attachment and modalities on OpenCode models

**Files:**
- Modify: `src/catalog.ts` (`generateOpencodeModels`)
- Test: `tests/unit/catalog.test.ts`

**Interfaces:**
- Consumes: `ModelEntry.attachment` / `ModelEntry.modalities` from Task 1
- Produces: each OpenCode model object includes `attachment: boolean` and `modalities: { input: string[]; output: string[] }`; missing fields emit text-only

- [ ] **Step 1: Write the failing test**

In `describe("generateOpencodeModels")` add:

```ts
test("emits attachment and modalities, defaulting to text-only", () => {
  const models = generateOpencodeModels([
    {
      id: "google/gemini-3.5-flash",
      name: "Gemini 3.5 Flash",
      tier: "open-source",
      reasoning: false,
      tool_call: true,
      cost: { input: 1.5, output: 9 },
      limit: { context: 1048576, output: 65536 },
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    },
    {
      id: "tencent/hy4-preview",
      name: "Tencent Hy4 Preview",
      tier: "open-source",
      reasoning: true,
      tool_call: true,
      cost: { input: 0.834, output: 2.501 },
      limit: { context: 1048576, output: 64000 },
    },
  ]);
  const gemini = models["gemini-3.5-flash"] as Record<string, unknown>;
  const hy4 = models["hy4-preview"] as Record<string, unknown>;
  expect(gemini.attachment).toBe(true);
  expect(gemini.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
  expect(hy4.attachment).toBe(false);
  expect(hy4.modalities).toEqual({ input: ["text"], output: ["text"] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/catalog.test.ts`

Expected: FAIL — `attachment` / `modalities` undefined on emitted models.

- [ ] **Step 3: Write minimal implementation**

In `generateOpencodeModels`, after building `model`:

```ts
model.attachment = entry.attachment ?? false;
model.modalities = entry.modalities ?? { input: ["text"], output: ["text"] };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/catalog.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (only if the user asked to commit)

```bash
git add src/catalog.ts tests/unit/catalog.test.ts
git commit -m "feat: emit OpenCode attachment and modalities"
```

---

### Task 3: Wire sync, refresh catalog, document

**Files:**
- Modify: `scripts/sync-models.ts`
- Modify: `README.md` (What this package adds)
- Modify: `CHANGELOG.md` via `workit_changelog_apply`
- Modify: `models.json` (from `bun run sync`)

**Interfaces:**
- Consumes: `parseModelsDev`, `applyModelsDevCosts`, `applyModelsDevModalities`
- Produces: one models.dev parse shared by costs and modalities; if fetch throws, still `applyModelsDevModalities(entries, [])` so every written model is text-only tagged

- [ ] **Step 1: Write the failing test**

No new unit test for the script. Assert the sync wiring by reading `scripts/sync-models.ts` in the step 4 check: `applyModelsDevModalities` is called with the same parsed rows, and the catch path still applies empty rows.

- [ ] **Step 2: Run existing tests (still pass; wiring not covered)**

Run: `bun test tests/unit/`

Expected: PASS (Task 1–2 tests).

- [ ] **Step 3: Write minimal implementation**

In `scripts/sync-models.ts`, import `applyModelsDevModalities`. After the models.dev try/catch, always apply modalities:

```ts
let modelsDevRows: ReturnType<typeof parseModelsDev> = [];
try {
  const modelsDevJson = await fetchModelsDevJson();
  modelsDevRows = parseModelsDev(modelsDevJson);
  const filled = applyModelsDevCosts(entries, modelsDevRows, skipAfterFree, thirdPartyIds);
  console.log(`  Applied models.dev costs to ${filled} models`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(`  models.dev fill skipped: ${message}`);
}
const modalityFilled = applyModelsDevModalities(entries, modelsDevRows);
console.log(`  Applied models.dev modalities to ${modalityFilled} models`);
```

README, under “What this package adds”, add: vision vs text-only (`attachment` / `modalities`) is copied from models.dev during catalog sync; unmatched models are text-only.

Changelog Unreleased / Added: catalog models include vision and text-only metadata from models.dev.

Run: `bun run sync` from the repo root (needs network). Then `bun run check`.

- [ ] **Step 4: Verify**

- `bun run check` passes
- `models.json` contains `"attachment"` and `"modalities"` on `tencent/hy4-preview` with `attachment: false` and input `["text"]`
- A known vision id (e.g. `google/gemini-3.5-flash`) has `attachment: true` and `"image"` in `modalities.input`

- [ ] **Step 5: Commit** (only if the user asked to commit)

```bash
git add scripts/sync-models.ts README.md CHANGELOG.md models.json manifest.json
git commit -m "feat: sync OpenCode modalities from models.dev"
```
