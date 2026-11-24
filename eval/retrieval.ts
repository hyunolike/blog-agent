import { appendFileSync, readFileSync } from "node:fs";
import { createProvider } from "@/lib/provider";
import { createSearcher } from "@/lib/retrieval";
import type { BlogIndex } from "@/lib/types";
import { ANSWERABLE, loadQuestions, reciprocalRank, retrievalHit, searchInputOf, type EvalQuestion } from "./load";

const TARGET = 0.9;

type Mode = "hybrid" | "keyword" | "vector";
type Row = { q: EvalQuestion; postIds: number[]; hit: boolean; rr: number };

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  const index = JSON.parse(readFileSync("data/index.json", "utf8")) as BlogIndex;
  const apiKey = process.env.NVIDIA_API_KEY;
  const questions = loadQuestions().filter((q) => ANSWERABLE.includes(q.type));
  const inputs = questions.map(searchInputOf);

  let vectors: number[][] | null = null;
  if (apiKey) {
    // 운영처럼 history를 합친 검색어를 임베딩한다
    vectors = await createProvider(apiKey).embed(index.embeddingModel, inputs.map((i) => i.query), "query");
  } else {
    console.warn("NVIDIA_API_KEY가 없어 키워드 검색만으로 평가합니다. paraphrase 문항은 기준에서 뺍니다.");
  }

  const searcher = createSearcher(index);
  const run = (mode: Mode): Row[] =>
    questions.map((q, i) => {
      const { query, currentPostId } = inputs[i]!;
      const results = searcher.search({
        // 벡터만: 토큰이 나오지 않는 빈 검색어로 키워드 순위를 끈다(목록형 질문 판별도 꺼진다)
        query: mode === "vector" ? "" : query,
        queryVector: mode === "keyword" ? null : (vectors?.[i] ?? null),
        currentPostId,
      });
      const postIds = [...new Set(results.map((r) => r.post.id))];
      return { q, postIds, hit: retrievalHit(q, postIds), rr: reciprocalRank(q, postIds) };
    });

  const modes: Mode[] = vectors ? ["hybrid", "keyword", "vector"] : ["keyword"];
  const rows = new Map(modes.map((m) => [m, run(m)]));
  const primary = rows.get(modes[0]!)!;

  for (const r of primary) {
    console.log(`${r.hit ? "✓" : "✗"} ${r.q.id} [${r.q.type}] 기대 ${r.q.expectedPostIds.join(",")} / 검색 ${r.postIds.join(",")}  ${r.q.question}`);
  }

  // 유형별, 방식별 적중률과 MRR
  const types = ANSWERABLE.filter((t) => questions.some((q) => q.type === t));
  const summarize = (rs: Row[]) =>
    rs.length === 0 ? "-" : `${pct(rs.filter((r) => r.hit).length / rs.length)} / ${(rs.reduce((a, r) => a + r.rr, 0) / rs.length).toFixed(3)}`;
  console.log(`\n유형별 적중률 / MRR (임베딩 ${index.embeddingModel})`);
  console.log(["유형".padEnd(18), ...modes.map((m) => m.padEnd(16))].join(""));
  for (const t of [...types, "전체"] as const) {
    const cells = modes.map((m) => summarize(rows.get(m)!.filter((r) => t === "전체" || r.q.type === t)).padEnd(16));
    const n = t === "전체" ? questions.length : questions.filter((q) => q.type === t).length;
    console.log([`${t}(${n})`.padEnd(18), ...cells].join(""));
  }

  // 기준: 키가 있으면 하이브리드 전체, 없으면 paraphrase를 뺀 키워드 검색
  const gated = vectors ? primary : primary.filter((r) => r.q.type !== "paraphrase");
  const recall = gated.filter((r) => r.hit).length / gated.length;
  const coverage =
    gated.reduce((a, r) => a + Math.min(1, r.q.expectedPostIds.filter((id) => r.postIds.includes(id)).length / Math.min(r.q.expectedPostIds.length, 6)), 0) /
    gated.length;
  const scope = vectors ? "하이브리드 전체" : "키워드 검색, paraphrase 제외";
  console.log(`\n기준 적중률 = ${pct(recall)} (${gated.filter((r) => r.hit).length}/${gated.length}, ${scope}), 목표 ${TARGET * 100}%`);
  console.log(`기대 글 커버리지 = ${pct(coverage)}`);

  if (process.env.GITHUB_STEP_SUMMARY && recall < TARGET) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `⚠️ 검색 적중률 ${pct(recall)}(${scope})로 목표 90% 미만\n`);
  }
  if (recall < TARGET) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
