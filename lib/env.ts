import { z } from "zod";

const list = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY가 필요합니다."),
  PAID_MODEL: z.string().min(1, "PAID_MODEL이 필요합니다."),
  EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

export type AppEnv = z.infer<typeof schema> & { FREE_MODELS: string[]; allowedOrigins: string[] };

export function readEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = schema.parse(env);
  const allowedOrigins = [parsed.APP_ORIGIN];
  if (env.VERCEL_URL) allowedOrigins.push(`https://${env.VERCEL_URL}`);
  if (env.VERCEL_BRANCH_URL) allowedOrigins.push(`https://${env.VERCEL_BRANCH_URL}`);
  return { ...parsed, FREE_MODELS: list(env.FREE_MODELS), allowedOrigins };
}
