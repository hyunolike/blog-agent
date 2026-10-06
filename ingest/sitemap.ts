import { BLOG_ORIGIN } from "@/lib/config";
import type { Post } from "@/lib/types";

export type SitemapEntry = { id: number; url: string; lastmod: string };

// sitemap은 글마다 PC(/{id})와 모바일(/m/{id}) URL을 모두 싣는다. PC URL만 써서 중복을 막는다
const POST_URL = new RegExp(`^${BLOG_ORIGIN.replace(/\./g, "\\.")}/(\\d+)$`);

export function parseSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/g) ?? []) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim();
    const m = loc?.match(POST_URL);
    if (!loc || !m || !lastmod) continue;
    entries.push({ id: Number(m[1]), url: loc, lastmod });
  }
  return entries.sort((a, b) => a.id - b.id);
}

export function planUpdate(prev: Post[], entries: SitemapEntry[]) {
  const prevById = new Map(prev.map((p) => [p.id, p]));
  const fetch: SitemapEntry[] = [];
  const keep: number[] = [];
  for (const e of entries) {
    const old = prevById.get(e.id);
    if (old && Date.parse(old.modifiedAt) === Date.parse(e.lastmod)) keep.push(e.id);
    else fetch.push(e);
  }
  const live = new Set(entries.map((e) => e.id));
  const removed = prev.filter((p) => !live.has(p.id)).map((p) => p.id).sort((a, b) => a - b);
  return { fetch, keep, removed };
}
