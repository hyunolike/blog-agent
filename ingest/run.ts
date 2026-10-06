import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { BLOG_ORIGIN } from "@/lib/config";
import { DEFAULT_EMBEDDING_MODEL } from "@/lib/env";
import { createProvider } from "@/lib/provider";
import type { BlogIndex } from "@/lib/types";
import { buildIndex, sameContent } from "./build";

const INDEX_PATH = "data/index.json";
const USER_AGENT = "blog-agent (+https://github.com/hyunolike/blog-agent)";

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

async function main() {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NVIDIA_API_KEY가 필요합니다.");
  const embeddingModel = process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const provider = createProvider(apiKey);

  const prev: BlogIndex | null = existsSync(INDEX_PATH) ? JSON.parse(readFileSync(INDEX_PATH, "utf8")) : null;

  const next = await buildIndex(prev, {
    fetchSitemap: () => get(`${BLOG_ORIGIN}/sitemap.xml`),
    fetchHtml: get,
    embed: (texts) => provider.embed(embeddingModel, texts, "passage"),
    embeddingModel,
    now: () => new Date(),
    sleep: (ms) => sleep(ms),
    log: (msg) => console.log(`[ingest] ${msg}`),
  });

  const changed = !sameContent(prev, next);
  if (changed) {
    mkdirSync("data", { recursive: true });
    writeFileSync(INDEX_PATH, `${JSON.stringify(next)}\n`);
  }
  console.log(`[ingest] posts ${next.posts.length}, chunks ${next.chunks.length}, changed ${changed}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
