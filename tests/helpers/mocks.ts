import type {
  LanguageModelV3StreamPart,
  LanguageModelV3CallOptions,
  LanguageModelV3Message,
} from "@ai-sdk/provider";

export type MockFetchCall = {
  url: string;
  options: RequestInit;
};

export function mockFetch(response: Partial<Response>): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, _options?: RequestInit) => {
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: null,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({}),
      ...response,
    } as Response);
  }) as typeof globalThis.fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export function mockFetchTrack(): {
  calls: MockFetchCall[];
  restore: () => void;
  respondWith: (resp: Partial<Response>) => void;
} {
  let nextResponse: Partial<Response> = {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    body: null,
    text: () => Promise.resolve(""),
  };
  const calls: MockFetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, options?: RequestInit) => {
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      options: options ?? {},
    });
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: null,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({}),
      ...nextResponse,
    } as Response);
  }) as typeof globalThis.fetch;
  return {
    calls,
    respondWith: (resp: Partial<Response>) => {
      nextResponse = resp;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export function mockFetchStream(
  chunks: string[],
  responseOverrides: Partial<Response> = {},
): { restore: () => void } {
  const encoder = new TextEncoder();
  const original = globalThis.fetch;

  globalThis.fetch = (async () => {
    let chunkIndex = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (chunkIndex >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[chunkIndex]));
        chunkIndex++;
      },
    });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: stream,
      text: () => Promise.resolve(chunks.join("")),
      ...responseOverrides,
    } as Response;
  }) as typeof globalThis.fetch;

  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export function mockFetchError(
  status: number,
  statusText: string,
  body?: string,
): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status,
      statusText,
      headers: new Headers(),
      body: null,
      text: () => Promise.resolve(body ?? ""),
      json: () => Promise.resolve(body ? JSON.parse(body) : {}),
    }) as Response) as typeof globalThis.fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function sseEvents(events: Record<string, unknown>[]): string {
  return events.map(sseEvent).join("");
}

export function makeStreamPart(
  type: LanguageModelV3StreamPart["type"],
  overrides: Record<string, unknown> = {},
): LanguageModelV3StreamPart {
  switch (type) {
    case "stream-start":
      return { type: "stream-start", warnings: [] } as LanguageModelV3StreamPart;
    case "text-delta":
      return {
        type: "text-delta",
        id: "t1",
        delta: "hello",
        ...overrides,
      } as LanguageModelV3StreamPart;
    case "reasoning-delta":
      return {
        type: "reasoning-delta",
        id: "r1",
        delta: "thinking...",
        ...overrides,
      } as LanguageModelV3StreamPart;
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: "tc1",
        toolName: "bash",
        input: "{}",
        ...overrides,
      } as LanguageModelV3StreamPart;
    case "finish":
      return {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10 },
          outputTokens: { total: 20 },
        },
        ...overrides,
      } as LanguageModelV3StreamPart;
    case "error":
      return { type: "error", error: "test error", ...overrides } as LanguageModelV3StreamPart;
    default:
      return { type, ...overrides } as LanguageModelV3StreamPart;
  }
}

export const sampleUserMessage: LanguageModelV3Message = {
  role: "user",
  content: [{ type: "text", text: "hello" }],
};

export const sampleAssistantMessage: LanguageModelV3Message = {
  role: "assistant",
  content: [
    { type: "text", text: "I think" },
    { type: "reasoning", text: "let me consider..." },
    { type: "tool-call", toolCallId: "tc1", toolName: "bash", input: "ls" },
  ],
};

export const sampleToolMessage: LanguageModelV3Message = {
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: "tc1",
      toolName: "bash",
      output: { type: "text", value: "file.ts" },
    },
  ],
};

export function makeCallOptions(
  overrides: Partial<LanguageModelV3CallOptions> = {},
): LanguageModelV3CallOptions {
  return {
    prompt: [sampleUserMessage],
    maxOutputTokens: 1000,
    ...overrides,
  };
}
