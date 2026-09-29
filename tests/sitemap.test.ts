import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSitemap, planUpdate } from "@/ingest/sitemap";
import type { Post } from "@/lib/types";

const post = (id: number, modifiedAt: string): Post => ({
  id,
  url: `https://hyunolike.tistory.com/${id}`,
  title: `글 ${id}`,
  prefix: [],
  category: "BE",
  summary: "",
  publishedAt: modifiedAt,
  modifiedAt,
});

describe("parseSitemap", () => {
  it("keeps only numbered post urls, sorted by id", () => {
    const entries = parseSitemap(readFileSync("tests/fixtures/sitemap.xml", "utf8"));
    expect(entries).toEqual([
      { id: 9, url: "https://hyunolike.tistory.com/9", lastmod: "2025-10-01T09:00:00+09:00" },
      { id: 65, url: "https://hyunolike.tistory.com/65", lastmod: "2026-08-20T10:00:00+09:00" },
      { id: 70, url: "https://hyunolike.tistory.com/70", lastmod: "2026-09-17T23:14:22+09:00" },
    ]);
  });
});

describe("planUpdate", () => {
  const entries = parseSitemap(readFileSync("tests/fixtures/sitemap.xml", "utf8"));

  it("fetches everything on the first run", () => {
    expect(planUpdate([], entries).fetch.map((e) => e.id)).toEqual([9, 65, 70]);
  });

  it("fetches new or modified posts, keeps unchanged ones, removes vanished ones", () => {
    const prev = [
      post(9, "2025-10-01T09:00:00+09:00"), // 같음
      post(65, "2026-08-01T10:00:00+09:00"), // 수정됨
      post(3, "2025-01-01T00:00:00+09:00"), // sitemap에서 사라짐
    ];
    const plan = planUpdate(prev, entries);
    expect(plan.fetch.map((e) => e.id)).toEqual([65, 70]);
    expect(plan.keep).toEqual([9]);
    expect(plan.removed).toEqual([3]);
  });

  it("treats the same instant in a different timezone notation as unchanged", () => {
    const plan = planUpdate([post(9, "2025-10-01T00:00:00Z")], entries);
    expect(plan.keep).toEqual([9]);
  });
});
