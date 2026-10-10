import { describe, expect, it } from "vitest";
import { linkCitations } from "@/lib/citations";
import type { SourceRef } from "@/lib/types";

const sources: SourceRef[] = [
  { n: 1, postId: 70, title: "점검 페이지", url: "https://hyunolike.tistory.com/70", section: "" },
  { n: 2, postId: 65, title: "블루그린", url: "https://hyunolike.tistory.com/65", section: "" },
];

describe("linkCitations", () => {
  it("turns known numbers into links and reports which were cited", () => {
    const { markdown, cited } = linkCitations("Edge Config에 뒀어요[1].", sources);
    expect(markdown).toBe("Edge Config에 뒀어요[\\[1\\]](https://hyunolike.tistory.com/70).");
    expect(cited).toEqual([1]);
  });

  it("handles grouped and adjacent citations", () => {
    expect(linkCitations("A[1, 2] B[2][1]", sources).markdown).toBe(
      "A[\\[1\\]](https://hyunolike.tistory.com/70)[\\[2\\]](https://hyunolike.tistory.com/65) B[\\[2\\]](https://hyunolike.tistory.com/65)[\\[1\\]](https://hyunolike.tistory.com/70)",
    );
  });

  it("removes numbers that are not in the source list", () => {
    const { markdown, cited } = linkCitations("지어낸 출처[9]와 섞인 것[1, 9]", sources);
    expect(markdown).toBe("지어낸 출처와 섞인 것[\\[1\\]](https://hyunolike.tistory.com/70)");
    expect(cited).toEqual([1]);
  });

  it("accepts full-width and lenticular brackets that some models emit", () => {
    const { markdown, cited } = linkCitations("단방향이라 SSE로 충분했다【1】【2】. 정리하면［1］", sources);
    expect(markdown).toBe(
      "단방향이라 SSE로 충분했다[\\[1\\]](https://hyunolike.tistory.com/70)[\\[2\\]](https://hyunolike.tistory.com/65). 정리하면[\\[1\\]](https://hyunolike.tistory.com/70)",
    );
    expect(cited).toEqual([1, 2]);
  });

  it("leaves brackets inside code untouched", () => {
    const input = "배열은 `arr[1]`처럼 쓰고\n\n```js\nconst a = b[2];\n```\n끝[2]";
    const { markdown } = linkCitations(input, sources);
    expect(markdown).toContain("`arr[1]`");
    expect(markdown).toContain("const a = b[2];");
    expect(markdown.endsWith("끝[\\[2\\]](https://hyunolike.tistory.com/65)")).toBe(true);
  });
});
