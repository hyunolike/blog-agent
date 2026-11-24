import { readFileSync } from "node:fs";
import { buildSearchQuery, type TextMessage } from "@/lib/prompt";

export type EvalQuestion = {
  id: string;
  type: "single" | "multi" | "keyword" | "comparison" | "paraphrase" | "followup" | "current" | "none" | "injection";
  question: string;
  expectedPostIds: number[];
  /** followup: 이 질문 앞에 사용자가 했던 질문들(오래된 것부터). */
  history?: string[];
  /** current: 사용자가 보고 있는 글. */
  currentPostId?: number;
};

/** 검색 평가 대상(답이 블로그에 있는 질문) */
export const ANSWERABLE: EvalQuestion["type"][] = ["single", "multi", "keyword", "comparison", "paraphrase", "followup", "current"];

export function loadQuestions(path = "eval/questions.jsonl"): EvalQuestion[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EvalQuestion);
}

/** 운영과 같은 대화 형태. 이전 답변은 평가셋에 없으므로 사용자 질문만 넣는다. */
export function toMessages(q: EvalQuestion): TextMessage[] {
  return [...(q.history ?? []), q.question].map((text) => ({ role: "user" as const, text }));
}

/** 운영의 /api/chat과 같은 방법으로 만든 검색 입력 */
export function searchInputOf(q: EvalQuestion): { query: string; currentPostId: number | null } {
  return { query: buildSearchQuery(toMessages(q)), currentPostId: q.currentPostId ?? null };
}

export function retrievalHit(q: EvalQuestion, retrievedPostIds: number[]): boolean {
  const hits = q.expectedPostIds.filter((id) => retrievedPostIds.includes(id)).length;
  if (q.type === "comparison") return hits === q.expectedPostIds.length;
  return q.type === "multi" ? hits >= 2 : hits >= 1;
}

/** 기대 글이 처음 나온 순위의 역수. 없으면 0. */
export function reciprocalRank(q: EvalQuestion, retrievedPostIds: number[]): number {
  const first = retrievedPostIds.findIndex((id) => q.expectedPostIds.includes(id));
  return first >= 0 ? 1 / (first + 1) : 0;
}
