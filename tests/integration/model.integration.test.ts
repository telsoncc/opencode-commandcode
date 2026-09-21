import { describe, expect, test } from "bun:test";
import { CommandCodeLanguageModel } from "../../src/model.js";

const API_KEY = process.env.COMMANDCODE_API_KEY;
const hasApiKey = !!API_KEY;

const skipIfNoKey = hasApiKey ? describe : describe.skip;

skipIfNoKey("integration: CommandCodeLanguageModel", () => {
  const model = new CommandCodeLanguageModel("deepseek/deepseek-v4-flash", {
    apiKey: API_KEY!,
  });

  test("doStream returns parseable stream parts for a simple prompt", async () => {
    const result = await model.doStream({
      prompt: [{ role: "user", content: "Say exactly the word: hello" }],
      maxOutputTokens: 100,
    });
    const reader = result.stream.getReader();
    const parts: any[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    expect(parts.length).toBeGreaterThan(0);
    const finalPart = parts.find((p) => p.type === "finish");
    expect(finalPart).toBeDefined();
    expect(finalPart.finishReason.unified).toMatch(/stop|length/);
  });

  test("doGenerate returns a complete response", async () => {
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: "Say exactly the word: hello" }],
      maxOutputTokens: 100,
    });

    expect(result.content.length).toBeGreaterThan(0);
    const textPart = result.content.find((c) => c.type === "text") as { text: string } | undefined;
    expect(textPart).toBeDefined();
    expect(textPart!.text.toLowerCase()).toContain("hello");
    expect(result.finishReason.unified).toMatch(/stop|length/);
    expect(result.usage.inputTokens.total).toBeGreaterThan(0);
    expect(result.usage.outputTokens.total).toBeGreaterThan(0);
  });

  test("doGenerate with tool calling returns tool-call parts", async () => {
    const result = await model.doGenerate({
      prompt: [
        { role: "user", content: "What files are in the current directory? Use bash to check." },
      ],
      maxOutputTokens: 500,
      tools: [
        {
          type: "function",
          name: "bash",
          description: "Run a shell command",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          },
        },
      ],
    });

    const toolCalls = result.content.filter((c) => c.type === "tool-call");
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0]).toMatchObject({
      type: "tool-call",
      toolName: "bash",
    });
  });

  test("doStream with invalid model ID returns meaningful error", async () => {
    const badModel = new CommandCodeLanguageModel("nonexistent-model-xyz", {
      apiKey: API_KEY!,
    });

    try {
      await badModel.doStream({
        prompt: [{ role: "user", content: "hi" }],
        maxOutputTokens: 10,
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toBe("Command Code API error: 404 Not Found");
    }
  });
});

test("integration tests are skipped when COMMANDCODE_API_KEY is not set", () => {
  if (!hasApiKey) {
    console.log("Skipping integration tests: COMMANDCODE_API_KEY not set");
  }
});
