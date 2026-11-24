/**
 * 사용자 평가를 요약하고 👎 사례를 평가셋 후보로 내보낸다.
 * 후보의 expectedPostIds는 비어 있다. 사람이 검토해 채운 것만 eval/questions.jsonl에 옮긴다.
 * 관리자 화면(/admin)에서 승인한 검토는 eval/questions.jsonl 끝에 바로 추가한다. 커밋은 사람이 한다.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Redis } from "@upstash/redis";
import { createRedisFeedbackStore, type FeedbackRecord, type Review } from "@/lib/feedback";
import { loadIndex } from "@/lib/index-store";
import { loadQuestions } from "./load";

export type FeedbackSummary = { group: string; up: number; down: number; reasons: Record<string, number> };

export function summarize(records: FeedbackRecord[], keyOf: (r: FeedbackRecord) => string): FeedbackSummary[] {
  const groups = new Map<string, FeedbackSummary>();
  for (const r of records) {
    const group = keyOf(r);
    const g = groups.get(group) ?? { group, up: 0, down: 0, reasons: {} };
    if (r.rating === "up") g.up += 1;
    else {
      g.down += 1;
      const reason = r.reason ?? "other";
      g.reasons[reason] = (g.reasons[reason] ?? 0) + 1;
    }
    groups.set(group, g);
  }
  return [...groups.values()].sort((a, b) => b.up + b.down - (a.up + a.down));
}

/** 평가셋과 같은 모양. 검토용 정보는 feedback 아래에 둔다 */
export function toCandidate(r: FeedbackRecord) {
  const history = r.history.filter((m) => m.role === "user").map((m) => m.text);
  return {
    id: `fb-${r.responseId.slice(0, 8)}`,
    type: history.length > 0 ? "followup" : r.currentPostId !== null ? "current" : "single",
    question: r.question,
    ...(history.length > 0 ? { history } : {}),
    ...(r.currentPostId !== null ? { currentPostId: r.currentPostId } : {}),
    expectedPostIds: [] as number[],
    feedback: { reason: r.reason, answer: r.answer, retrievedPostIds: r.postIds, chunkIds: r.chunkIds, model: r.model, promptVersion: r.promptVersion, ratedAt: r.ratedAt },
  };
}

/** 이미 평가셋(eval/questions.jsonl)에 옮긴 후보는 빼서, 다시 실행해도 새 👎만 검토하게 한다 */
export function newCandidates(records: FeedbackRecord[], existingIds: Set<string>) {
  const all = records.map(toCandidate);
  const fresh = all.filter((c) => !existingIds.has(c.id));
  return { fresh, skipped: all.length - fresh.length };
}

/** 승인한 검토를 평가셋 한 줄로. 유형 규칙은 toCandidate와 같고 feedback 필드는 넣지 않는다 */
export function toEvalQuestion(review: Review & { responseId: string }) {
  return {
    id: `fb-${review.responseId.slice(0, 8)}`,
    type: review.history.length > 0 ? "followup" : review.currentPostId !== null ? "current" : "single",
    question: review.question,
    ...(review.history.length > 0 ? { history: review.history } : {}),
    ...(review.currentPostId !== null ? { currentPostId: review.currentPostId } : {}),
    expectedPostIds: review.expectedPostIds,
  };
}

/** 평가셋에 추가할 승인 건. 이미 있는 ID, 인덱스에 없는 글, 같은 fb- ID 충돌은 건너뛴다 */
export function planExport(reviews: (Review & { responseId: string })[], existingIds: Set<string>, knownPostIds: Set<number> | null) {
  const added: ReturnType<typeof toEvalQuestion>[] = [];
  const warnings: string[] = [];
  let already = 0;
  const seen = new Set(existingIds);
  const approved = reviews.filter((r) => r.action === "approve").sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
  for (const r of approved) {
    const q = toEvalQuestion(r);
    if (existingIds.has(q.id)) {
      already += 1;
      continue;
    }
    if (seen.has(q.id)) {
      warnings.push(`${q.id}: 다른 응답과 ID가 겹쳐 건너뜀 (${r.responseId})`);
      continue;
    }
    const missing = knownPostIds ? q.expectedPostIds.filter((id) => !knownPostIds.has(id)) : [];
    if (missing.length > 0) {
      warnings.push(`${q.id}: 인덱스에 없는 글 ${missing.join(", ")}이 있어 건너뜀`);
      continue;
    }
    seen.add(q.id);
    added.push(q);
  }
  return { added, already, warnings };
}

async function main() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN이 필요합니다.");
  const store = createRedisFeedbackStore(new Redis({ url, token }));
  const [records, reviews] = await Promise.all([store.listFeedback(), store.listReviews()]);
  console.log(`평가 ${records.length}건`);
  const print = (title: string, rows: FeedbackSummary[]) => {
    console.log(`\n## ${title}`);
    for (const g of rows) {
      const total = g.up + g.down;
      const reasons = Object.entries(g.reasons).map(([k, v]) => `${k} ${v}`).join(", ");
      console.log(`${g.group}: 👍 ${g.up} 👎 ${g.down} (👎 ${((g.down / total) * 100).toFixed(0)}%)${reasons ? `  사유: ${reasons}` : ""}`);
    }
  };
  print("모델별", summarize(records, (r) => r.model ?? "unknown"));
  print("프롬프트 버전별", summarize(records, (r) => r.promptVersion));

  const questionsPath = "eval/questions.jsonl";
  const existingIds = new Set(loadQuestions(questionsPath).map((q) => q.id));
  const index = loadIndex();
  const { added, already, warnings } = planExport(reviews, existingIds, index ? new Set(index.index.posts.map((p) => p.id)) : null);
  if (!index) console.warn("글 인덱스를 읽지 못해 정답 글 ID를 확인하지 않았습니다.");
  if (added.length > 0) {
    const text = readFileSync(questionsPath, "utf8");
    const lead = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
    appendFileSync(questionsPath, lead + added.map((q) => JSON.stringify(q)).join("\n") + "\n");
  }
  for (const w of warnings) console.warn(`경고: ${w}`);
  console.log(`\n## 관리자 검토\n승인 ${added.length}건을 ${questionsPath}에 추가했습니다. 이미 평가셋에 있는 ${already}건, 경고 ${warnings.length}건은 건너뛰었습니다.`);
  if (added.length > 0) console.log("추가한 줄을 확인한 뒤 커밋하세요.");

  const reviewed = new Set(reviews.map((r) => r.responseId));
  const down = records
    .filter((r) => r.rating === "down" && !reviewed.has(r.responseId))
    .sort((a, b) => a.ratedAt.localeCompare(b.ratedAt));
  const { fresh, skipped } = newCandidates(down, new Set([...existingIds, ...added.map((q) => q.id)]));
  mkdirSync("eval/results", { recursive: true });
  const out = "eval/results/feedback-candidates.jsonl";
  writeFileSync(out, fresh.map((c) => JSON.stringify(c)).join("\n") + (fresh.length ? "\n" : ""));
  console.log(`\n검토하지 않은 👎 ${down.length}건 중 평가셋에 이미 있는 ${skipped}건을 빼고 ${fresh.length}건을 ${out}에 썼습니다.`);
  console.log("이 파일은 실행할 때마다 새로 씁니다. expectedPostIds를 채운 줄은 바로 eval/questions.jsonl로 옮기세요.");
}

// 테스트에서 summarize, toCandidate만 가져다 쓸 때는 실행하지 않는다
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
