import { createHash } from "node:crypto";
import { encodeVector } from "@/lib/vector";
import type { BlogIndex, Chunk, Post } from "@/lib/types";
import { chunkPost, type ChunkDraft } from "./chunk";
import { extractPost } from "./extract";
import { parseSitemap, planUpdate } from "./sitemap";

export type BuildDeps = {
  fetchSitemap(): Promise<string>;
  fetchHtml(url: string): Promise<string>;
  embed(texts: string[]): Promise<number[][]>;
  embeddingModel: string;
  now(): Date;
  sleep(ms: number): Promise<void>;
  log(msg: string): void;
};

const EMBED_BATCH = 64;
const FETCH_DELAY_MS = 1000;

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export async function buildIndex(prev: BlogIndex | null, deps: BuildDeps): Promise<BlogIndex> {
  const entries = parseSitemap(await deps.fetchSitemap());
  if (entries.length === 0) throw new Error("sitemap에서 글을 하나도 찾지 못했습니다. sitemap.xml 형식을 확인하세요.");

  const plan = planUpdate(prev?.posts ?? [], entries);
  deps.log(`fetch ${plan.fetch.length}, keep ${plan.keep.length}, removed ${plan.removed.length}`);

  const posts = new Map<number, Post>();
  const drafts = new Map<number, ChunkDraft[]>();
  const keep = new Set(plan.keep);

  for (const p of prev?.posts ?? []) if (keep.has(p.id)) posts.set(p.id, p);
  for (const c of prev?.chunks ?? []) {
    if (!keep.has(c.postId)) continue;
    const { hash: _h, vector: _v, ...draft } = c;
    drafts.set(c.postId, [...(drafts.get(c.postId) ?? []), draft]);
  }

  for (const [i, entry] of plan.fetch.entries()) {
    if (i > 0) await deps.sleep(FETCH_DELAY_MS);
    const { markdown, ...post } = extractPost(await deps.fetchHtml(entry.url), entry.url);
    posts.set(post.id, post);
    drafts.set(post.id, chunkPost({ ...post, markdown }));
  }

  const sameModel = prev?.embeddingModel === deps.embeddingModel;
  const vectorByHash = new Map<string, string>();
  if (sameModel) for (const c of prev!.chunks) vectorByHash.set(c.hash, c.vector);

  const ordered = [...drafts.keys()].sort((a, b) => a - b).flatMap((id) => drafts.get(id)!);
  const hashed = ordered.map((d) => ({ ...d, hash: sha256(d.embedText) }));
  const missing = hashed.filter((c) => !vectorByHash.has(c.hash));
  deps.log(`embed ${missing.length} / ${hashed.length} chunks`);

  let dimensions = sameModel ? prev!.dimensions : 0;
  for (let i = 0; i < missing.length; i += EMBED_BATCH) {
    const batch = missing.slice(i, i + EMBED_BATCH);
    const vectors = await deps.embed(batch.map((c) => c.embedText));
    batch.forEach((c, j) => {
      const v = vectors[j]!;
      dimensions = v.length;
      vectorByHash.set(c.hash, encodeVector(v));
    });
  }

  const chunks: Chunk[] = hashed.map((c) => ({ ...c, vector: vectorByHash.get(c.hash)! }));
  return {
    version: 1,
    embeddingModel: deps.embeddingModel,
    dimensions,
    builtAt: deps.now().toISOString(),
    posts: [...posts.values()].sort((a, b) => a.id - b.id),
    chunks,
  };
}

export function sameContent(a: BlogIndex | null, b: BlogIndex): boolean {
  if (!a) return false;
  return JSON.stringify({ ...a, builtAt: "" }) === JSON.stringify({ ...b, builtAt: "" });
}
