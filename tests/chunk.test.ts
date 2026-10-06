import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHUNK_LIMITS, chunkPost } from "@/ingest/chunk";
import { extractPost, type ExtractedPost } from "@/ingest/extract";

const make = (markdown: string): ExtractedPost => ({
  id: 7,
  url: "https://hyunolike.tistory.com/7",
  title: "테스트 글",
  prefix: ["BE"],
  category: "BE",
  summary: "요약 문장",
  publishedAt: "2026-01-01T00:00:00+09:00",
  modifiedAt: "2026-01-01T00:00:00+09:00",
  markdown,
});

const para = (ch: string, n: number) => ch.repeat(n);

describe("chunkPost", () => {
  it("starts with a summary chunk listing the table of contents", () => {
    const [summary] = chunkPost(make("## 배경\n\n본문\n\n## 결론\n\n끝"));
    expect(summary).toMatchObject({ id: "7-0", postId: 7, kind: "summary", headingPath: [] });
    expect(summary!.text).toContain("제목: 테스트 글");
    expect(summary!.text).toContain("카테고리: BE");
    expect(summary!.text).toContain("요약: 요약 문장");
    expect(summary!.text).toContain("- 배경\n- 결론");
  });

  it("tracks the heading path per section", () => {
    const long = (ch: string) => para(ch, CHUNK_LIMITS.minSection);
    const chunks = chunkPost(make(`## A\n\n${long("가")}\n\n### B\n\n${long("라")}\n\n## C\n\n${long("사")}`));
    const body = chunks.filter((c) => c.kind === "body");
    expect(body.map((c) => c.headingPath)).toEqual([["A"], ["A", "B"], ["C"]]);
    expect(body[1]!.embedText.startsWith("테스트 글 > A > B\n")).toBe(true);
  });

  it("splits long sections at paragraph boundaries with overlap", () => {
    const md = "## 긴 절\n\n" + Array.from({ length: 6 }, (_, i) => para(String(i), 400)).join("\n\n");
    const body = chunkPost(make(md)).filter((c) => c.kind === "body");
    expect(body.length).toBeGreaterThan(1);
    for (const c of body) expect(c.text.length).toBeLessThanOrEqual(CHUNK_LIMITS.max + CHUNK_LIMITS.overlap + 2);
    const tailOfFirst = body[0]!.text.slice(-CHUNK_LIMITS.overlap);
    expect(body[1]!.text.startsWith(`…${tailOfFirst}`)).toBe(true);
  });

  it("never splits a code block and shortens long code only in embedText", () => {
    const code = Array.from({ length: 120 }, (_, i) => `line_${i} = ${"x".repeat(20)}`).join("\n");
    const md = `## 설정\n\n설명 문단\n\n\`\`\`yaml\n${code}\n\`\`\``;
    const body = chunkPost(make(md)).filter((c) => c.kind === "body");
    const withCode = body.find((c) => c.text.includes("line_0 ="))!;
    expect(withCode.text).toContain("line_119 =");
    expect(withCode.embedText).toContain("line_19 =");
    expect(withCode.embedText).not.toContain("line_20 =");
    expect(withCode.embedText).toContain("(코드 100줄 생략)");
  });

  it("gives every chunk of a real post a unique id", () => {
    const post = extractPost(readFileSync("tests/fixtures/posts/70.html", "utf8"), "https://hyunolike.tistory.com/70");
    const chunks = chunkPost(post);
    expect(chunks.length).toBeGreaterThan(3);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
    expect(chunks.every((c) => c.text.trim().length > 0)).toBe(true);
  });

  it("merges short sections into the following sibling or child sections under the shared parent path", () => {
    const md = "## A\n\n" + para("가", 50) + "\n\n### B\n\n" + para("나", 50) + "\n\n### C\n\n" + para("다", 400);
    const body = chunkPost(make(md)).filter((c) => c.kind === "body");
    expect(CHUNK_LIMITS.minSection).toBe(300);
    expect(body.length).toBeLessThan(3);
    expect(body.filter((c) => c.text.length < CHUNK_LIMITS.minSection)).toEqual([]);
    expect(body).toHaveLength(1);
    expect(body[0]!.headingPath).toEqual(["A"]);
    expect(body[0]!.text).toBe([para("가", 50), "### B", para("나", 50), "### C", para("다", 400)].join("\n\n"));
  });

  it("merges a short section only with its next sibling when that is all it can reach", () => {
    const md = "## A\n\n" + para("가", 400) + "\n\n### B\n\n" + para("나", 50) + "\n\n### C\n\n" + para("다", 400);
    const body = chunkPost(make(md)).filter((c) => c.kind === "body");
    expect(body.map((c) => c.headingPath)).toEqual([["A"], ["A"]]);
    expect(body[1]!.text).toBe(["### B", para("나", 50), "### C", para("다", 400)].join("\n\n"));
  });

  it("merges a trailing short section into the previous sibling when there is no next one", () => {
    const md = "## A\n\n### B\n\n" + para("나", 400) + "\n\n### C\n\n" + para("다", 50);
    const body = chunkPost(make(md)).filter((c) => c.kind === "body");
    expect(body).toHaveLength(1);
    expect(body[0]!.headingPath).toEqual(["A"]);
    expect(body[0]!.text).toContain("나나나");
    expect(body[0]!.text).toContain("다다다");
  });

  it("does not merge when the result would exceed the max size", () => {
    const md = "## A\n\n### B\n\n" + para("나", 100) + "\n\n### C\n\n" + para("다", CHUNK_LIMITS.max);
    const body = chunkPost(make(md)).filter((c) => c.kind === "body");
    expect(body.map((c) => c.headingPath)).toEqual([["A", "B"], ["A", "C"]]);
  });

  it("keeps real post 70 chunks reasonably sized", () => {
    const post = extractPost(readFileSync("tests/fixtures/posts/70.html", "utf8"), "https://hyunolike.tistory.com/70");
    const lengths = chunkPost(post).filter((c) => c.kind === "body").map((c) => c.text.length).sort((a, b) => a - b);
    expect(lengths[0]).toBeGreaterThanOrEqual(120);
    expect(lengths[Math.floor(lengths.length / 2)]).toBeGreaterThan(400);
  });

  it("never takes overlap from code, so no chunk has an unbalanced fence", () => {
    const code = Array.from({ length: 30 }, (_, i) => `line_${i} = ${"x".repeat(20)}`).join("\n");
    const md = `## 절\n\n${para("가", 300)}\n\n\`\`\`ts\n${code}\n\`\`\`\n\n${para("나", 50)}\n\n${para("다", 1100)}`;
    const body = chunkPost(make(md)).filter((c) => c.kind === "body");
    expect(body.length).toBeGreaterThan(1);
    for (const c of body) expect((c.text.match(/^```/gm) ?? []).length % 2).toBe(0);
  });

  it("splits a single paragraph longer than the max", () => {
    const sentences = Array.from({ length: 60 }, (_, i) => `문장 ${i}번은 충분히 길게 써서 나눠야 한다.`).join(" ");
    const body = chunkPost(make(`## 긴 문단\n\n${sentences}`)).filter((c) => c.kind === "body");
    expect(sentences.length).toBeGreaterThan(CHUNK_LIMITS.max);
    expect(body.length).toBeGreaterThan(1);
    for (const c of body) expect(c.text.length).toBeLessThanOrEqual(CHUNK_LIMITS.max + CHUNK_LIMITS.overlap + 2);
  });
});
