import { describe, expect, it } from "vitest";
import { createSearcher, type RetrievedChunk } from "@/lib/retrieval";
import { buildSources } from "@/lib/prompt";
import { encodeVector } from "@/lib/vector";
import type { BlogIndex } from "@/lib/types";

function corpus(texts: string[], titles = texts.map((_, i) => `글 ${i + 1}`)): BlogIndex {
  return {
    version: 1, embeddingModel: "test", dimensions: 2, builtAt: "",
    posts: texts.map((_, i) => ({ id: i + 1, url: `https://hyunolike.tistory.com/${i + 1}`, title: titles[i]!, prefix: ["프로젝트"], category: "BE", summary: "", publishedAt: "", modifiedAt: "" })),
    chunks: texts.map((text, i) => ({ id: `${i + 1}-1`, postId: i + 1, kind: "body", headingPath: [], text, embedText: text, hash: "", vector: encodeVector([1, 0]) })),
  };
}
const search = (i: BlogIndex, query: string) => createSearcher(i).search({ query, queryVector: null, currentPostId: null });
const edges = (r: RetrievedChunk[]) => r.flatMap((c) => c.relations ?? []);

describe("bounded evidence expansion", () => {
  it("follows a same-blog link one hop with the original link-bearing chunk as evidence", () => {
    const i = corpus(["systemd 설계의 배경: https://hyunolike.tistory.com/2", "실제 운영 배경. https://hyunolike.tistory.com/3", "두 번째 이웃"]);
    const r = search(i, "systemd 설계 글과 연결된 글의 관계를 비교해줘");
    expect(r.some((c) => c.post.id === 2)).toBe(true);
    expect(r.some((c) => c.post.id === 3)).toBe(false);
    expect(edges(r)).toEqual([expect.objectContaining({ kind: "link", fromChunkId: "1-1", toChunkId: "2-1", evidence: "https://hyunolike.tistory.com/2" })]);
    const out = buildSources(r);
    expect(out.relations).toEqual([expect.objectContaining({ kind: "link", from: 1, to: 2 })]);
    expect(out.block).toContain('kind="link"');
    expect(out.block).toContain("https://hyunolike.tistory.com/2");
  });

  it("leaves simple questions on ordinary search even when a link exists", () => {
    const r = search(corpus(["systemd 이유 https://hyunolike.tistory.com/2", "별도 배경 글"]), "systemd 이유는?");
    expect(r.map((c) => c.post.id)).toEqual([1]);
    expect(edges(r)).toEqual([]);
  });

  it("does not turn wrong-host URLs or a shared category into a relationship", () => {
    const r = search(corpus(["systemd https://hyunolike.tistory.com.evil.test/2", "Redis"]), "systemd 관계 비교");
    expect(r.map((c) => c.post.id)).toEqual([1]);
    expect(edges(r)).toEqual([]);
  });

  it("recognizes explicitly numbered titles as a series with title evidence", () => {
    const r = search(corpus(["PostGIS 전환 배경", "마이그레이션 수행 결과"], ["DB 전환 (1)", "DB 전환 (2)"]), "PostGIS 글의 시리즈 관계 비교");
    expect(r.some((c) => c.post.id === 2)).toBe(true);
    expect(edges(r)).toContainEqual(expect.objectContaining({ kind: "series", fromChunkId: "1-1", toChunkId: "2-1", evidence: "DB 전환 (1) / DB 전환 (2)" }));
  });

  it("records an exact query concept on both sides without a causal edge", () => {
    const r = search(corpus(["Redis 캐시로 조회를 줄였다", "Redis 분산락으로 중복을 제어했다"]), "Redis 사용 방식 비교");
    expect(edges(r)).toContainEqual(expect.objectContaining({ kind: "concept", evidence: "redis", fromChunkId: "1-1", toChunkId: "2-1" }));
    const out = buildSources(r);
    expect(out.relations.some((e) => e.kind === "concept")).toBe(true);
    expect(out.sources.map((s) => s.chunkId)).toEqual(["1-1", "2-1"]);
  });

  it("keeps the concept-bearing passage when it occurs late in a long chunk", () => {
    const r = search(corpus(["가".repeat(4000) + " Redis 캐시의 실제 원문 근거", "Redis 분산락 원문"]), "Redis 비교");
    const out = buildSources(r);
    expect(out.block).toContain("Redis 캐시의 실제 원문 근거");
    expect(out.block.length).toBeLessThanOrEqual(9000);
  });

  it("does not weaken a compound error code into a generic prefix relationship", () => {
    const r = search(corpus(["ORA-28040 인증 오류", "ORA-12514 리스너 오류"]), "ORA-28040 관계 비교");
    expect(r.map((c) => c.post.id)).toEqual([1]);
    expect(edges(r)).toEqual([]);
  });

  it("does not treat injected project membership as original concept evidence", () => {
    const r = search(corpus(["프로젝트: DND 동아리 프로젝트\n지리 알고리즘 원문", "프로젝트: DND 동아리 프로젝트\n인프라 비용 원문"]), "DND 동아리 글 비교해줘");
    expect(r).toHaveLength(2); // Enrichment remains useful for ordinary retrieval.
    expect(edges(r)).toEqual([]);
  });

  it("clips around the exact concept instead of a preceding substring", () => {
    const r = search(corpus(["redistribution ".repeat(250) + " Redis cache is used.", "Redis lock is used."]), "Redis 비교");
    const out = buildSources(r);
    expect(out.block).toContain("Redis cache is used.");
    expect(out.relations).toHaveLength(1);
  });

  it("does not use generic API co-occurrence as a concept edge", () => {
    expect(edges(search(corpus(["API 설계", "API 운영"]), "API 비교"))).toEqual([]);
  });

  it("caps expansion and does not recurse through a link cycle", () => {
    const r = search(corpus(["systemd https://hyunolike.tistory.com/2 https://hyunolike.tistory.com/3 https://hyunolike.tistory.com/4", "https://hyunolike.tistory.com/1", "셋째", "넷째"]), "systemd 연관 관계 비교");
    expect(edges(r)).toHaveLength(2);
    expect(r).toHaveLength(3);
  });

  it("never serializes a relation whose endpoint did not survive the source budget", () => {
    const r = search(corpus(["systemd https://hyunolike.tistory.com/2", "배경"]), "systemd 관계 비교");
    // Metadata alone exceeds the budget: the target cannot become a real source.
    r.find((c) => c.post.id === 2)!.post.title = "가".repeat(10000);
    const out = buildSources(r);
    expect(out.sources.map((s) => s.postId)).toEqual([1]);
    expect(out.relations).toEqual([]);
    expect(out.block.length).toBeLessThanOrEqual(9000);
  });
});
