import { describe, expect, it } from "vitest";
import { DEFAULT_EMBEDDING_MODEL, pickEmbeddingModel, readEnv } from "@/lib/env";

describe("readEnv", () => {
  it("normalizes allowed origins and parses FREE_MODELS", () => {
    const env = readEnv({
      OPENROUTER_API_KEY: "k",
      PAID_MODEL: "p",
      APP_ORIGIN: "https://chat.example.dev/",
      VERCEL_URL: "abc.vercel.app",
      FREE_MODELS: " a , b ,",
    } as unknown as NodeJS.ProcessEnv);

    expect(env.allowedOrigins).toEqual(["https://chat.example.dev", "https://abc.vercel.app"]);
    expect(env.FREE_MODELS).toEqual(["a", "b"]);
  });
});

describe("pickEmbeddingModel", () => {
  it("uses the index's model and reports a differing env value", () => {
    expect(pickEmbeddingModel("openai/text-embedding-3-small", "openai/text-embedding-3-large")).toEqual({
      model: "openai/text-embedding-3-small",
      mismatch: { env: "openai/text-embedding-3-large", index: "openai/text-embedding-3-small" },
    });
    expect(pickEmbeddingModel("a/m", "a/m")).toEqual({ model: "a/m", mismatch: null });
    expect(pickEmbeddingModel("a/m", undefined)).toEqual({ model: "a/m", mismatch: null });
  });

  it("falls back to the env value, then the default, when no index is loaded", () => {
    expect(pickEmbeddingModel(undefined, "a/m")).toEqual({ model: "a/m", mismatch: null });
    expect(pickEmbeddingModel(undefined, undefined)).toEqual({ model: DEFAULT_EMBEDDING_MODEL, mismatch: null });
  });

  it("leaves EMBEDDING_MODEL unset when the env does not give one", () => {
    expect(readEnv({ OPENROUTER_API_KEY: "k", PAID_MODEL: "p" } as unknown as NodeJS.ProcessEnv).EMBEDDING_MODEL).toBeUndefined();
  });
});
