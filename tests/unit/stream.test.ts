import { expect, test } from "bun:test";
import { parseStreamEvents } from "../../src/stream.js";
import { sseEvent } from "../helpers/mocks.js";

async function collectStream(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const reader = stream.getReader();
  const parts: unknown[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return parts;
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i++;
    },
  });
}

test("parses text-delta event", async () => {
  const body = streamFromChunks([sseEvent({ type: "text-delta", id: "t1", delta: "hello" })]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatchObject({ type: "text-delta", id: "t1", delta: "hello" });
});

test("parses reasoning-delta event", async () => {
  const body = streamFromChunks([
    sseEvent({ type: "reasoning-delta", id: "r1", text: "thinking..." }),
  ]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts[0]).toMatchObject({ type: "reasoning-delta", id: "r1", delta: "thinking..." });
});

test("parses tool-call event", async () => {
  const body = streamFromChunks([
    sseEvent({
      type: "tool-call",
      toolCallId: "tc1",
      toolName: "bash",
      input: { cmd: "ls" },
    }),
  ]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts[0]).toMatchObject({
    type: "tool-call",
    toolCallId: "tc1",
    toolName: "bash",
  });
});

test("parses finish-step with usage", async () => {
  const body = streamFromChunks([
    sseEvent({
      type: "finish-step",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20 },
    }),
  ]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts[0]).toMatchObject({
    type: "finish",
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 10 },
      outputTokens: { total: 20 },
    },
  });
});

test("maps finish reasons correctly", async () => {
  const cases: Array<{ raw: string; expected: string }> = [
    { raw: "stop", expected: "stop" },
    { raw: "end_turn", expected: "stop" },
    { raw: "tool_calls", expected: "tool-calls" },
    { raw: "tool-calls", expected: "tool-calls" },
    { raw: "length", expected: "length" },
    { raw: "max_tokens", expected: "length" },
    { raw: "max-tokens", expected: "length" },
    { raw: "max_output_tokens", expected: "length" },
    { raw: "content_filter", expected: "content-filter" },
    { raw: "unknown_reason", expected: "other" },
  ];
  for (const { raw, expected } of cases) {
    const body = streamFromChunks([sseEvent({ type: "finish-step", finishReason: raw })]);
    const stream = parseStreamEvents(body);
    const parts = await collectStream(stream);
    expect((parts[0] as any).finishReason.unified).toBe(expected);
  }
});

test("maps usage with camelCase fields", async () => {
  const body = streamFromChunks([
    sseEvent({
      type: "finish-step",
      finishReason: "stop",
      usage: {
        inputTokens: 15,
        outputTokens: 25,
        inputTokenDetails: { noCacheTokens: 5, cacheReadTokens: 10 },
        outputTokenDetails: { textTokens: 20, reasoningTokens: 5 },
      },
    }),
  ]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  const usage = (parts[0] as any).usage;
  expect(usage.inputTokens.total).toBe(15);
  expect(usage.inputTokens.noCache).toBe(5);
  expect(usage.inputTokens.cacheRead).toBe(10);
  expect(usage.outputTokens.total).toBe(25);
  expect(usage.outputTokens.text).toBe(20);
  expect(usage.outputTokens.reasoning).toBe(5);
});

test("maps usage with snake_case fields", async () => {
  const body = streamFromChunks([
    sseEvent({
      type: "finish-step",
      finishReason: "stop",
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        input_token_details: { noCacheTokens: 5, cacheReadTokens: 10 },
        output_token_details: { textTokens: 20, reasoningTokens: 5 },
      },
    }),
  ]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  const usage = (parts[0] as any).usage;
  expect(usage.inputTokens.total).toBe(15);
  expect(usage.outputTokens.total).toBe(25);
  expect(usage.inputTokens.noCache).toBe(5);
  expect(usage.inputTokens.cacheRead).toBe(10);
});

test("skips comments (lines starting with :)", async () => {
  const body = streamFromChunks([':comment\n\ndata: {"type":"start"}\n\n']);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts).toHaveLength(1);
  expect((parts[0] as any).type).toBe("stream-start");
});

test("skips [DONE] lines", async () => {
  const body = streamFromChunks(['data: {"type":"start"}\n\ndata: [DONE]\n\n']);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts).toHaveLength(1);
});

test("handles error events", async () => {
  const body = streamFromChunks([sseEvent({ type: "error", error: "Something broke" })]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts[0]).toMatchObject({ type: "error", error: "Something broke" });
});

test("handles response-metadata event", async () => {
  const body = streamFromChunks([
    sseEvent({ type: "response-metadata", id: "req-1", modelId: "model-v1" }),
  ]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts[0]).toMatchObject({ type: "response-metadata", id: "req-1", modelId: "model-v1" });
});

test("handles multiple events in one chunk", async () => {
  const body = streamFromChunks([
    sseEvent({ type: "text-delta", id: "t1", delta: "a" }) +
      sseEvent({ type: "text-delta", id: "t1", delta: "b" }),
  ]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts).toHaveLength(2);
});

test("handles event split across chunk boundaries", async () => {
  const eventJson = JSON.stringify({ type: "text-delta", id: "t1", delta: "hello" });
  const part1 = `data: ${eventJson.slice(0, 10)}`;
  const part2 = `${eventJson.slice(10)}\n\n`;
  const body = streamFromChunks([part1, part2]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts).toHaveLength(1);
  expect((parts[0] as any).delta).toBe("hello");
});

test("finish event type returns null (no-op)", async () => {
  const body = streamFromChunks([sseEvent({ type: "finish" })]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts).toHaveLength(0);
});

test("unknown event types are silently skipped", async () => {
  const body = streamFromChunks([sseEvent({ type: "weird-internal-event" })]);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts).toHaveLength(0);
});

test("handles \\r\\n line endings", async () => {
  const body = streamFromChunks(['data: {"type":"start"}\r\n\r\n']);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts).toHaveLength(1);
});

test("closes stream cleanly at end of data", async () => {
  const body = streamFromChunks(['data: {"type":"start"}\n\n']);
  const stream = parseStreamEvents(body);
  const parts = await collectStream(stream);
  expect(parts).toHaveLength(1);
});
