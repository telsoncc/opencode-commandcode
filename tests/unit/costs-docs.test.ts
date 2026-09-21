import { expect, test, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { applyDocCosts, parseModelsTable, parseMoneyCell } from "../../src/costs-docs.ts";
import type { ModelEntry } from "../../src/catalog.ts";

describe("parseMoneyCell", () => {
  test("reads billed amount when a deal shows two prices", () => {
    expect(parseMoneyCell("$1.50$0.75")).toBe(0.75);
    expect(parseMoneyCell("$3.00")).toBe(3);
    expect(parseMoneyCell("Free")).toBe(0);
    expect(parseMoneyCell("—")).toBeUndefined();
  });
});

describe("parseModelsTable", () => {
  test("parses display names and billed rates", () => {
    const md = readFileSync(
      join(import.meta.dir, "../fixtures/command-code/models-page.md"),
      "utf-8",
    );
    const rows = parseModelsTable(md);
    expect(rows.find((r) => r.name === "Claude Sonnet 4.6")).toEqual({
      name: "Claude Sonnet 4.6",
      input: 3,
      output: 15,
      cache_read: 0.3,
      cache_write: 3.75,
    });
    const gemini = rows.find((r) => r.name === "Gemini 3.7 Flash-50%");
    expect(gemini?.input).toBe(0.75);
    expect(gemini?.output).toBe(3.75);
    expect(rows.find((r) => r.name === "Laguna S 2.1FREE")?.input).toBe(0);
  });

  test("parses live HTML using header names not column indexes", () => {
    const html = readFileSync(
      join(import.meta.dir, "../fixtures/command-code/models-page.live.md"),
      "utf-8",
    );
    const rows = parseModelsTable(html);
    const sonnet = rows.find((r) => r.name === "Claude Sonnet 4.6");
    expect(sonnet).toEqual({
      name: "Claude Sonnet 4.6",
      id: "claude-sonnet-4-6",
      input: 3,
      output: 15,
      cache_read: 0.3,
      cache_write: 3.75,
    });
    const gemini = rows.find((r) => r.name === "Gemini 3.7 Flash");
    expect(gemini?.input).toBe(0.75);
    expect(gemini?.output).toBe(3.75);
    expect(rows.find((r) => r.name === "Laguna S 2.1")?.input).toBe(0);
    const hy4 = rows.find((r) => r.name === "Tencent Hy4 Preview");
    expect(hy4?.input).toBe(0.834);
    expect(hy4?.output).toBe(2.501);
  });
});

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
    ];
    const filled = applyDocCosts(
      models,
      parseModelsTable(
        readFileSync(join(import.meta.dir, "../fixtures/command-code/models-page.md"), "utf-8"),
      ),
      new Set(["keep/cli"]),
    );
    expect(filled).toBe(1);
    expect(models[0].cost).toEqual({ input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 });
    expect(models[1].cost).toEqual({ input: 9, output: 9 });
  });
});
