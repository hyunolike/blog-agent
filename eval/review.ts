import { readFileSync } from "node:fs";
import { z } from "zod";
import { assessQuality, answerFingerprint } from "./quality";

const reviewSchema = z.object({
  model: z.string(), id: z.string(), answerHash: z.string().regex(/^[a-f0-9]{64}$/), correctness: z.boolean(), citationSupport: z.boolean(),
  unsupportedRelationClaims: z.number().int().nonnegative(), notes: z.string().min(1),
});
const answerSchema = z.object({
  model: z.string(), id: z.string(), question: z.string(), answerHash: z.string().regex(/^[a-f0-9]{64}$/), text: z.string(), requiredPostIds: z.array(z.number()),
  sources: z.array(z.object({ n: z.number(), postId: z.number(), title: z.string(), url: z.string(), section: z.string(), chunkId: z.string().optional() })),
  sourceBlock: z.string(),
});
const lines = (path: string) => readFileSync(path, "utf8").split("\n").filter((s) => s.trim()).map((s) => JSON.parse(s) as unknown);
const key = (r: { model: string; id: string }) => JSON.stringify([r.model, r.id]);

function main() {
  const [answersFile, reviewsFile] = process.argv.slice(2);
  if (!answersFile || !reviewsFile) throw new Error("사용법: npm run eval:review -- <answers.jsonl> <human-reviews.jsonl>");
  const answers = lines(answersFile).map((r) => answerSchema.parse(r));
  if (new Set(answers.map(key)).size !== answers.length) throw new Error("중복 답변 ID/model: 별도 실행 파일로 나누세요");
  for (const answer of answers) {
    if (answer.answerHash !== answerFingerprint(answer)) throw new Error("저장 답변/근거 fingerprint 불일치");
  }
  const reviews = lines(reviewsFile).map((r) => reviewSchema.parse(r));
  const byKey = new Map(reviews.map((r) => [key(r), r]));
  if (byKey.size !== reviews.length) throw new Error("중복 검토 ID/model");
  if (reviews.some((r) => !answers.some((a) => key(a) === key(r)))) throw new Error("답변 결과에 없는 검토 ID/model");
  for (const answer of answers) {
    if (byKey.has(key(answer)) && byKey.get(key(answer))!.answerHash !== answer.answerHash) throw new Error("검토한 답변/근거 snapshot 불일치");
  }
  for (const answer of answers) {
    console.log(JSON.stringify({ model: answer.model, id: answer.id, answerHash: answer.answerHash,
      ...assessQuality({ answer: answer.text, sources: answer.sources, requiredPostIds: answer.requiredPostIds }, byKey.get(key(answer))),
      notes: byKey.get(key(answer))?.notes ?? null }));
  }
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
