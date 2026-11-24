/**
 * 사용자 평가를 요약하고 👎 사례를 평가셋 후보로 내보낸다.
 * 후보의 expectedPostIds는 비어 있다. 사람이 검토해 채운 것만 eval/questions.jsonl에 옮긴다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Redis } from "@upstash/redis";
import { createRedisFeedbackStore, type FeedbackRecord } from "@/lib/feedback";

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

async function main() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN이 필요합니다.");
  const records = await createRedisFeedbackStore(new Redis({ url, token })).listFeedback();
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

  const down = records.filter((r) => r.rating === "down").sort((a, b) => a.ratedAt.localeCompare(b.ratedAt));
  mkdirSync("eval/results", { recursive: true });
  const out = "eval/results/feedback-candidates.jsonl";
  writeFileSync(out, down.map((r) => JSON.stringify(toCandidate(r))).join("\n") + (down.length ? "\n" : ""));
  console.log(`\n👎 ${down.length}건을 ${out}에 썼습니다. expectedPostIds를 채운 뒤 eval/questions.jsonl로 옮기세요.`);
}

// 테스트에서 summarize, toCandidate만 가져다 쓸 때는 실행하지 않는다
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
