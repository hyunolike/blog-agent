import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { AI_UNAVAILABLE, handleChat, type ChatDeps } from "@/lib/chat-handler";
import { createFallbackModel } from "@/lib/fallback-model";
import { createSearcher, type RetrievedChunk, type SearchInput } from "@/lib/retrieval";
import { encodeVector } from "@/lib/vector";
import type { BlogIndex } from "@/lib/types";

const ORIGIN = "https://chat.example.dev";

const index: BlogIndex = {
  version: 1,
  embeddingModel: "t",
  dimensions: 2,
  builtAt: "",
  posts: [{ id: 70, url: "https://hyunolike.tistory.com/70", title: "점검 페이지", prefix: [], category: "프로젝트", summary: "", publishedAt: "", modifiedAt: "" }],
  chunks: [
    { id: "70-0", postId: 70, kind: "summary", headingPath: [], text: "요약", embedText: "요약 점검", hash: "a", vector: encodeVector([1, 0]) },
    { id: "70-1", postId: 70, kind: "body", headingPath: ["Edge Config"], text: "플래그를 Edge Config에 둔다", embedText: "점검 플래그 Edge Config", hash: "b", vector: encodeVector([1, 0.1]) },
  ],
};

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 3, text: 3, reasoning: undefined },
};

const okModel = (text: string) =>
  new MockLanguageModelV4({
    modelId: "paid/model",
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: text },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
        ],
      }),
    }),
  });

const failingModel = new MockLanguageModelV4({
  modelId: "paid/model",
  doStream: async () => {
    throw new Error("all providers down");
  },
});

function deps(over: Partial<ChatDeps> = {}): ChatDeps {
  return {
    searcher: createSearcher(index),
    embedQuery: async () => [1, 0],
    createModel: (onUsed) => createFallbackModel({ primary: null, fallback: okModel("답변[1]"), firstTokenTimeoutMs: 1000, onModelUsed: onUsed }),
    limits: {
      ipMinute: { limit: async () => ({ success: true, reset: 0 }) },
      ipDay: { limit: async () => ({ success: true, reset: 0 }) },
      globalDay: { limit: async () => ({ success: true, reset: 0 }) },
    },
    allowedOrigins: [ORIGIN],
    log: () => {},
    ...over,
  };
}

const request = (body: unknown, origin = ORIGIN) =>
  new Request(`${ORIGIN}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-real-ip": "1.2.3.4" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const ask = (text: string, extra: Record<string, unknown> = {}) => ({
  messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }],
  ...extra,
});

async function sse(res: Response) {
  const raw = await res.text();
  return raw
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));
}

describe("handleChat", () => {
  it("rejects other origins", async () => {
    const res = await handleChat(request(ask("안녕"), "https://evil.example"), deps());
    expect(res.status).toBe(403);
  });

  it("rejects empty, too long, and oversized requests with the input message", async () => {
    for (const body of [ask("   "), ask("가".repeat(501)), ask("a", { pad: "x".repeat(17_000) }), "{not json"]) {
      const res = await handleChat(request(body), deps());
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe("질문은 1~500자로 입력해 주세요.");
    }
  });

  it("counts question length in characters, not bytes", async () => {
    const res = await handleChat(request(ask("가".repeat(500))), deps());
    expect(res.status).toBe(200);
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    const res = await handleChat(
      request(ask("안녕")),
      deps({ limits: { ...deps().limits, ipMinute: { limit: async () => ({ success: false, reset: Date.now() + 5000 }) } } }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("5");
    expect((await res.json()).message).toBe("잠시 후 다시 시도해 주세요 (5초)");
  });

  it("returns 503 when the index could not be loaded", async () => {
    const res = await handleChat(request(ask("안녕")), deps({ searcher: null }));
    expect(res.status).toBe(503);
    expect((await res.json()).message).toBe("검색 인덱스를 준비 중이에요. 잠시 후 다시 시도해 주세요.");
  });

  it("streams sources first, then text, then the model that answered", async () => {
    const res = await handleChat(request(ask("점검 플래그 어디에 뒀어?")), deps());
    expect(res.status).toBe(200);
    const chunks = await sse(res);
    expect(chunks[0].type).toBe("start");
    expect(chunks[0].messageMetadata.sources[0]).toMatchObject({ n: 1, postId: 70 });
    expect(chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("")).toBe("답변[1]");
    const meta = chunks.filter((c) => c.messageMetadata?.model);
    expect(meta.at(-1)!.messageMetadata).toMatchObject({ model: "paid/model", tier: "paid" });
  });

  it("still answers with keyword search when embedding fails", async () => {
    const log = vi.fn();
    const res = await handleChat(request(ask("Edge Config")), deps({ embedQuery: async () => { throw new Error("embed down"); }, log }));
    const chunks = await sse(res);
    expect(chunks[0].messageMetadata.sources[0].postId).toBe(70);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ embedFailed: true }));
  });

  it("sends sources and an AI_UNAVAILABLE error when every model fails", async () => {
    const res = await handleChat(
      request(ask("점검")),
      deps({ createModel: (onUsed) => createFallbackModel({ primary: null, fallback: failingModel, firstTokenTimeoutMs: 1000, onModelUsed: onUsed }) }),
    );
    const chunks = await sse(res);
    expect(chunks[0].messageMetadata.sources.length).toBeGreaterThan(0);
    expect(chunks.find((c) => c.type === "error")).toMatchObject({ errorText: AI_UNAVAILABLE });
  });

  it("uses the viewed post only when from is a real post url", async () => {
    const search = vi.fn((_input: SearchInput): RetrievedChunk[] => []);
    await handleChat(request(ask("요약해줘", { from: "https://hyunolike.tistory.com/70" })), deps({ searcher: { search } }));
    await handleChat(request(ask("요약해줘", { from: "javascript:alert(1)" })), deps({ searcher: { search } }));
    expect(search.mock.calls.map((c) => c[0].currentPostId)).toEqual([70, null]);
  });
});
