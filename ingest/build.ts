import { createHash } from "node:crypto";
import { EmbedRejectedError } from "@/lib/provider";
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
  /** 글 번호 → 프로젝트 설명. 글 본문에 없는 소속 정보(동아리 이름 등)를 검색에 보탠다. */
  projects?: Record<number, string>;
};

const EMBED_BATCH = 64;
const FETCH_DELAY_MS = 1000;

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const PROJECT_LINE = /^프로젝트: [^\n]*\n/;

/** 이전 실행에서 붙인 프로젝트 줄을 떼고, 지금 태그가 있으면 다시 붙인다. 여러 번 돌려도 줄이 쌓이지 않는다. */
function withProject(draft: ChunkDraft, project: string | undefined): ChunkDraft {
  const line = project ? `프로젝트: ${project}\n` : "";
  return {
    ...draft,
    text: line + draft.text.replace(PROJECT_LINE, ""),
    embedText: line + draft.embedText.replace(PROJECT_LINE, ""),
  };
}

const CODE_BLOCK = /```[\s\S]*?```/g;

/**
 * 안전 필터가 배치를 거부하면 한 조각씩 다시 보내 거부된 조각만 골라낸다.
 * 거부된 조각은 코드 블록을 빼고 한 번 더 시도한다(오탐은 대부분 HTML, JS 코드에서 난다). 그래도 거부되면 null.
 */
async function embedTolerant(embed: BuildDeps["embed"], texts: string[]): Promise<(number[] | null)[]> {
  try {
    return await embed(texts);
  } catch (err) {
    if (!(err instanceof EmbedRejectedError)) throw err;
  }
  const out: (number[] | null)[] = [];
  for (const text of texts) {
    out.push(await embedOne(embed, text));
  }
  return out;
}

async function embedOne(embed: BuildDeps["embed"], text: string): Promise<number[] | null> {
  // 코드를 빼도 같은 텍스트면 한 번만 보낸다
  for (const attempt of new Set([text, text.replace(CODE_BLOCK, "(코드 생략)")])) {
    try {
      return (await embed([attempt]))[0]!;
    } catch (err) {
      if (!(err instanceof EmbedRejectedError)) throw err;
    }
  }
  return null;
}

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
  // 빈 벡터(이전 실행에서 거부된 조각)는 캐시하지 않고 다시 시도한다
  if (sameModel) for (const c of prev!.chunks) if (c.vector) vectorByHash.set(c.hash, c.vector);

  const ordered = [...drafts.keys()]
    .sort((a, b) => a - b)
    .flatMap((id) => drafts.get(id)!.map((d) => withProject(d, deps.projects?.[id])));
  const hashed = ordered.map((d) => ({ ...d, hash: sha256(d.embedText) }));
  const missing = hashed.filter((c) => !vectorByHash.has(c.hash));
  deps.log(`embed ${missing.length} / ${hashed.length} chunks`);

  let dimensions = sameModel ? prev!.dimensions : 0;
  const rejected: string[] = [];
  for (let i = 0; i < missing.length; i += EMBED_BATCH) {
    const batch = missing.slice(i, i + EMBED_BATCH);
    const vectors = await embedTolerant(deps.embed, batch.map((c) => c.embedText));
    batch.forEach((c, j) => {
      const v = vectors[j];
      if (!v) return void rejected.push(c.id);
      dimensions = v.length;
      vectorByHash.set(c.hash, encodeVector(v));
    });
  }
  if (rejected.length > 0) deps.log(`embed rejected ${rejected.length} chunks (키워드 검색만 적용): ${rejected.join(",")}`);

  // 거부된 조각은 빈 벡터로 둔다
  const chunks: Chunk[] = hashed.map((c) => ({ ...c, vector: vectorByHash.get(c.hash) ?? "" }));
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
