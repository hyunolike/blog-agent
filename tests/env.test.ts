import { describe, expect, it } from "vitest";
import { DEFAULT_EMBEDDING_MODEL, pickEmbeddingModel, readEnv } from "@/lib/env";

describe("readEnv", () => {
  it("normalizes allowed origins and parses CHAT_MODELS", () => {
    const env = readEnv({
      NVIDIA_API_KEY: "k",
      APP_ORIGIN: "https://chat.example.dev/",
      VERCEL_URL: "abc.vercel.app",
      CHAT_MODELS: " a , b ,",
    } as unknown as NodeJS.ProcessEnv);

    expect(env.allowedOrigins).toEqual(["https://chat.example.dev", "https://abc.vercel.app"]);
    expect(env.CHAT_MODELS).toEqual(["a", "b"]);
  });

  it("requires the key and at least one chat model", () => {
    expect(() => readEnv({ CHAT_MODELS: "a" } as unknown as NodeJS.ProcessEnv)).toThrow("NVIDIA_API_KEY");
    expect(() => readEnv({ NVIDIA_API_KEY: "k", CHAT_MODELS: " , " } as unknown as NodeJS.ProcessEnv)).toThrow("CHAT_MODELS");
  });
});

describe("pickEmbeddingModel", () => {
  it("uses the index's model and reports a differing env value", () => {
    expect(pickEmbeddingModel("a/small", "a/large")).toEqual({
      model: "a/small",
      mismatch: { env: "a/large", index: "a/small" },
    });
    expect(pickEmbeddingModel("a/m", "a/m")).toEqual({ model: "a/m", mismatch: null });
    expect(pickEmbeddingModel("a/m", undefined)).toEqual({ model: "a/m", mismatch: null });
  });

  it("falls back to the env value, then the default, when no index is loaded", () => {
    expect(pickEmbeddingModel(undefined, "a/m")).toEqual({ model: "a/m", mismatch: null });
    expect(pickEmbeddingModel(undefined, undefined)).toEqual({ model: DEFAULT_EMBEDDING_MODEL, mismatch: null });
  });

  it("leaves EMBEDDING_MODEL unset when the env does not give one", () => {
    expect(readEnv({ NVIDIA_API_KEY: "k", CHAT_MODELS: "m" } as unknown as NodeJS.ProcessEnv).EMBEDDING_MODEL).toBeUndefined();
  });
});
