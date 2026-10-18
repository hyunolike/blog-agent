import { readFileSync } from "node:fs";
import { createProvider } from "@/lib/provider";
import { createSearcher, SEARCH } from "@/lib/retrieval";
import type { BlogIndex } from "@/lib/types";
import { loadQuestions, retrievalHit } from "./load";

const TARGET = 0.9;

async function main() {
  const index = JSON.parse(readFileSync("data/index.json", "utf8")) as BlogIndex;
  const apiKey = process.env.NVIDIA_API_KEY;
  const questions = loadQuestions().filter((q) => q.type === "single" || q.type === "multi" || q.type === "keyword");

  let vectors: number[][] | null = null;
  if (apiKey) {
    vectors = await createProvider(apiKey).embed(index.embeddingModel, questions.map((q) => q.question), "query");
  } else {
    console.warn("NVIDIA_API_KEY가 없어 키워드 검색만으로 평가합니다.");
  }

  const searcher = createSearcher(index);
  let hits = 0;
  let coverage = 0;
  for (const [i, q] of questions.entries()) {
    const results = searcher.search({ query: q.question, queryVector: vectors?.[i] ?? null, currentPostId: null });
    const postIds = [...new Set(results.map((r) => r.post.id))];
    const ok = retrievalHit(q, postIds);
    if (ok) hits++;
    // Expected IDs can be alternatives for broad questions; this is article coverage, not answer correctness.
    coverage += q.expectedPostIds.filter((id) => postIds.includes(id)).length / q.expectedPostIds.length;
    console.log(`${ok ? "✓" : "✗"} ${q.id} [${q.type}] 기대 ${q.expectedPostIds.join(",")} / 검색 ${postIds.join(",")}  ${q.question}`);
  }
  console.log(`검색 한도: 단순 ${SEARCH.finalCount}, 목록 ${SEARCH.listCount} 조각, 비교는 최대 2개 관계 확장 (고정 recall@6가 아님)`);
  const recall = hits / questions.length;
  console.log(`\n검색 적중률 = ${(recall * 100).toFixed(1)}% (${hits}/${questions.length}), 목표 ${TARGET * 100}%, 임베딩 ${index.embeddingModel}`);
  console.log(`기대/대안 글 회수율 = ${((coverage / questions.length) * 100).toFixed(1)}%`);
  if (process.env.GITHUB_STEP_SUMMARY && recall < TARGET) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `⚠️ 검색 적중률 ${(recall * 100).toFixed(1)}%로 목표 90% 미만\n`);
  }
  if (recall < TARGET) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
