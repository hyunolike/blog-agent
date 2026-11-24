import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { readEnv } from "../env";
import { sharedFeedbackStore } from "../feedback-deps";
import { loadIndex } from "../index-store";
import { readAdminEnv, type AdminEnv } from "./auth";
import type { PostInfo, ReviewDeps } from "./reviews";

export type AdminContext = { kind: "ok"; env: AdminEnv; deps: ReviewDeps } | { kind: "not_found" } | { kind: "unavailable" };

let evalIdsCache: Set<string> | undefined;

function deployedEvalIds(): Set<string> {
  if (evalIdsCache) return evalIdsCache;
  try {
    const text = readFileSync(join(process.cwd(), "eval", "questions.jsonl"), "utf8");
    evalIdsCache = new Set(text.split("\n").filter((l) => l.trim()).map((l) => (JSON.parse(l) as { id: string }).id));
  } catch (err) {
    console.error(JSON.stringify({ event: "eval_ids_load_failed", error: err instanceof Error ? err.message : String(err) }));
    evalIdsCache = new Set();
  }
  return evalIdsCache;
}

function deployedPosts(): PostInfo[] | null {
  const loaded = loadIndex();
  return loaded ? loaded.index.posts.map((p) => ({ id: p.id, title: p.title, url: p.url })) : null;
}

/** 관리자 경로 공통 준비. 설정이 없으면 404, Vercel에서 Redis가 없으면 503 */
export function adminContext(): AdminContext {
  const env = readAdminEnv();
  if (!env) return { kind: "not_found" };
  let app;
  try {
    app = readEnv();
  } catch {
    return { kind: "unavailable" };
  }
  const hasRedis = Boolean(app.UPSTASH_REDIS_REST_URL && app.UPSTASH_REDIS_REST_TOKEN);
  // 인스턴스마다 따로인 메모리 저장소에 검토 결과를 쓰면 사라진다
  if (!hasRedis && process.env.VERCEL_ENV) return { kind: "unavailable" };
  const redis = hasRedis ? new Redis({ url: app.UPSTASH_REDIS_REST_URL!, token: app.UPSTASH_REDIS_REST_TOKEN! }) : null;
  return {
    kind: "ok",
    env,
    deps: {
      env,
      store: sharedFeedbackStore(redis),
      allowedOrigins: app.allowedOrigins,
      posts: deployedPosts,
      evalIds: deployedEvalIds,
      log: (entry) => console.log(JSON.stringify(entry)),
    },
  };
}

export const notFound = () => Response.json({ error: "not_found" }, { status: 404 });
export const unavailable = () => Response.json({ error: "unavailable" }, { status: 503 });
