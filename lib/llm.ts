import { createFallbackModel, type ModelUsed } from "./fallback-model";
import type { FlagStore } from "./flags";
import type { AppEnv } from "./env";
import { createProvider, type Provider } from "./provider";

export const FIRST_TOKEN_TIMEOUT_MS = 8000;
/** 질문 임베딩이 이보다 오래 걸리면 포기하고 키워드 검색만 쓴다. */
export const EMBED_TIMEOUT_MS = 3000;

/** embeddingModelId는 인덱스를 만든 모델이어야 한다(pickEmbeddingModel). */
export function createLlm(
  env: AppEnv,
  flags: FlagStore,
  embeddingModelId: string,
  provider: Provider = createProvider(env.NVIDIA_API_KEY),
) {
  // 모델이 하나면 그 모델만 쓰고, 둘 이상이면 첫 번째가 실패하거나 늦을 때 두 번째가 넘겨받는다
  const [first, second] = env.CHAT_MODELS;
  const primary = second ? provider.chat(first!) : null;
  const fallback = provider.chat(second ?? first!);

  return {
    async embedQuery(text: string): Promise<number[]> {
      const [vector] = await provider.embed(embeddingModelId, [text], "query", AbortSignal.timeout(EMBED_TIMEOUT_MS));
      return vector!;
    },
    createModel(onUsed: (u: ModelUsed) => void) {
      return createFallbackModel({
        primary,
        fallback,
        firstTokenTimeoutMs: FIRST_TOKEN_TIMEOUT_MS,
        skipPrimary: () => flags.isPrimaryLimited(),
        onPrimaryRateLimited: (resetAt) => flags.markPrimaryLimited(resetAt),
        onModelUsed: onUsed,
      });
    },
  };
}
