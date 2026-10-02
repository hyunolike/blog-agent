import { readFileSync } from "node:fs";

export type EvalQuestion = {
  id: string;
  type: "single" | "multi" | "keyword" | "none" | "injection";
  question: string;
  expectedPostIds: number[];
};

export function loadQuestions(path = "eval/questions.jsonl"): EvalQuestion[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EvalQuestion);
}

export function retrievalHit(q: EvalQuestion, retrievedPostIds: number[]): boolean {
  const hits = q.expectedPostIds.filter((id) => retrievedPostIds.includes(id)).length;
  return q.type === "multi" ? hits >= 2 : hits >= 1;
}
