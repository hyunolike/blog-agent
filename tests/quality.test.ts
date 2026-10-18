import { describe, expect, it } from "vitest";
import { assessQuality } from "@/eval/quality";
import type { SourceRef } from "@/lib/types";

const sources: SourceRef[] = [
  { n: 1, chunkId: "15-1", postId: 15, title: "Redis 캐시", url: "https://hyunolike.tistory.com/15", section: "캐시" },
  { n: 2, chunkId: "20-1", postId: 20, title: "Redis 락", url: "https://hyunolike.tistory.com/20", section: "락" },
];

describe("separate answer quality axes", () => {
  it("does not mark a valid-but-wrong citation as correct or supported", () => {
    const q = assessQuality({ requiredPostIds: [15], answer: "Redis 캐시 때문에 모든 데드락이 사라졌다[1].", sources });
    expect(q.invalidCitationNumbers).toEqual([]);
    expect(q.correctness).toBeNull();
    expect(q.citationSupport).toBeNull();
    expect(q.unsupportedRelationClaims).toBeNull();
  });

  it("reports missing required articles independently of answer judgments", () => {
    const q = assessQuality({ requiredPostIds: [15, 20], answer: "캐시를 사용했다[1].", sources: sources.slice(0, 1) });
    expect(q.missingPostIds).toEqual([20]);
    expect(q.requiredPostRecall).toBe(0.5);
    expect(q.citedPostIds).toEqual([15]);
    expect(q.correctness).toBeNull();
  });

  it("keeps an unsupported relationship judgment separate from factual correctness", () => {
    const q = assessQuality({ requiredPostIds: [15, 20], answer: "두 글에 Redis가 등장한다[1,2].", sources },
      { correctness: true, citationSupport: false, unsupportedRelationClaims: 1 });
    expect(q.requiredPostRecall).toBe(1);
    expect(q.correctness).toBe(true);
    expect(q.citationSupport).toBe(false);
    expect(q.unsupportedRelationClaims).toBe(1);
  });

  it("reports unknown citation numbers and ignores markers inside code", () => {
    const q = assessQuality({ requiredPostIds: [], answer: "사실[1][99]. `array[98]`\n```js\nx[97]\n```", sources });
    expect(q.invalidCitationNumbers).toEqual([99]);
    expect(q.requiredPostRecall).toBeNull();
    expect(q.citedPostIds).toEqual([15]);
  });
});
