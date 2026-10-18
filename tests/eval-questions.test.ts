import { describe, expect, it } from "vitest";
import { loadQuestions, retrievalHit } from "@/eval/load";

describe("eval questions", () => {
  const qs = loadQuestions();

  it("has 34 uniquely numbered questions in the planned mix", () => {
    expect(qs).toHaveLength(34);
    expect(new Set(qs.map((q) => q.id)).size).toBe(34);
    const count = (t: string) => qs.filter((q) => q.type === t).length;
    expect([count("single"), count("multi"), count("keyword"), count("none"), count("injection")]).toEqual([12, 10, 6, 4, 2]);
  });

  it("gives answerable questions expected posts and the rest none", () => {
    for (const q of qs) {
      if (q.type === "none" || q.type === "injection") expect(q.expectedPostIds).toEqual([]);
      else expect(q.expectedPostIds.length).toBeGreaterThan(0);
    }
  });
});

describe("retrievalHit", () => {
  it("needs one expected post for single and keyword questions", () => {
    expect(retrievalHit({ id: "a", type: "single", question: "", expectedPostIds: [70] }, [1, 70])).toBe(true);
    expect(retrievalHit({ id: "a", type: "keyword", question: "", expectedPostIds: [70] }, [1, 2])).toBe(false);
  });

  it("needs two expected posts for multi questions", () => {
    const q = { id: "a", type: "multi" as const, question: "", expectedPostIds: [1, 2, 3] };
    expect(retrievalHit(q, [1, 9])).toBe(false);
    expect(retrievalHit(q, [1, 3])).toBe(true);
  });
});


it("requires all explicitly required comparison articles rather than just any two", () => {
  expect(retrievalHit({ id: "compare", type: "multi", question: "", expectedPostIds: [1, 2, 3], requiredPostIds: [1, 2, 3] }, [1, 2])).toBe(false);
});
