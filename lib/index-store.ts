import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSearcher, type Searcher } from "./retrieval";
import type { BlogIndex } from "./types";

let cached: { index: BlogIndex; searcher: Searcher } | null | undefined;

export function loadIndex(): { index: BlogIndex; searcher: Searcher } | null {
  if (cached !== undefined) return cached;
  try {
    const index = JSON.parse(readFileSync(join(process.cwd(), "data", "index.json"), "utf8")) as BlogIndex;
    if (index.version !== 1 || !Array.isArray(index.chunks)) throw new Error("index.json 형식이 올바르지 않습니다.");
    cached = { index, searcher: createSearcher(index) };
  } catch (err) {
    console.error(JSON.stringify({ event: "index_load_failed", error: err instanceof Error ? err.message : String(err) }));
    cached = null;
  }
  return cached;
}
