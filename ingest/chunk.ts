import type { Chunk } from "@/lib/types";
import type { ExtractedPost } from "./extract";

export type ChunkDraft = Omit<Chunk, "hash" | "vector">;

export const CHUNK_LIMITS = { max: 1200, overlap: 150, longCode: 1500, codeHeadLines: 20 };

type Block = { kind: "heading"; level: number; text: string } | { kind: "code"; text: string } | { kind: "prose"; text: string };

function toBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split("\n");
  let buf: string[] = [];
  let fence: string | null = null;

  const flushProse = () => {
    const text = buf.join("\n").trim();
    if (text) blocks.push({ kind: "prose", text });
    buf = [];
  };

  for (const line of lines) {
    if (fence) {
      buf.push(line);
      if (line.trim() === fence) {
        blocks.push({ kind: "code", text: buf.join("\n") });
        buf = [];
        fence = null;
      }
      continue;
    }
    const open = line.match(/^(`{3,})/);
    if (open) {
      flushProse();
      fence = open[1]!;
      buf.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushProse();
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]!.trim() });
      continue;
    }
    if (line.trim() === "") flushProse();
    else buf.push(line);
  }
  if (fence) blocks.push({ kind: "code", text: buf.join("\n") });
  else flushProse();
  return blocks;
}

function shortenCode(code: string): string {
  if (code.length <= CHUNK_LIMITS.longCode) return code;
  const lines = code.split("\n");
  const fenceOpen = lines[0]!;
  const fenceClose = lines[lines.length - 1]!;
  const inner = lines.slice(1, -1);
  const head = inner.slice(0, CHUNK_LIMITS.codeHeadLines);
  const omitted = inner.length - head.length;
  return [fenceOpen, ...head, `(코드 ${omitted}줄 생략)`, fenceClose].join("\n");
}

/** 한 절의 블록들을 max 이하 조각으로 묶는다. 코드 블록은 쪼개지 않는다. */
function packSection(blocks: Exclude<Block, { kind: "heading" }>[]): { text: string; embedBody: string }[] {
  const out: { text: string; embedBody: string }[] = [];
  let parts: typeof blocks = [];
  let size = 0;

  const flush = () => {
    if (parts.length === 0) return;
    const prev = out[out.length - 1];
    const lastPrevProse = prev && !prev.text.trimEnd().endsWith("```");
    const overlap = lastPrevProse ? `…${prev.text.slice(-CHUNK_LIMITS.overlap)}\n\n` : "";
    const text = overlap + parts.map((p) => p.text).join("\n\n");
    const embedBody = parts.map((p) => (p.kind === "code" ? shortenCode(p.text) : p.text)).join("\n\n");
    out.push({ text, embedBody });
    parts = [];
    size = 0;
  };

  for (const block of blocks) {
    const pieces =
      block.kind === "prose" && block.text.length > CHUNK_LIMITS.max ? splitLongProse(block.text) : [block];
    for (const piece of pieces) {
      if (size > 0 && size + piece.text.length > CHUNK_LIMITS.max) flush();
      parts.push(piece);
      size += piece.text.length + 2;
    }
  }
  flush();
  return out;
}

function splitLongProse(text: string): { kind: "prose"; text: string }[] {
  const sentences = text.split(/(?<=[.!?。]|다\.|요\.)\s+/);
  const out: { kind: "prose"; text: string }[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > CHUNK_LIMITS.max) {
      out.push({ kind: "prose", text: cur });
      cur = "";
    }
    if (s.length > CHUNK_LIMITS.max) {
      for (let i = 0; i < s.length; i += CHUNK_LIMITS.max) out.push({ kind: "prose", text: s.slice(i, i + CHUNK_LIMITS.max) });
      continue;
    }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push({ kind: "prose", text: cur });
  return out;
}

export function chunkPost(post: ExtractedPost): ChunkDraft[] {
  const blocks = toBlocks(post.markdown);
  const toc = blocks.filter((b): b is Extract<Block, { kind: "heading" }> => b.kind === "heading" && b.level === 2);

  const summaryText = [
    `제목: ${post.title}`,
    `카테고리: ${post.category}`,
    `요약: ${post.summary}`,
    ...(toc.length ? ["목차:", ...toc.map((h) => `- ${h.text}`)] : []),
  ].join("\n");

  const chunks: ChunkDraft[] = [
    { id: `${post.id}-0`, postId: post.id, kind: "summary", headingPath: [], text: summaryText, embedText: summaryText },
  ];

  let stack: { level: number; text: string }[] = [];
  let section: Exclude<Block, { kind: "heading" }>[] = [];

  const flushSection = () => {
    const headingPath = stack.map((h) => h.text);
    for (const { text, embedBody } of packSection(section)) {
      chunks.push({
        id: `${post.id}-${chunks.length}`,
        postId: post.id,
        kind: "body",
        headingPath,
        text,
        embedText: `${[post.title, ...headingPath].join(" > ")}\n${embedBody}`,
      });
    }
    section = [];
  };

  for (const block of blocks) {
    if (block.kind === "heading") {
      flushSection();
      stack = [...stack.filter((h) => h.level < block.level), { level: block.level, text: block.text }];
    } else {
      section.push(block);
    }
  }
  flushSection();
  return chunks;
}
