import { describe, expect, it } from "vitest";
import { readEnv } from "@/lib/env";

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
