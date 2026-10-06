import { z } from "zod";

export const DEFAULT_EMBEDDING_MODEL = "nvidia/llama-3.2-nv-embedqa-1b-v1";

const list = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const schema = z.object({
  NVIDIA_API_KEY: z.string().min(1, "NVIDIA_API_KEY가 필요합니다."),
  /** 인덱스를 못 읽었을 때만 쓰는 대비값. 질문 임베딩은 인덱스의 embeddingModel을 따른다. */
  EMBEDDING_MODEL: z.string().min(1).optional(),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

/** CHAT_MODELS: 쉼표로 구분한 답변 모델. 첫 번째가 기본이고, 두 번째가 있으면 첫 번째가 실패하거나 늦을 때 넘겨받는다. */
export type AppEnv = z.infer<typeof schema> & { CHAT_MODELS: string[]; allowedOrigins: string[] };

export function readEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = schema.parse(env);
  const allowedOrigins = [new URL(parsed.APP_ORIGIN).origin];
  if (env.VERCEL_URL) allowedOrigins.push(new URL(`https://${env.VERCEL_URL}`).origin);
  if (env.VERCEL_BRANCH_URL) allowedOrigins.push(new URL(`https://${env.VERCEL_BRANCH_URL}`).origin);
  const CHAT_MODELS = list(env.CHAT_MODELS);
  if (CHAT_MODELS.length === 0) throw new Error("CHAT_MODELS에 답변 모델을 하나 이상 넣어야 합니다.");
  return { ...parsed, CHAT_MODELS, allowedOrigins };
}

/** 질문 임베딩 모델: 인덱스를 만든 모델이 우선이고, 인덱스가 없을 때만 환경변수와 기본값을 쓴다. */
export function pickEmbeddingModel(
  indexModel: string | undefined,
  envModel: string | undefined,
): { model: string; mismatch: { env: string; index: string } | null } {
  if (!indexModel) return { model: envModel || DEFAULT_EMBEDDING_MODEL, mismatch: null };
  return { model: indexModel, mismatch: envModel && envModel !== indexModel ? { env: envModel, index: indexModel } : null };
}
