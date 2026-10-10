import type { LanguageModelV4 } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "@/lib/env";
import { createMemoryFlags } from "@/lib/flags";
import { createLlm } from "@/lib/llm";
import type { Provider } from "@/lib/provider";

const env = (models: string[]) => ({ NVIDIA_API_KEY: "k", CHAT_MODELS: models }) as unknown as AppEnv;

function fakeProvider() {
  const embed = vi.fn(async (_model: string, texts: string[]) => texts.map(() => [0.1, 0.2]));
  const provider: Provider = {
    chat: (modelId) => ({ specificationVersion: "v4", provider: "fake", modelId }) as unknown as LanguageModelV4,
    embed,
  };
  return { provider, embed };
}

describe("createLlm", () => {
  it("uses the only model directly when one chat model is configured", () => {
    const { provider } = fakeProvider();
    const llm = createLlm(env(["a/one"]), createMemoryFlags(), "e/model", provider);
    expect(llm.createModel(() => {}).modelId).toBe("a/one");
  });

  it("tries the first model and hands over to the second when two are configured", () => {
    const { provider } = fakeProvider();
    const llm = createLlm(env(["a/first", "b/second", "c/ignored"]), createMemoryFlags(), "e/model", provider);
    expect(llm.createModel(() => {}).modelId).toBe("a/first→b/second");
  });

  it("embeds questions as queries with the index's embedding model", async () => {
    const { provider, embed } = fakeProvider();
    const llm = createLlm(env(["a/one"]), createMemoryFlags(), "e/model", provider);
    expect(await llm.embedQuery("질문")).toEqual([0.1, 0.2]);
    expect(embed).toHaveBeenCalledWith("e/model", ["질문"], "query", expect.any(AbortSignal));
  });
});
