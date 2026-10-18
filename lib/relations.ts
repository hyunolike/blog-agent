import { parseBlogPostId } from "./config";
import { isComparisonQuery, queryConcepts } from "./query";
import { tokenize } from "./tokenize";
import type { RetrievedChunk } from "./retrieval";
import type { BlogIndex, Chunk, EvidenceRelation } from "./types";

export const RELATION_LIMITS = { hops: 1, edges: 2, chunks: 10 };

/** Only an explicit part number establishes a series; categories never do. */
function seriesKey(title: string): string | null {
  const match = title.match(/^(.{4,}?)\s*(?:\(\d+\)|\d+\s*편)\s*$/);
  return match?.[1]?.trim().toLowerCase() ?? null;
}

export function createRelationExpander(index: BlogIndex) {
  const posts = new Map(index.posts.map((p) => [p.id, p]));
  const chunks = index.chunks.filter((c) => posts.has(c.postId));
  const byPost = new Map<number, Chunk[]>();
  const words = new Map<string, Set<string>>();
  for (const chunk of chunks) {
    byPost.set(chunk.postId, [...(byPost.get(chunk.postId) ?? []), chunk]);
    words.set(chunk.id, new Set(tokenize(`${chunk.headingPath.join(" ")} ${chunk.text}`)));
  }
  const links: { from: Chunk; toPostId: number; evidence: string }[] = [];
  const seenLinks = new Set<string>();
  // Prefer original body evidence over a summary that repeats the same link.
  for (const chunk of [...chunks].sort((a, b) => Number(a.kind === "summary") - Number(b.kind === "summary"))) {
    for (const match of chunk.text.matchAll(/https?:\/\/[^\s<>)\]"']+/g)) {
      const url = match[0].replace(/[.,;!?]+$/, "");
      const target = parseBlogPostId(url);
      const key = `${chunk.postId}:${target}`;
      if (target === null || target === chunk.postId || !posts.has(target) || seenLinks.has(key)) continue;
      links.push({ from: chunk, toPostId: target, evidence: url });
      seenLinks.add(key);
    }
  }

  return (query: string, initial: RetrievedChunk[], ranked: RetrievedChunk[]): RetrievedChunk[] => {
    if (!isComparisonQuery(query) || initial.length === 0) return initial;
    const picked = initial.map((r) => ({ ...r }));
    const seeds = [...new Map(initial.map((r) => [r.post.id, r])).values()].slice(0, 2);
    const scores = new Map(ranked.map((r) => [r.chunk.id, r.score]));
    const concepts = queryConcepts(query);
    const used = new Set<string>();
    let count = 0;

    const best = (postId: number, term?: string): Chunk | undefined => {
      const candidates = (byPost.get(postId) ?? []).filter((c) => !term || words.get(c.id)!.has(term));
      return candidates.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || Number(a.kind === "summary") - Number(b.kind === "summary"))[0];
    };
    const add = (kind: EvidenceRelation["kind"], from: Chunk, to: Chunk | undefined, evidence: string) => {
      if (!to || from.postId === to.postId || count >= RELATION_LIMITS.edges) return;
      const key = `${Math.min(from.postId, to.postId)}:${Math.max(from.postId, to.postId)}`;
      if (used.has(key)) return;
      const missing = [from, to].filter((c) => !picked.some((r) => r.chunk.id === c.id));
      if (picked.length + missing.length > RELATION_LIMITS.chunks) return;
      for (const chunk of missing) picked.push({ chunk, post: posts.get(chunk.postId)!, score: scores.get(chunk.id) ?? 0 });
      const edge: EvidenceRelation = { kind, fromChunkId: from.id, toChunkId: to.id, evidence };
      const target = picked.find((r) => r.chunk.id === to.id)!;
      target.relations = [...(target.relations ?? []), edge];
      used.add(key);
      count++;
    };

    // Only the original seeds are traversed: newly added neighbors never recurse.
    for (const seed of seeds) {
      for (const link of links) {
        if (link.from.postId === seed.post.id || link.toPostId === seed.post.id) {
          add("link", link.from, best(link.toPostId), link.evidence);
        }
      }
      const series = seriesKey(seed.post.title);
      if (series) for (const post of index.posts) {
        if (post.id !== seed.post.id && seriesKey(post.title) === series) {
          add("series", seed.chunk, best(post.id), `${seed.post.title} / ${post.title}`);
        }
      }
      for (const term of concepts) {
        const from = best(seed.post.id, term);
        if (!from) continue;
        const related = [...posts.keys()]
          .filter((id) => id !== seed.post.id)
          .map((id) => best(id, term))
          .filter((c): c is Chunk => !!c)
          .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
        for (const to of related) add("concept", from, to, term);
      }
    }
    return picked;
  };
}
