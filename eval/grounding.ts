import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildSearchQuery, buildSources } from "@/lib/prompt";
import { createSearcher, type Searcher } from "@/lib/retrieval";
import type { BlogIndex, EvidenceRelation } from "@/lib/types";
import { assessQuality } from "./quality";

export type GroundingCase = {
  id: string;
  question: string;
  previousQuestion?: string;
  currentPostId?: number;
  requiredPostIds: number[];
  forbiddenPostIds?: number[];
  relationKind?: EvidenceRelation["kind"];
  maxRelations?: number;
  maxSources?: number;
};

/** Offline only: no provider, credentials, .env loader, fetch or vector API. */
export function evaluateGrounding(searcher: Searcher, c: GroundingCase) {
  const query = buildSearchQuery([
    ...(c.previousQuestion ? [{ role: "user" as const, text: c.previousQuestion }] : []),
    { role: "user", text: c.question },
  ]);
  const results = searcher.search({ query, queryVector: null, currentPostId: c.currentPostId ?? null });
  const { block, sources, relations } = buildSources(results);
  const quality = assessQuality({ requiredPostIds: c.requiredPostIds, answer: "", sources });
  const forbidden = sources.filter((s) => c.forbiddenPostIds?.includes(s.postId)).map((s) => s.postId);
  const pass = quality.missingPostIds.length === 0 && forbidden.length === 0 && block.length <= 9000 &&
    (!c.relationKind || relations.some((r) => r.kind === c.relationKind)) &&
    (c.maxRelations === undefined || relations.length <= c.maxRelations) &&
    (c.maxSources === undefined || sources.length <= c.maxSources);
  return { id: c.id, pass, contextChars: block.length, sourceChunkIds: sources.map((s) => s.chunkId), relations, forbidden, ...quality };
}

function main() {
  const index = JSON.parse(readFileSync("data/index.json", "utf8")) as BlogIndex;
  const cases = JSON.parse(readFileSync("eval/grounding-cases.json", "utf8")) as GroundingCase[];
  const searcher = createSearcher(index);
  const rows = cases.map((c) => evaluateGrounding(searcher, c));
  for (const row of rows) console.log(JSON.stringify(row));
  console.log(`Offline evidence checks: ${rows.filter((r) => r.pass).length}/${rows.length}. Generated-answer correctness and citation support remain unreviewed.`);
  if (rows.some((r) => !r.pass)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
