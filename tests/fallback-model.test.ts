import { APICallError, type LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { createFallbackModel, type ModelUsed } from "@/lib/fallback-model";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

// `Parameters<typeof simulateReadableStream>` resolves the generic chunk type to `unknown`
// because the helper is generic with no default; use the provider's stream-part type instead.
type Part = LanguageModelV4StreamPart;

const textParts = (text: string, modelId?: string): Part[] => [
  { type: "stream-start", warnings: [] },
  ...(modelId ? [{ type: "response-metadata", modelId } as Part] : []),
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
];

const streamingModel = (modelId: string, chunks: Part[], opts: { initialDelayInMs?: number } = {}) =>
  new MockLanguageModelV4({
    modelId,
    doStream: async () => ({ stream: simulateReadableStream({ chunks, initialDelayInMs: opts.initialDelayInMs ?? 0, chunkDelayInMs: 0 }) }),
  });

const rateLimited = (reset?: string) =>
  new MockLanguageModelV4({
    modelId: "free",
    doStream: async () => {
      throw new APICallError({
        message: "Rate limit exceeded: free-models-per-day",
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: reset ? { "x-ratelimit-reset": reset } : {},
        isRetryable: true,
      });
    },
  });

async function run(model: ReturnType<typeof createFallbackModel>) {
  const result = streamText({ model, prompt: "q", maxRetries: 0 });
  let text = "";
  let error: unknown;
  for await (const part of result.stream) {
    if (part.type === "text-delta") text += part.text;
    if (part.type === "error") error = part.error;
  }
  return { text, error };
}

describe("createFallbackModel", () => {
  it("answers with the free model when it streams in time", async () => {
    const used: ModelUsed[] = [];
    const model = createFallbackModel({
      primary: streamingModel("free", textParts("무료 답", "meta/llama:free")),
      fallback: streamingModel("paid", textParts("유료 답")),
      firstTokenTimeoutMs: 1000,
      onModelUsed: (u) => used.push(u),
    });
    expect((await run(model)).text).toBe("무료 답");
    expect(used).toEqual([{ tier: "primary", modelId: "meta/llama:free" }]);
  });

  it("falls back and records the reset time on a 429", async () => {
    const onPrimaryRateLimited = vi.fn();
    const used: ModelUsed[] = [];
    const model = createFallbackModel({
      primary: rateLimited("1790000000000"),
      fallback: streamingModel("paid", textParts("유료 답")),
      firstTokenTimeoutMs: 1000,
      onPrimaryRateLimited,
      onModelUsed: (u) => used.push(u),
    });
    expect((await run(model)).text).toBe("유료 답");
    expect(onPrimaryRateLimited).toHaveBeenCalledWith(1790000000000);
    expect(used[0]).toMatchObject({ tier: "fallback", modelId: "paid" });
    expect(used[0]!.reason).toContain("429");
  });

  it("falls back when the first token does not arrive in time", async () => {
    const model = createFallbackModel({
      primary: streamingModel("free", textParts("늦은 답"), { initialDelayInMs: 200 }),
      fallback: streamingModel("paid", textParts("유료 답")),
      firstTokenTimeoutMs: 50,
    });
    expect((await run(model)).text).toBe("유료 답");
  });

  it("falls back when the free stream errors before any text", async () => {
    const model = createFallbackModel({
      primary: streamingModel("free", [{ type: "stream-start", warnings: [] }, { type: "error", error: new Error("provider down") }]),
      fallback: streamingModel("paid", textParts("유료 답")),
      firstTokenTimeoutMs: 1000,
    });
    expect((await run(model)).text).toBe("유료 답");
  });

  it("does not switch models once text has started streaming", async () => {
    const paid = streamingModel("paid", textParts("유료 답"));
    const paidSpy = vi.spyOn(paid, "doStream");
    const model = createFallbackModel({
      primary: streamingModel("free", [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "반쯤 " },
        { type: "error", error: new Error("connection reset") },
      ]),
      fallback: paid,
      firstTokenTimeoutMs: 1000,
    });
    const { text, error } = await run(model);
    expect(text).toBe("반쯤 ");
    expect(error).toBeDefined();
    expect(paidSpy).not.toHaveBeenCalled();
  });

  it("skips the free model while it is marked exhausted", async () => {
    const free = streamingModel("free", textParts("무료 답"));
    const freeSpy = vi.spyOn(free, "doStream");
    const model = createFallbackModel({
      primary: free,
      fallback: streamingModel("paid", textParts("유료 답")),
      firstTokenTimeoutMs: 1000,
      skipPrimary: async () => true,
    });
    expect((await run(model)).text).toBe("유료 답");
    expect(freeSpy).not.toHaveBeenCalled();
  });

  it("still tries the free model when skipPrimary itself fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = createFallbackModel({
      primary: streamingModel("free", textParts("무료 답")),
      fallback: streamingModel("paid", textParts("유료 답")),
      firstTokenTimeoutMs: 1000,
      skipPrimary: async () => {
        throw new Error("redis down");
      },
    });
    expect((await run(model)).text).toBe("무료 답");
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("still falls back to paid when onPrimaryRateLimited itself fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = createFallbackModel({
      primary: rateLimited("1790000000000"),
      fallback: streamingModel("paid", textParts("유료 답")),
      firstTokenTimeoutMs: 1000,
      onPrimaryRateLimited: async () => {
        throw new Error("redis down");
      },
    });
    expect((await run(model)).text).toBe("유료 답");
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
