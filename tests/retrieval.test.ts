import { describe, expect, it } from "vitest";
import { createSearcher, SEARCH } from "@/lib/retrieval";
import { tokenize } from "@/lib/tokenize";
import { encodeVector } from "@/lib/vector";
import type { BlogIndex, Chunk, Post } from "@/lib/types";

describe("tokenize", () => {
  it("makes hangul bigrams and lowercase ascii terms", () => {
    expect(tokenize("점검페이지 Edge Config")).toEqual(["edge", "config", "점검", "검페", "페이", "이지"]);
  });

  it("keeps compound tech terms whole and also splits their parts", () => {
    expect(tokenize("RequiresMountsFor")).toEqual(["requiresmountsfor"]);
    expect(tokenize("spring-boot.")).toEqual(["spring-boot", "spring", "boot"]);
  });

  it("keeps single hangul syllables", () => {
    expect(tokenize("락")).toEqual(["락"]);
  });
});

const post = (id: number): Post => ({
  id,
  url: `https://hyunolike.tistory.com/${id}`,
  title: `글 ${id}`,
  prefix: [],
  category: "BE",
  summary: "",
  publishedAt: "",
  modifiedAt: "",
});

const chunk = (postId: number, n: number, text: string, vector: number[], kind: Chunk["kind"] = "body"): Chunk => ({
  id: `${postId}-${n}`,
  postId,
  kind,
  headingPath: [],
  text,
  embedText: text,
  hash: `${postId}-${n}`,
  vector: encodeVector(vector),
});

const index: BlogIndex = {
  version: 1,
  embeddingModel: "test",
  dimensions: 2,
  builtAt: "",
  posts: [post(1), post(2), post(3)],
  chunks: [
    chunk(1, 0, "요약 systemd", [0, 1], "summary"),
    chunk(1, 1, "systemd timer RequiresMountsFor 설정", [0.1, 1]),
    chunk(1, 2, "systemd 재부팅 복구", [0.2, 1]),
    chunk(1, 3, "systemd 로그 확인", [0.3, 1]),
    chunk(1, 4, "systemd 서비스 파일", [0.4, 1]),
    chunk(2, 0, "요약 점검", [1, 0], "summary"),
    chunk(2, 1, "점검 페이지 Edge Config", [1, 0.1]),
    chunk(3, 0, "요약 redis", [0.7, 0.7], "summary"),
    chunk(3, 1, "redis 분산락", [0.7, 0.6]),
  ],
};

describe("createSearcher", () => {
  const searcher = createSearcher(index);

  it("finds exact tech terms by keyword even without a vector", () => {
    const results = searcher.search({ query: "RequiresMountsFor", queryVector: null, currentPostId: null });
    expect(results[0]!.chunk.id).toBe("1-1");
  });

  it("finds semantically close chunks by vector", () => {
    const results = searcher.search({ query: "관계없는말", queryVector: [1, 0.05], currentPostId: null });
    expect(results[0]!.chunk.postId).toBe(2);
  });

  it("caps chunks per post and returns at most finalCount", () => {
    const results = searcher.search({ query: "systemd 점검 redis", queryVector: [0.2, 1], currentPostId: null });
    expect(results.length).toBeLessThanOrEqual(SEARCH.finalCount);
    expect(results.filter((r) => r.post.id === 1).length).toBeLessThanOrEqual(SEARCH.perPostCap);
  });

  it("always includes the summary of the post being viewed", () => {
    const results = searcher.search({ query: "systemd", queryVector: [0, 1], currentPostId: 3 });
    expect(results.some((r) => r.chunk.id === "3-0")).toBe(true);
    expect(results.length).toBeLessThanOrEqual(SEARCH.finalCount + 1);
  });

  it("ignores a query vector with the wrong dimensions", () => {
    const results = searcher.search({ query: "redis", queryVector: [1, 0, 0], currentPostId: null });
    expect(results[0]!.post.id).toBe(3);
  });

  it("returns nothing when there is neither a usable query nor a current post", () => {
    expect(searcher.search({ query: "!!!", queryVector: null, currentPostId: null })).toEqual([]);
  });
});
