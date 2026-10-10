import { generateText } from "ai";
import { describe, expect, it, vi } from "vitest";
import { CHAT_REQUEST_EXTRAS, createProvider, NVIDIA_BASE_URL } from "@/lib/provider";

const ok = (vectors: number[][]) =>
  new Response(JSON.stringify({ data: vectors.map((embedding, index) => ({ index, embedding })) }), { status: 200 });

describe("createProvider().embed", () => {
  it("posts texts with the input type and returns vectors in input order", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ data: [{ index: 1, embedding: [2, 2] }, { index: 0, embedding: [1, 1] }] }),
        { status: 200 },
      ),
    );
    const provider = createProvider("nvapi-test", fetchMock);

    const vectors = await provider.embed("nvidia/some-embed", ["가", "나"], "passage");

    expect(vectors).toEqual([[1, 1], [2, 2]]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${NVIDIA_BASE_URL}/embeddings`);
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer nvapi-test");
    expect(JSON.parse(init!.body as string)).toEqual({
      model: "nvidia/some-embed",
      input: ["가", "나"],
      input_type: "passage",
      truncate: "END",
      encoding_format: "float",
    });
  });

  it("splits large inputs into batches and keeps the order", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { input } = JSON.parse(init!.body as string) as { input: string[] };
      return ok(input.map((t) => [Number(t)]));
    });
    const provider = createProvider("k", fetchMock);
    const texts = Array.from({ length: 70 }, (_, i) => String(i));

    const vectors = await provider.embed("m", texts, "query");

    expect(fetchMock.mock.calls.length).toBe(3);
    expect(vectors.map((v) => v[0])).toEqual(texts.map(Number));
  });

  it("throws with the status and never includes the key in the message", async () => {
    const provider = createProvider("nvapi-secret", async () => new Response('{"detail":"Too Many Requests"}', { status: 429 }), async () => {});
    const err = await provider.embed("m", ["a"], "query").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("429");
    expect((err as Error).message).not.toContain("nvapi-secret");
  });

  it("retries temporary failures (429, 5xx) and then succeeds", async () => {
    const responses = [new Response("bad gateway", { status: 502 }), new Response("slow down", { status: 429 }), ok([[7]])];
    const fetchMock = vi.fn(async () => responses.shift()!);
    const sleep = vi.fn(async (_ms: number) => {});
    const provider = createProvider("k", fetchMock, sleep);

    expect(await provider.embed("m", ["a"], "passage")).toEqual([[7]]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("gives up after four attempts and does not retry client errors", async () => {
    const always502 = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    await expect(createProvider("k", always502, async () => {}).embed("m", ["a"], "passage")).rejects.toThrow("502");
    expect(always502).toHaveBeenCalledTimes(4);

    const notFound = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(createProvider("k", notFound, async () => {}).embed("m", ["a"], "passage")).rejects.toThrow("404");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("returns no vectors for no texts without calling the API", async () => {
    const fetchMock = vi.fn();
    expect(await createProvider("k", fetchMock).embed("m", [], "query")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createProvider().chat", () => {
  it("asks the model to keep reasoning short on every chat request", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          id: "c1",
          object: "chat.completion",
          created: 0,
          model: "meta/some-model",
          choices: [{ index: 0, message: { role: "assistant", content: "답" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { text } = await generateText({ model: createProvider("k", fetchMock).chat("meta/some-model"), prompt: "질문", maxRetries: 0 });

    expect(text).toBe("답");
    const sent = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(sent).toMatchObject({ model: "meta/some-model", ...CHAT_REQUEST_EXTRAS });
  });

  it("returns a v4 language model for the given id", () => {
    const model = createProvider("k").chat("meta/some-model");
    expect(model.specificationVersion).toBe("v4");
    expect(model.modelId).toBe("meta/some-model");
  });
});
