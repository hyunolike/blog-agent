import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Independently calculated SHA256 of [question, text, sourceBlock, canonical sources].
const first = { model: "test", id: "q01", question: "Q", text: "first", sourceBlock: "original evidence", sources: [], requiredPostIds: [], answerHash: "977415191e3eb540ba397aa0d1081077ab37f05feb5bc39f3ce6b7f3b49c0fe7" };
const second = { ...first, text: "second", sourceBlock: "different evidence", answerHash: "e23bfce651e01c173bcfa9a3f56bad682ce2cbfc30fd0bb17442ea6ea12e94f1" };
const review = { model: "test", id: "q01", answerHash: first.answerHash, correctness: true, citationSupport: true, unsupportedRelationClaims: 0, notes: "Reviewed first answer only" };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });
function run(answers: unknown[], reviews: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "blog-answer-review-"));
  dirs.push(dir);
  const answerFile = join(dir, "answers.jsonl");
  const reviewFile = join(dir, "reviews.jsonl");
  writeFileSync(answerFile, answers.map((r) => JSON.stringify(r)).join("\n"));
  writeFileSync(reviewFile, reviews.map((r) => JSON.stringify(r)).join("\n"));
  return spawnSync(process.execPath, ["--import", "tsx", "eval/review.ts", answerFile, reviewFile], { encoding: "utf8" });
}

describe("review snapshot binding", () => {
  it("rejects duplicate model/question identities with different answers", () => {
    expect(run([first, second], [review]).status).toBe(1);
  });
  it("rejects an old judgment for a new answer and source snapshot", () => {
    expect(run([second], [review]).status).toBe(1);
  });
  it("rejects modified evidence even if the saved hash was not updated", () => {
    expect(run([{ ...first, sourceBlock: "modified evidence" }], [review]).status).toBe(1);
  });
  it("applies a judgment to exactly its reviewed snapshot", () => {
    const r = run([first], [review]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ correctness: true, citationSupport: true, unsupportedRelationClaims: 0 });
  });
  it("leaves a valid unreviewed snapshot's semantic judgments null", () => {
    const r = run([first], []);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ correctness: null, citationSupport: null, unsupportedRelationClaims: null });
  });
});
