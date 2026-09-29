import { describe, expect, it } from "vitest";
import { buildModelMessages, buildSearchQuery, buildSources, PROMPT_BUDGET, SYSTEM_PROMPT } from "@/lib/prompt";
import type { RetrievedChunk } from "@/lib/retrieval";

const hit = (postId: number, n: number, text: string, headingPath: string[] = ["절"]): RetrievedChunk => ({
  score: 1,
  post: { id: postId, url: `https://hyunolike.tistory.com/${postId}`, title: `글 ${postId}`, prefix: [], category: "", summary: "", publishedAt: "", modifiedAt: "" },
  chunk: { id: `${postId}-${n}`, postId, kind: "body", headingPath, text, embedText: text, hash: "", vector: "" },
});

describe("SYSTEM_PROMPT", () => {
  it("states the grounding rules", () => {
    expect(SYSTEM_PROMPT).toContain("<source>");
    expect(SYSTEM_PROMPT).toContain("블로그에는 없는 내용");
    expect(SYSTEM_PROMPT).toContain("[1]");
  });
});

describe("buildSearchQuery", () => {
  it("joins the current and previous user questions", () => {
    expect(
      buildSearchQuery([
        { role: "user", text: "systemd timer 왜 썼어?" },
        { role: "assistant", text: "답변" },
        { role: "user", text: "그거 더 자세히" },
      ]),
    ).toBe("그거 더 자세히\nsystemd timer 왜 썼어?");
  });
});

describe("buildSources", () => {
  it("numbers sources and escapes attribute quotes", () => {
    const { block, sources } = buildSources([hit(70, 1, "본문 A", ['"따옴표" 절']), hit(65, 2, "본문 B")]);
    expect(sources).toEqual([
      { n: 1, postId: 70, title: "글 70", url: "https://hyunolike.tistory.com/70", section: '"따옴표" 절' },
      { n: 2, postId: 65, title: "글 65", url: "https://hyunolike.tistory.com/65", section: "절" },
    ]);
    expect(block).toContain('<source id="1" title="글 70" section="&quot;따옴표&quot; 절" url="https://hyunolike.tistory.com/70">\n본문 A\n</source>');
  });

  it("drops the lowest ranked sources beyond the character budget", () => {
    const big = "가".repeat(PROMPT_BUDGET.sourceChars - 3);
    const { sources } = buildSources([hit(1, 1, big), hit(2, 1, "넘치는 조각")]);
    expect(sources.map((s) => s.postId)).toEqual([1]);
  });
});

describe("buildModelMessages", () => {
  it("attaches sources to the last user turn, trims old history, and never starts with assistant", () => {
    const old = "나".repeat(PROMPT_BUDGET.historyChars);
    const msgs = buildModelMessages(
      [
        { role: "user", text: old },
        { role: "assistant", text: "이전 답" },
        { role: "user", text: "두 번째 질문" },
        { role: "assistant", text: "두 번째 답" },
        { role: "user", text: "지금 질문" },
      ],
      "<source id=\"1\">x</source>",
    );
    expect(msgs).toEqual([
      { role: "user", content: "두 번째 질문" },
      { role: "assistant", content: "두 번째 답" },
      { role: "user", content: "<source id=\"1\">x</source>\n\n질문: 지금 질문" },
    ]);
  });
});
