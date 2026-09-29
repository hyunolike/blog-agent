import { embed } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createFallbackModel, type ModelUsed } from "./fallback-model";
import type { FlagStore } from "./flags";
import type { AppEnv } from "./env";

export const FIRST_TOKEN_TIMEOUT_MS = 8000;

/** 모델 제공자(OpenRouter)를 아는 유일한 파일. 제공자를 바꾸려면 여기만 고친다. */
export function createLlm(env: AppEnv, flags: FlagStore) {
  const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
  const [firstFree] = env.FREE_MODELS;
  const free = firstFree ? openrouter.chat(firstFree, { extraBody: { models: env.FREE_MODELS } }) : null;
  const paid = openrouter.chat(env.PAID_MODEL);
  const embeddingModel = openrouter.textEmbeddingModel(env.EMBEDDING_MODEL);

  return {
    async embedQuery(text: string): Promise<number[]> {
      const { embedding } = await embed({ model: embeddingModel, value: text, maxRetries: 0 });
      return embedding;
    },
    createModel(onUsed: (u: ModelUsed) => void) {
      return createFallbackModel({
        primary: free,
        fallback: paid,
        firstTokenTimeoutMs: FIRST_TOKEN_TIMEOUT_MS,
        skipPrimary: () => flags.isFreeExhausted(),
        onPrimaryRateLimited: (resetAt) => flags.markFreeExhausted(resetAt),
        onModelUsed: onUsed,
      });
    },
  };
}
