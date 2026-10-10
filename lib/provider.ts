import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/** NVIDIA 검색용 임베딩 모델은 문서와 질문을 다르게 임베딩한다. */
export type EmbedInputType = "query" | "passage";

const EMBED_BATCH = 32;
const EMBED_ATTEMPTS = 4;
const RETRY_BASE_MS = 1000;

/**
 * 카탈로그의 답변 모델은 대부분 추론형이라 그대로 두면 답을 시작하기까지 수 초에서 수십 초가 걸린다.
 * 출처가 이미 주어진 질의응답이라 긴 추론이 필요 없으므로, 두 가지 방식의 추론 축소 옵션을 함께 보낸다.
 */
export const CHAT_REQUEST_EXTRAS = { reasoning_effort: "low", chat_template_kwargs: { enable_thinking: false } };

const isTemporary = (status: number) => status === 429 || status >= 500;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type Provider = {
  chat(modelId: string): LanguageModelV4;
  embed(modelId: string, texts: string[], inputType: EmbedInputType, signal?: AbortSignal): Promise<number[][]>;
};

/** 모델 제공자(NVIDIA API 카탈로그)를 아는 유일한 파일. 제공자를 바꾸려면 여기만 고친다. */
export function createProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = wait,
): Provider {
  const nvidia = createOpenAICompatible({
    name: "nvidia",
    baseURL: NVIDIA_BASE_URL,
    apiKey,
    fetch: fetchImpl,
    transformRequestBody: (body) => ({ ...body, ...CHAT_REQUEST_EXTRAS }),
  });

  async function embedBatch(modelId: string, input: string[], inputType: EmbedInputType, signal?: AbortSignal) {
    // AI SDK의 임베딩 호출은 input_type을 넘길 수 없어서 직접 요청한다
    const body = JSON.stringify({ model: modelId, input, input_type: inputType, truncate: "END", encoding_format: "float" });
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(`${NVIDIA_BASE_URL}/embeddings`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body,
        signal,
      });
      if (res.ok) {
        const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
        return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      }
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      // 무료 API는 502나 429를 가끔 돌려준다. 잠깐 기다렸다가 다시 시도한다
      if (!isTemporary(res.status) || attempt >= EMBED_ATTEMPTS) throw new Error(`임베딩 요청 실패: ${res.status} ${detail}`);
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
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
