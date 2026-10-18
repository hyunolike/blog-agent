import { decodeVector } from "./vector";
import { tokenize } from "./tokenize";
import { isComparisonQuery, isCurrentPostQuery, queryConcepts, searchTerms } from "./query";
import type { BlogIndex, Chunk, EvidenceRelation, Post } from "./types";
import { createRelationExpander } from "./relations";

export const SEARCH = { candidates: 30, rrfK: 60, finalCount: 6, perPostCap: 3, listCount: 8 };

// "보여줘", "정리해줘", "어떤 작업들", "경험" 같은 표현은 글 하나보다 여러 글을 원하는 질문이다
const LISTING = /보여\s?줘|목록|전부|전체|모두|정리해|뭐뭐|어떤\s?\S*들|경험/;

/** 지금 질문(검색어 첫 줄)이 여러 글을 훑어 달라는 목록형 질문인지 */
export function isListingQuery(query: string): boolean {
  return LISTING.test(query.split("\n")[0] ?? "");
}

export type RetrievedChunk = { chunk: Chunk; post: Post; score: number; relations?: EvidenceRelation[] };
export type SearchInput = { query: string; queryVector: ArrayLike<number> | null; currentPostId: number | null };
export type Searcher = { search(input: SearchInput): RetrievedChunk[] };

/** 보고 있는 글에서 요약 다음에 넣는 본문 조각 수 */
const CURRENT_POST_BODY = 2;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

function normalize(v: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(v);
  let norm = 0;
  for (const x of out) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i]! /= norm;
  return out;
}

export function createSearcher(index: BlogIndex): Searcher {
  const expandRelations = createRelationExpander(index);
  const postById = new Map(index.posts.map((p) => [p.id, p]));
  const chunks = index.chunks.filter((c) => postById.has(c.postId));
  const vectors = chunks.map((c) => {
    try {
      const v = decodeVector(c.vector);
      return v.length === index.dimensions && [...v].every(Number.isFinite) ? normalize(v) : null;
    } catch {
      return null;
    }
  });

  const termFreqs = chunks.map((c) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(`${c.headingPath.join(" ")} ${c.embedText}`)) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const lengths = termFreqs.map((tf) => [...tf.values()].reduce((a, b) => a + b, 0));
  const avgLen = lengths.reduce((a, b) => a + b, 0) / Math.max(lengths.length, 1);
  const docFreq = new Map<string, number>();
  for (const tf of termFreqs) for (const t of tf.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);

  function bm25Ranking(query: string): number[] {
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    const scores = termFreqs.map((tf, i) => {
      let s = 0;
      for (const t of terms) {
        const f = tf.get(t);
        if (!f) continue;
        const df = docFreq.get(t)!;
        const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
        s += (idf * f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * lengths[i]!) / avgLen));
      }
      return s;
    });
    return rank(scores);
  }

  function vectorRanking(queryVector: ArrayLike<number> | null): number[] {
    if (!queryVector || queryVector.length !== index.dimensions || !Array.from(queryVector).every(Number.isFinite)) return [];
    const q = normalize(queryVector);
    const scores = vectors.map((v) => {
      if (!v) return 0;
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i]! * q[i]!;
      return dot;
    });
    return rank(scores);
  }

  function rank(scores: number[], floor = 0): number[] {
    return scores
      .map((s, i) => [s, i] as const)
      .filter(([s]) => Number.isFinite(s) && s > floor)
      .sort((a, b) => b[0] - a[0])
      .slice(0, SEARCH.candidates)
      .map(([, i]) => i);
  }

  return {
    search({ query, queryVector, currentPostId }) {
      const fused = new Map<number, number>();
      for (const ranking of [bm25Ranking(query), vectorRanking(queryVector)]) {
        ranking.forEach((chunkIdx, r) => fused.set(chunkIdx, (fused.get(chunkIdx) ?? 0) + 1 / (SEARCH.rrfK + r + 1)));
      }

      // An exact indexed technical term is a stronger eligibility signal than a
      // weak positive vector match or a conversational Hangul bigram.
      const anchors = queryConcepts(query).filter((t) => docFreq.has(t));
      const ranked = [...fused]
        .filter(([i]) => anchors.length === 0 || anchors.some((t) => termFreqs[i]!.has(t)))
        .sort((a, b) => b[1] - a[1]);
      const picked: RetrievedChunk[] = [];
      const take = (i: number, score: number) => picked.push({ chunk: chunks[i]!, post: postById.get(chunks[i]!.postId)!, score });
      const current = isCurrentPostQuery(query) && currentPostId !== null && postById.has(currentPostId) ? currentPostId : null;
      // 목록형 질문은 칸을 늘리고 글마다 한 조각씩만 담아 더 많은 글을 보여준다
      const listing = isListingQuery(query);
      let limit = listing ? SEARCH.listCount : SEARCH.finalCount;

      // 보고 있는 글: 요약이 출처 1번, 이어서 그 글 본문 최대 2개(순위에 없으면 앞쪽 본문 2개)
      if (current !== null) {
        limit += 1;
        const summaryIdx = chunks.findIndex((c) => c.postId === current && c.kind === "summary");
        if (summaryIdx >= 0) take(summaryIdx, fused.get(summaryIdx) ?? 0);
        const isCurrentBody = (i: number) => chunks[i]!.postId === current && chunks[i]!.kind === "body";
        let body = ranked.filter(([i]) => isCurrentBody(i)).slice(0, CURRENT_POST_BODY);
        if (body.length === 0) {
          const order = (i: number) => Number(chunks[i]!.id.split("-").pop());
          body = chunks
            .map((_, i) => i)
            .filter(isCurrentBody)
            .sort((a, b) => order(a) - order(b))
            .slice(0, CURRENT_POST_BODY)
            .map((i) => [i, 0] as const);
        }
        for (const [i, score] of body) take(i, score);
      }

      // Diversity is useful for lists/comparisons, not a reason to pad a simple
      // question with unrelated articles. Eligibility was checked before this step.
      const others = ranked.filter(([i]) => chunks[i]!.postId !== current);
      const slots = limit - picked.length;
      const chosen = new Set<number>();
      const perPost = new Map<number, number>();
      const fill = (cap: number, until: number) => {
        for (const [i] of others) {
          if (chosen.size >= until) return;
          const postId = chunks[i]!.postId;
          const count = perPost.get(postId) ?? 0;
          if (chosen.has(i) || count >= cap) continue;
          perPost.set(postId, count + 1);
          chosen.add(i);
        }
      };
      if (listing || isComparisonQuery(query)) fill(1, listing ? slots : Math.min(4, slots));
      fill(SEARCH.perPostCap, slots);
      for (const [i, score] of others) if (chosen.has(i)) take(i, score);
      return expandRelations(query, picked, ranked.map(([i, score]) => ({ chunk: chunks[i]!, post: postById.get(chunks[i]!.postId)!, score })));
    },
  };
}
