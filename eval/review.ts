import { readFileSync } from "node:fs";
import { z } from "zod";
import { assessQuality } from "./quality";

const reviewSchema = z.object({
  model: z.string(), id: z.string(), correctness: z.boolean(), citationSupport: z.boolean(),
  unsupportedRelationClaims: z.number().int().nonnegative(), notes: z.string().min(1),
});
const answerSchema = z.object({
  model: z.string(), id: z.string(), text: z.string(), requiredPostIds: z.array(z.number()),
  sources: z.array(z.object({ n: z.number(), postId: z.number(), title: z.string(), url: z.string(), section: z.string(), chunkId: z.string().optional() })),
  sourceBlock: z.string(),
});
const lines = (path: string) => readFileSync(path, "utf8").split("\n").filter((s) => s.trim()).map((s) => JSON.parse(s) as unknown);
const key = (r: { model: string; id: string }) => JSON.stringify([r.model, r.id]);

function main() {
  const [answersFile, reviewsFile] = process.argv.slice(2);
  if (!answersFile || !reviewsFile) throw new Error("사용법: npm run eval:review -- <answers.jsonl> <human-reviews.jsonl>");
  const answers = lines(answersFile).map((r) => answerSchema.parse(r));
  const reviews = lines(reviewsFile).map((r) => reviewSchema.parse(r));
  const byKey = new Map(reviews.map((r) => [key(r), r]));
  if (byKey.size !== reviews.length) throw new Error("중복 검토 ID/model");
  if (reviews.some((r) => !answers.some((a) => key(a) === key(r)))) throw new Error("답변 결과에 없는 검토 ID/model");
  for (const answer of answers) {
    console.log(JSON.stringify({ model: answer.model, id: answer.id,
      ...assessQuality({ answer: answer.text, sources: answer.sources, requiredPostIds: answer.requiredPostIds }, byKey.get(key(answer))),
      notes: byKey.get(key(answer))?.notes ?? null }));
  }
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
