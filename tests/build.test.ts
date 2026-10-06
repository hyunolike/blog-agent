import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildIndex, sameContent, type BuildDeps } from "@/ingest/build";

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
