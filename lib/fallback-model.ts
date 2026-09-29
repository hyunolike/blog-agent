import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
  type LanguageModelV4StreamResult,
} from "@ai-sdk/provider";

export type ModelUsed = { tier: "free" | "paid"; modelId: string; reason?: string };

export type FallbackOptions = {
  primary: LanguageModelV4 | null;
  fallback: LanguageModelV4;
  firstTokenTimeoutMs: number;
  skipPrimary?: () => Promise<boolean>;
  onPrimaryRateLimited?: (resetAtMs: number | null) => Promise<void> | void;
  onModelUsed?: (info: ModelUsed) => void;
};

class FirstTokenTimeout extends Error {
  constructor(ms: number) {
    super(`첫 토큰이 ${ms}ms 안에 오지 않음`);
  }
}

function raceAbort<T>(p: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(p).then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function replay(
  buffered: LanguageModelV4StreamPart[],
  reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart>,
): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of buffered) controller.enqueue(part);
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** 첫 text-delta가 올 때까지 기다린 뒤, 버퍼한 조각과 나머지를 이어 붙인 스트림을 돌려준다. */
async function streamWithFirstToken(
  model: LanguageModelV4,
  options: LanguageModelV4CallOptions,
  timeoutMs: number,
): Promise<{ result: LanguageModelV4StreamResult; modelId: string }> {
  const controller = new AbortController();
  const signal = options.abortSignal ? AbortSignal.any([options.abortSignal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new FirstTokenTimeout(timeoutMs)), timeoutMs);
  let reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart> | undefined;
  try {
    const res = await raceAbort(model.doStream({ ...options, abortSignal: signal }), signal);
    reader = res.stream.getReader();
    const buffered: LanguageModelV4StreamPart[] = [];
    let modelId = model.modelId;
    for (;;) {
      const { value, done } = await raceAbort(reader.read(), signal);
      if (done) throw new Error("텍스트 없이 스트림이 끝남");
      if (value.type === "error") throw value.error;
      if (value.type === "response-metadata" && value.modelId) modelId = value.modelId;
      buffered.push(value);
      if (value.type === "text-delta" && value.delta.length > 0) {
        clearTimeout(timer);
        return { result: { ...res, stream: replay(buffered, reader) }, modelId };
      }
    }
  } catch (err) {
    clearTimeout(timer);
    reader?.cancel().catch(() => {});
    controller.abort();
    throw err;
  }
}

function resetAtFrom(err: unknown): number | null {
  if (!APICallError.isInstance(err)) return null;
  const raw = err.responseHeaders?.["x-ratelimit-reset"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

const describe = (err: unknown) =>
  APICallError.isInstance(err) ? `${err.statusCode ?? "?"} ${err.message}` : err instanceof Error ? err.message : String(err);

export function createFallbackModel(opts: FallbackOptions): LanguageModelV4 {
  const { primary, fallback } = opts;
  return {
    specificationVersion: "v4",
    provider: "blog-agent-fallback",
    modelId: primary ? `${primary.modelId}→${fallback.modelId}` : fallback.modelId,
    supportedUrls: {},

    async doGenerate(options) {
      if (primary && !(await opts.skipPrimary?.())) {
        try {
          const result = await primary.doGenerate(options);
          opts.onModelUsed?.({ tier: "free", modelId: primary.modelId });
          return result;
        } catch (err) {
          if (APICallError.isInstance(err) && err.statusCode === 429) await opts.onPrimaryRateLimited?.(resetAtFrom(err));
          const result = await fallback.doGenerate(options);
          opts.onModelUsed?.({ tier: "paid", modelId: fallback.modelId, reason: describe(err) });
          return result;
        }
      }
      const result = await fallback.doGenerate(options);
      opts.onModelUsed?.({ tier: "paid", modelId: fallback.modelId, reason: primary ? "free-exhausted" : "no-free-models" });
      return result;
    },

    async doStream(options) {
      let reason = primary ? "free-exhausted" : "no-free-models";
      if (primary && !(await opts.skipPrimary?.())) {
        try {
          const { result, modelId } = await streamWithFirstToken(primary, options, opts.firstTokenTimeoutMs);
          opts.onModelUsed?.({ tier: "free", modelId });
          return result;
        } catch (err) {
          if (options.abortSignal?.aborted) throw err;
          reason = describe(err);
          if (APICallError.isInstance(err) && err.statusCode === 429) await opts.onPrimaryRateLimited?.(resetAtFrom(err));
        }
      }
      const result = await fallback.doStream(options);
      opts.onModelUsed?.({ tier: "paid", modelId: fallback.modelId, reason });
      return result;
    },
  };
}
