import { describe, expect, it } from "vitest";
import { createSearcher, isListingQuery, SEARCH } from "@/lib/retrieval";
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

  it("spreads results over several posts before giving one post more chunks", () => {
    const wide: BlogIndex = {
      ...index,
      posts: [post(1), post(2), post(3), post(4)],
      chunks: [
        chunk(1, 1, "a", [1, 0]),
        chunk(1, 2, "b", [1, 0.01]),
        chunk(1, 3, "c", [1, 0.02]),
        chunk(2, 1, "d", [1, 0.03]),
        chunk(2, 2, "e", [1, 0.04]),
        chunk(2, 3, "f", [1, 0.05]),
        chunk(3, 1, "g", [1, 0.5]),
        chunk(4, 1, "h", [1, 0.6]),
      ],
    };
    const results = createSearcher(wide).search({ query: "", queryVector: [1, 0], currentPostId: null });
    expect(new Set(results.map((r) => r.post.id))).toEqual(new Set([1, 2, 3, 4]));
    expect(results[0]!.chunk.id).toBe("1-1");
    // 고른 뒤에는 다시 점수순으로 돌려놓는다
    const scores = results.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("takes one chunk from each of up to listCount posts for listing questions", () => {
    const many: BlogIndex = {
      ...index,
      posts: Array.from({ length: 10 }, (_, i) => post(i + 1)),
      chunks: Array.from({ length: 10 }, (_, i) => [chunk(i + 1, 1, `동아리 ${i}`, [1, i * 0.01]), chunk(i + 1, 2, `동아리 ${i}`, [1, i * 0.01 + 0.001])]).flat(),
    };
    const s = createSearcher(many);
    const listed = s.search({ query: "동아리 프로젝트 보여줘", queryVector: [1, 0], currentPostId: null });
    expect(listed).toHaveLength(SEARCH.listCount);
    expect(new Set(listed.map((r) => r.post.id)).size).toBe(SEARCH.listCount);
    // 이전 질문에 목록 표현이 있어도 지금 질문 기준으로 판단한다
    const plain = s.search({ query: "동아리에서 뭘 배웠어?\n동아리 프로젝트 보여줘", queryVector: [1, 0], currentPostId: null });
    expect(plain).toHaveLength(SEARCH.finalCount);
  });

  it("recognises listing questions but not single-topic ones", () => {
    for (const q of ["동아리 관련 프로젝트 보여줘", "운영 장애를 대응한 경험을 정리해줘", "레거시 .NET 시스템에서 어떤 작업들을 했어?", "Redis 쓴 글 전부 알려줘"]) {
      expect(isListingQuery(q), q).toBe(true);
    }
    for (const q of ["Docker 디스크가 100% 찼을 때 어떻게 해결했어?", "실시간 알림에 WebSocket 대신 SSE를 고른 이유는?", "이 글 3줄 요약해줘"]) {
      expect(isListingQuery(q), q).toBe(false);
    }
  });

  it("always includes the summary of the post being viewed", () => {
    const results = searcher.search({ query: "systemd", queryVector: [0, 1], currentPostId: 3 });
    expect(results.some((r) => r.chunk.id === "3-0")).toBe(true);
    expect(results.length).toBeLessThanOrEqual(SEARCH.finalCount + 1);
  });

  it("puts the viewed post's summary first, followed by its body, even for an unrelated query", () => {
    const results = searcher.search({ query: "systemd", queryVector: [0, 1], currentPostId: 3 });
    expect(results[0]!.chunk.id).toBe("3-0");
    expect(results.some((r) => r.chunk.id === "3-1")).toBe(true);
    expect(results.length).toBeLessThanOrEqual(SEARCH.finalCount + 1);
  });

  it("falls back to the viewed post's first body chunks when none of them ranked", () => {
    const results = searcher.search({ query: "systemd", queryVector: null, currentPostId: 3 });
    expect(results.map((r) => r.chunk.id).slice(0, 2)).toEqual(["3-0", "3-1"]);
    expect(results.slice(2).every((r) => r.post.id === 1)).toBe(true);
  });

  it("ignores a viewed post id that is not in the index", () => {
    const results = searcher.search({ query: "RequiresMountsFor", queryVector: null, currentPostId: 999 });
    expect(results[0]!.chunk.id).toBe("1-1");
  });

  it("ignores a query vector with the wrong dimensions", () => {
    const results = searcher.search({ query: "redis", queryVector: [1, 0, 0], currentPostId: null });
    expect(results[0]!.post.id).toBe(3);
  });

  it("returns nothing when there is neither a usable query nor a current post", () => {
    expect(searcher.search({ query: "!!!", queryVector: null, currentPostId: null })).toEqual([]);
  });
});
