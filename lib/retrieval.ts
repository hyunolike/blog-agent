import { decodeVector } from "./vector";
import { tokenize } from "./tokenize";
import type { BlogIndex, Chunk, Post } from "./types";

export const SEARCH = { candidates: 30, rrfK: 60, finalCount: 6, perPostCap: 3, currentPostBoost: 0.5 / 61 };

export type RetrievedChunk = { chunk: Chunk; post: Post; score: number };
export type SearchInput = { query: string; queryVector: ArrayLike<number> | null; currentPostId: number | null };
export type Searcher = { search(input: SearchInput): RetrievedChunk[] };

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
  const postById = new Map(index.posts.map((p) => [p.id, p]));
  const chunks = index.chunks.filter((c) => postById.has(c.postId));
  const vectors = chunks.map((c) => normalize(decodeVector(c.vector)));

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
    const terms = [...new Set(tokenize(query))];
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
    if (!queryVector || queryVector.length !== index.dimensions) return [];
    const q = normalize(queryVector);
    const scores = vectors.map((v) => {
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i]! * q[i]!;
      return dot;
    });
    return rank(scores, -Infinity);
  }

  function rank(scores: number[], floor = 0): number[] {
    return scores
      .map((s, i) => [s, i] as const)
      .filter(([s]) => s > floor)
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
      if (currentPostId !== null) {
        for (const [i, s] of fused) if (chunks[i]!.postId === currentPostId) fused.set(i, s + SEARCH.currentPostBoost);
      }

      const perPost = new Map<number, number>();
      const picked: RetrievedChunk[] = [];
      for (const [i, score] of [...fused].sort((a, b) => b[1] - a[1])) {
        if (picked.length >= SEARCH.finalCount) break;
        const chunk = chunks[i]!;
        const count = perPost.get(chunk.postId) ?? 0;
        if (count >= SEARCH.perPostCap) continue;
        perPost.set(chunk.postId, count + 1);
        picked.push({ chunk, post: postById.get(chunk.postId)!, score });
      }

      if (currentPostId !== null && postById.has(currentPostId)) {
        const summary = chunks.find((c) => c.postId === currentPostId && c.kind === "summary");
        if (summary && !picked.some((r) => r.chunk.id === summary.id)) {
          picked.push({ chunk: summary, post: postById.get(currentPostId)!, score: 0 });
        }
      }
      return picked;
    },
  };
}
