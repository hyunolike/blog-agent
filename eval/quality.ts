import { createHash } from "node:crypto";
import type { SourceRef } from "@/lib/types";

/** Human judgments refer to the saved answer AND its exact source block. */
export type QualityReview = {
  correctness: boolean;
  citationSupport: boolean;
  unsupportedRelationClaims: number;
};

export function assessQuality(
  input: { requiredPostIds: number[]; answer: string; sources: SourceRef[] },
  review?: QualityReview,
) {
  const required = [...new Set(input.requiredPostIds)];
  const available = new Set(input.sources.map((s) => s.postId));
  const numbers = new Set<number>();
  const prose = input.answer.replace(/```[\s\S]*?```|`[^`\n]*`/g, "");
  for (const match of prose.matchAll(/[\[【［](\d+(?:\s*,\s*\d+)*)[\]】］]/g)) {
    for (const n of match[1]!.split(",")) numbers.add(Number(n.trim()));
  }
  const missingPostIds = required.filter((id) => !available.has(id));
  return {
    requiredPostRecall: required.length ? 1 - missingPostIds.length / required.length : null,
    missingPostIds,
    citedPostIds: [...new Set(input.sources.filter((s) => numbers.has(s.n)).map((s) => s.postId))],
    invalidCitationNumbers: [...numbers].filter((n) => !input.sources.some((s) => s.n === n)).sort((a, b) => a - b),
    // Citation syntax and retrieved articles cannot establish semantic correctness.
    correctness: review?.correctness ?? null,
    citationSupport: review?.citationSupport ?? null,
    unsupportedRelationClaims: review?.unsupportedRelationClaims ?? null,
  };
}

/** Stable across object-property order, but bound to exact question, answer and evidence. */
export function answerFingerprint(input: { question: string; text: string; sourceBlock: string; sources: SourceRef[] }): string {
  const canonical = [input.question, input.text, input.sourceBlock,
    [...input.sources].sort((a, b) => a.n - b.n).map((s) => [s.n, s.chunkId ?? null, s.postId, s.title, s.url, s.section])];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
