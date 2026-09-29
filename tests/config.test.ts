import { describe, expect, it } from "vitest";
import { parseBlogPostId } from "@/lib/config";

describe("parseBlogPostId", () => {
  it("accepts pc and mobile post urls", () => {
    expect(parseBlogPostId("https://hyunolike.tistory.com/70")).toBe(70);
    expect(parseBlogPostId("https://hyunolike.tistory.com/m/70")).toBe(70);
    expect(parseBlogPostId("https://hyunolike.tistory.com/70?category=1")).toBe(70);
  });

  it("rejects anything that is not a post on this blog", () => {
    for (const bad of [
      null,
      "",
      "javascript:alert(1)",
      "https://evil.example/70",
      "https://hyunolike.tistory.com.evil.example/70",
      "http://hyunolike.tistory.com/70",
      "https://hyunolike.tistory.com/category/BE",
      "https://hyunolike.tistory.com/",
    ]) {
      expect(parseBlogPostId(bad)).toBeNull();
    }
  });
});
