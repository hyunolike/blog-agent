import type { Chunk } from "@/lib/types";
import type { ExtractedPost } from "./extract";

export type ChunkDraft = Omit<Chunk, "hash" | "vector">;

export const CHUNK_LIMITS = { max: 1200, overlap: 150, longCode: 1500, codeHeadLines: 20, minSection: 300 };

type Block = { kind: "heading"; level: number; text: string } | { kind: "code"; text: string } | { kind: "prose"; text: string };
type BodyBlock = Exclude<Block, { kind: "heading" }>;

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
function packSection(blocks: BodyBlock[]): { text: string; embedBody: string }[] {
  const out: { text: string; embedBody: string; proseTail: string | null }[] = [];
  let parts: BodyBlock[] = [];
  let size = 0;

  const flush = () => {
    if (parts.length === 0) return;
    // 겹침은 앞 조각의 마지막 문단에서만 가져온다. 마지막이 코드면 겹침 없음(펜스가 잘려 들어오지 않게).
    const tail = out[out.length - 1]?.proseTail;
    const overlap = tail ? `…${tail.slice(-CHUNK_LIMITS.overlap)}\n\n` : "";
    const text = overlap + parts.map((p) => p.text).join("\n\n");
    const embedBody = parts.map((p) => (p.kind === "code" ? shortenCode(p.text) : p.text)).join("\n\n");
    const last = parts[parts.length - 1]!;
    out.push({ text, embedBody, proseTail: last.kind === "prose" ? last.text : null });
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
  return out.map(({ text, embedBody }) => ({ text, embedBody }));
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

type Section = {
  headingPath: string[];
  /** 원래 절의 headingPath에서 마지막 제목을 뺀 것. 같은 값이면 형제 절이다. */
  parent: string[];
  /** headingPath의 마지막 제목. 합칠 때 더 깊은 절의 제목은 본문 앞에 제목 줄로 남긴다. 머리말 절은 null. */
  heading: { level: number; text: string } | null;
  blocks: BodyBlock[];
};

const samePath = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const isUnder = (path: string[], ancestor: string[]) =>
  path.length > ancestor.length && ancestor.every((x, i) => x === path[i]);
const textLength = (blocks: BodyBlock[]) => blocks.reduce((n, b) => n + b.text.length + 2, -2);
/** packSection이 한 조각으로 묶을 수 있는 크기인지(구분자 포함) */
const fitsOneChunk = (blocks: BodyBlock[]) => textLength(blocks) + 2 <= CHUNK_LIMITS.max;

function commonPrefix(a: string[], b: string[]): string[] {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

/** 바로 다음 절이 형제이거나 자식이면 합칠 수 있다. */
const canMerge = (a: Section, b: Section) => samePath(a.parent, b.parent) || isUnder(b.headingPath, a.headingPath);

function labelled(s: Section, mergedPath: string[]): BodyBlock[] {
  if (!s.heading || s.headingPath.length <= mergedPath.length) return s.blocks;
  return [{ kind: "prose", text: `${"#".repeat(s.heading.level)} ${s.heading.text}` }, ...s.blocks];
}

function mergeSections(a: Section, b: Section): Section {
  const headingPath = commonPrefix(a.headingPath, b.headingPath);
  return {
    headingPath,
    parent: a.parent,
    heading: samePath(headingPath, a.headingPath) ? a.heading : null,
    blocks: [...labelled(a, headingPath), ...labelled(b, headingPath)],
  };
}

/**
 * 너무 짧은 절을 바로 다음 형제(또는 자식) 절과 합치고, 다음이 없거나 넘치면 바로 앞 절과 합친다.
 * 합친 절의 headingPath는 공통 부모 경로다. 합친 결과는 max를 넘지 않는다.
 */
function mergeShortSections(sections: Section[]): Section[] {
  const out: Section[] = [];
  const isShort = (s: Section) => textLength(s.blocks) < CHUNK_LIMITS.minSection;
  for (let i = 0; i < sections.length; i++) {
    let cur = sections[i]!;
    while (isShort(cur)) {
      const next = sections[i + 1];
      if (!next || !canMerge(cur, next)) break;
      const merged = mergeSections(cur, next);
      if (!fitsOneChunk(merged.blocks)) break;
      cur = merged;
      i++;
    }
    const prev = out[out.length - 1];
    if (isShort(cur) && prev && canMerge(prev, cur)) {
      const merged = mergeSections(prev, cur);
      if (fitsOneChunk(merged.blocks)) {
        out[out.length - 1] = merged;
        continue;
      }
    }
    out.push(cur);
  }
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
  let section: BodyBlock[] = [];
  const sections: Section[] = [];

  const flushSection = () => {
    if (section.length > 0) {
      const headingPath = stack.map((h) => h.text);
      const top = stack[stack.length - 1];
      sections.push({ headingPath, parent: headingPath.slice(0, -1), heading: top ?? null, blocks: section });
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

  for (const { headingPath, blocks: sectionBlocks } of mergeShortSections(sections)) {
    for (const { text, embedBody } of packSection(sectionBlocks)) {
      chunks.push({
        id: `${post.id}-${chunks.length}`,
        postId: post.id,
        kind: "body",
        headingPath,
        text,
        embedText: `${[post.title, ...headingPath].join(" > ")}\n${embedBody}`,
      });
    }
  }
  return chunks;
}
