import { Redis } from "@upstash/redis";
import { handleChat, type ChatDeps } from "@/lib/chat-handler";
import { pickEmbeddingModel, readEnv } from "@/lib/env";
import { createMemoryFlags, createRedisFlags } from "@/lib/flags";
import { loadIndex } from "@/lib/index-store";
import { createMemoryLimiters, createUpstashLimiters } from "@/lib/limits";
import { createLlm } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 30;

let deps: ChatDeps | undefined;

function getDeps(): ChatDeps {
  if (deps) return deps;
  const env = readEnv();
  const redis =
    env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
      ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
      : null;
  if (!redis) console.warn("[chat] UPSTASH 설정이 없어 메모리 요청 제한을 씁니다. 운영에서는 반드시 설정하세요.");
  const loaded = loadIndex();
  const embedding = pickEmbeddingModel(loaded?.index.embeddingModel, env.EMBEDDING_MODEL);
  if (embedding.mismatch) console.warn(JSON.stringify({ event: "embedding_model_mismatch", ...embedding.mismatch }));
  const llm = createLlm(env, redis ? createRedisFlags(redis) : createMemoryFlags(), embedding.model);
  deps = {
    searcher: loaded?.searcher ?? null,
    embedQuery: llm.embedQuery,
    createModel: llm.createModel,
    limits: redis ? createUpstashLimiters(redis) : createMemoryLimiters(),
    allowedOrigins: env.allowedOrigins,
    log: (entry) => console.log(JSON.stringify(entry)),
  };
  return deps;
}

export async function POST(req: Request) {
  return handleChat(req, getDeps());
}
