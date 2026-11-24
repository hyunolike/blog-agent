import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefusal, loadQuestions, reciprocalRank, retrievalHit, searchInputOf, type EvalQuestion } from "@/eval/load";
import type { BlogIndex } from "@/lib/types";

const q = (over: Partial<EvalQuestion>): EvalQuestion => ({ id: "a", type: "single", question: "", expectedPostIds: [], ...over });

describe("eval questions", () => {
  const qs = loadQuestions();
  const count = (t: EvalQuestion["type"]) => qs.filter((x) => x.type === t).length;

  it("has 52 uniquely numbered questions in the planned mix", () => {
    expect(qs).toHaveLength(52);
    expect(new Set(qs.map((x) => x.id)).size).toBe(52);
    expect([count("single"), count("multi"), count("keyword"), count("none"), count("injection")]).toEqual([12, 7, 6, 4, 2]);
    expect([count("comparison"), count("paraphrase"), count("followup"), count("current")]).toEqual([3, 10, 5, 3]);
  });

  it("gives answerable questions expected posts and the rest none", () => {
    for (const x of qs) {
      if (x.type === "none" || x.type === "injection") expect(x.expectedPostIds).toEqual([]);
      else expect(x.expectedPostIds.length).toBeGreaterThan(0);
    }
  });

  it("gives follow-ups a history and current-post questions a post", () => {
    for (const x of qs) {
      expect((x.history?.length ?? 0) > 0, x.id).toBe(x.type === "followup");
      expect(x.currentPostId !== undefined, x.id).toBe(x.type === "current");
      if (x.type === "comparison") expect(x.expectedPostIds, x.id).toHaveLength(2);
    }
  });

  it("only expects posts that exist in the index", () => {
    const index = JSON.parse(readFileSync("data/index.json", "utf8")) as BlogIndex;
    const ids = new Set(index.posts.map((p) => p.id));
    for (const x of qs) {
      for (const id of [...x.expectedPostIds, ...(x.currentPostId ? [x.currentPostId] : [])]) expect(ids.has(id), `${x.id}: ${id}`).toBe(true);
    }
  });
});

describe("retrievalHit", () => {
  it("needs one expected post for single, keyword, paraphrase, followup and current questions", () => {
    for (const type of ["single", "keyword", "paraphrase", "followup", "current"] as const) {
      expect(retrievalHit(q({ type, expectedPostIds: [70] }), [1, 70])).toBe(true);
      expect(retrievalHit(q({ type, expectedPostIds: [70] }), [1, 2])).toBe(false);
    }
  });

  it("needs two expected posts for multi questions", () => {
    const multi = q({ type: "multi", expectedPostIds: [1, 2, 3] });
    expect(retrievalHit(multi, [1, 9])).toBe(false);
    expect(retrievalHit(multi, [1, 3])).toBe(true);
  });

  it("needs every expected post for comparison questions", () => {
    const cmp = q({ type: "comparison", expectedPostIds: [40, 25] });
    expect(retrievalHit(cmp, [40, 9])).toBe(false);
    expect(retrievalHit(cmp, [25, 9, 40])).toBe(true);
  });
});

describe("reciprocalRank", () => {
  it("scores the first expected post by its rank and misses as 0", () => {
    expect(reciprocalRank(q({ expectedPostIds: [5, 7] }), [5, 1])).toBe(1);
    expect(reciprocalRank(q({ expectedPostIds: [5, 7] }), [1, 2, 7])).toBeCloseTo(1 / 3);
    expect(reciprocalRank(q({ expectedPostIds: [5] }), [1, 2])).toBe(0);
  });
});

describe("searchInputOf", () => {
  it("builds the query like production: latest question first, then the previous one", () => {
    const input = searchInputOf(q({ type: "followup", history: ["오래된 질문", "SSE를 고른 이유는?"], question: "끊기면 어떻게 했어?" }));
    expect(input).toEqual({ query: "끊기면 어떻게 했어?\nSSE를 고른 이유는?", currentPostId: null });
  });

  it("passes the viewed post", () => {
    expect(searchInputOf(q({ type: "current", currentPostId: 70, question: "왜?" }))).toEqual({ query: "왜?", currentPostId: 70 });
  });
});

describe("isRefusal", () => {
  it("accepts the ways models say the blog has no answer", () => {
    for (const t of [
      "블로그에는 없는 내용이에요.",
      "블로그에는 그런 내용이 없습니다.",
      "블로그 주인 연봉은 언급된 바가 없습니다. [1]",
      "결혼 여부는 블로그에 언급되지 않았습니다.",
      "블로그 주인에 대한 정보는 확인할 수 없습니다.",
      "음식에 대한 명시적인 언급이 없다.",
    ]) expect(isRefusal(t), t).toBe(true);
  });

  it("rejects answers and self-introductions", () => {
    expect(isRefusal("Redis 분산락은 Redisson으로 적용했습니다. [1]")).toBe(false);
    expect(isRefusal("아니요, 저는 NVIDIA의 연구원들에 의해 훈련된 언어 모델입니다. 그런 정보는 알 수 없습니다.")).toBe(false);
  });
});
