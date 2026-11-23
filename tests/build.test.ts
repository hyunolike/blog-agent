import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildIndex, sameContent, type BuildDeps } from "@/ingest/build";
import { EmbedRejectedError } from "@/lib/provider";

const html70 = readFileSync("tests/fixtures/posts/70.html", "utf8");
const html1 = readFileSync("tests/fixtures/posts/1.html", "utf8");

const sitemap = (entries: [number, string][]) =>
  `<urlset>${entries
    .map(([id, lastmod]) => `<url><loc>https://hyunolike.tistory.com/${id}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join("")}</urlset>`;

function deps(over: Partial<BuildDeps> & { xml: string }): BuildDeps & { embed: ReturnType<typeof vi.fn> } {
  const embed = vi.fn(async (texts: string[]) => texts.map((t) => [t.length, 1, 0]));
  return {
    fetchSitemap: async () => over.xml,
    fetchHtml: async (url: string) => (url.endsWith("/70") ? html70 : html1),
    embed,
    embeddingModel: "test/embed-a",
    now: () => new Date("2026-09-29T00:00:00Z"),
    sleep: async () => {},
    log: () => {},
    ...over,
  } as unknown as BuildDeps & { embed: ReturnType<typeof vi.fn> };
}

describe("buildIndex", () => {
  it("builds posts and embedded chunks on the first run", async () => {
    const d = deps({ xml: sitemap([[70, "2026-09-17T23:14:22+09:00"], [1, "2025-09-10T20:39:57+09:00"]]) });
    const index = await buildIndex(null, d);
    expect(index.posts.map((p) => p.id)).toEqual([1, 70]);
    expect(index.embeddingModel).toBe("test/embed-a");
    expect(index.dimensions).toBe(3);
    expect(index.chunks.every((c) => c.vector.length > 0 && c.hash.length === 64)).toBe(true);
  });

  it("reuses vectors of unchanged chunks and drops removed posts", async () => {
    const first = await buildIndex(null, deps({ xml: sitemap([[70, "2026-09-17T23:14:22+09:00"], [1, "2025-09-10T20:39:57+09:00"]]) }));
    const d = deps({ xml: sitemap([[70, "2026-09-17T23:14:22+09:00"]]) });
    const second = await buildIndex(first, d);
    expect(second.posts.map((p) => p.id)).toEqual([70]);
    expect(d.embed).not.toHaveBeenCalled();
    expect(second.chunks).toEqual(first.chunks.filter((c) => c.postId === 70));
  });

  it("re-embeds everything when the embedding model changes", async () => {
    const xml = sitemap([[70, "2026-09-17T23:14:22+09:00"]]);
    const first = await buildIndex(null, deps({ xml }));
    const d = deps({ xml, embeddingModel: "test/embed-b" });
    await buildIndex(first, d);
    expect(d.embed).toHaveBeenCalled();
  });

  it("prefixes chunks of tagged posts with their project context and re-embeds only those", async () => {
    const xml = sitemap([[70, "2026-09-17T23:14:22+09:00"], [1, "2025-09-10T20:39:57+09:00"]]);
    const first = await buildIndex(null, deps({ xml }));
    const d = deps({ xml, projects: { 70: "모여락 (DND 14기 IT 동아리 팀 프로젝트)" } });
    const second = await buildIndex(first, d);

    const tagged = second.chunks.filter((c) => c.postId === 70);
    expect(tagged.every((c) => c.text.startsWith("프로젝트: 모여락 (DND 14기 IT 동아리 팀 프로젝트)\n"))).toBe(true);
    expect(tagged.every((c) => c.embedText.startsWith("프로젝트: 모여락"))).toBe(true);
    expect(second.chunks.filter((c) => c.postId === 1)).toEqual(first.chunks.filter((c) => c.postId === 1));
    expect(d.embed.mock.calls.flat(2)).toHaveLength(tagged.length);
  });

  it("does not stack project lines across runs and drops them when the tag is removed", async () => {
    const xml = sitemap([[70, "2026-09-17T23:14:22+09:00"]]);
    const plain = await buildIndex(null, deps({ xml }));
    const projects = { 70: "모여락" };
    const once = await buildIndex(plain, deps({ xml, projects }));
    const twice = await buildIndex(once, deps({ xml, projects }));
    expect(twice.chunks).toEqual(once.chunks);
    const removed = await buildIndex(twice, deps({ xml }));
    expect(removed.chunks).toEqual(plain.chunks);
  });

  it("isolates chunks rejected by the safety filter, retries them without code, and leaves the rest embedded", async () => {
    const xml = sitemap([[70, "2026-09-17T23:14:22+09:00"]]);
    const plain = await buildIndex(null, deps({ xml }));
    const withCode = plain.chunks.find((c) => c.embedText.includes("```"))!;
    const target = plain.chunks.find((c) => c.kind === "summary")!;
    // 코드가 든 조각은 코드를 빼면 통과하고, 요약 조각은 어떻게 보내도 거부된다
    const embed = vi.fn(async (texts: string[]) => {
      if (texts.some((t) => t === target.embedText || t === withCode.embedText)) throw new EmbedRejectedError("422");
      return texts.map((t) => [t.length, 1, 0]);
    });
    const logs: string[] = [];
    const index = await buildIndex(null, deps({ xml, embed, log: (m) => logs.push(m) }));

    expect(index.chunks.find((c) => c.id === target.id)!.vector).toBe("");
    expect(index.chunks.find((c) => c.id === withCode.id)!.vector).not.toBe("");
    expect(index.chunks.filter((c) => c.vector === "").length).toBe(1);
    expect(index.dimensions).toBe(3);
    expect(logs.some((m) => m.includes(`embed rejected 1 chunks`) && m.includes(target.id))).toBe(true);

    // 거부된 조각은 캐시하지 않아 다음 실행에서 그 조각만 다시 시도한다
    const retry = vi.fn(async (texts: string[]) => texts.map((t) => [t.length, 1, 0]));
    const next = await buildIndex(index, deps({ xml, embed: retry }));
    expect(retry.mock.calls.flatMap((c) => c[0])).toEqual([target.embedText]);
    expect(next.chunks.every((c) => c.vector !== "")).toBe(true);
  });

  it("does not swallow embedding errors other than safety rejections", async () => {
    const embed = vi.fn(async () => {
      throw new Error("임베딩 요청 실패: 410 Gone");
    });
    await expect(buildIndex(null, deps({ xml: sitemap([[70, "2026-09-17T23:14:22+09:00"]]), embed }))).rejects.toThrow("410");
  });

  it("refuses to build from an empty sitemap", async () => {
    await expect(buildIndex(null, deps({ xml: "<urlset></urlset>" }))).rejects.toThrow("sitemap");
  });
});

describe("sameContent", () => {
  it("ignores builtAt", async () => {
    const xml = sitemap([[70, "2026-09-17T23:14:22+09:00"]]);
    const a = await buildIndex(null, deps({ xml }));
    const b = { ...a, builtAt: "2030-01-01T00:00:00.000Z" };
    expect(sameContent(a, b)).toBe(true);
    expect(sameContent(null, b)).toBe(false);
  });
});
