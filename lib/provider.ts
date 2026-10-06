import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/** NVIDIA 검색용 임베딩 모델은 문서와 질문을 다르게 임베딩한다. */
export type EmbedInputType = "query" | "passage";

const EMBED_BATCH = 32;

export type Provider = {
  chat(modelId: string): LanguageModelV4;
  embed(modelId: string, texts: string[], inputType: EmbedInputType, signal?: AbortSignal): Promise<number[][]>;
};

/** 모델 제공자(NVIDIA API 카탈로그)를 아는 유일한 파일. 제공자를 바꾸려면 여기만 고친다. */
export function createProvider(apiKey: string, fetchImpl: typeof fetch = fetch): Provider {
  const nvidia = createOpenAICompatible({ name: "nvidia", baseURL: NVIDIA_BASE_URL, apiKey });

  async function embedBatch(modelId: string, input: string[], inputType: EmbedInputType, signal?: AbortSignal) {
    // AI SDK의 임베딩 호출은 input_type을 넘길 수 없어서 직접 요청한다
    const res = await fetchImpl(`${NVIDIA_BASE_URL}/embeddings`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: modelId, input, input_type: inputType, truncate: "END", encoding_format: "float" }),
      signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`임베딩 요청 실패: ${res.status} ${detail}`);
    }
    const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  return {
    chat: (modelId) => nvidia.chatModel(modelId),
    async embed(modelId, texts, inputType, signal) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        out.push(...(await embedBatch(modelId, texts.slice(i, i + EMBED_BATCH), inputType, signal)));
      }
      return out;
    },
  };
}
