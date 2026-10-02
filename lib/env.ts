import { z } from "zod";

export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

const list = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY가 필요합니다."),
  PAID_MODEL: z.string().min(1, "PAID_MODEL이 필요합니다."),
  /** 인덱스를 못 읽었을 때만 쓰는 대비값. 질문 임베딩은 인덱스의 embeddingModel을 따른다. */
  EMBEDDING_MODEL: z.string().min(1).optional(),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

export type AppEnv = z.infer<typeof schema> & { FREE_MODELS: string[]; allowedOrigins: string[] };

export function readEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = schema.parse(env);
  const allowedOrigins = [new URL(parsed.APP_ORIGIN).origin];
  if (env.VERCEL_URL) allowedOrigins.push(new URL(`https://${env.VERCEL_URL}`).origin);
  if (env.VERCEL_BRANCH_URL) allowedOrigins.push(new URL(`https://${env.VERCEL_BRANCH_URL}`).origin);
  return { ...parsed, FREE_MODELS: list(env.FREE_MODELS), allowedOrigins };
}

/** 질문 임베딩 모델: 인덱스를 만든 모델이 우선이고, 인덱스가 없을 때만 환경변수와 기본값을 쓴다. */
export function pickEmbeddingModel(
  indexModel: string | undefined,
  envModel: string | undefined,
): { model: string; mismatch: { env: string; index: string } | null } {
  if (!indexModel) return { model: envModel || DEFAULT_EMBEDDING_MODEL, mismatch: null };
  return { model: indexModel, mismatch: envModel && envModel !== indexModel ? { env: envModel, index: indexModel } : null };
}
