import { describe, expect, it, vi } from "vitest";
import { createProvider, NVIDIA_BASE_URL } from "@/lib/provider";

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
    const provider = createProvider("nvapi-secret", async () => new Response('{"detail":"Too Many Requests"}', { status: 429 }));
    const err = await provider.embed("m", ["a"], "query").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("429");
    expect((err as Error).message).not.toContain("nvapi-secret");
  });

  it("returns no vectors for no texts without calling the API", async () => {
    const fetchMock = vi.fn();
    expect(await createProvider("k", fetchMock).embed("m", [], "query")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createProvider().chat", () => {
  it("returns a v4 language model for the given id", () => {
    const model = createProvider("k").chat("meta/some-model");
    expect(model.specificationVersion).toBe("v4");
    expect(model.modelId).toBe("meta/some-model");
  });
});
