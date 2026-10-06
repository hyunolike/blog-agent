import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPost, htmlToMarkdown, splitTitle } from "@/ingest/extract";

const fixture = (n: number) => readFileSync(`tests/fixtures/posts/${n}.html`, "utf8");

describe("splitTitle", () => {
  it("separates one or more bracket prefixes", () => {
    expect(splitTitle("[AI][NVIDIA] LLM이 결정하지 않는 에이전트 1편")).toEqual({
      prefix: ["AI", "NVIDIA"],
      title: "LLM이 결정하지 않는 에이전트 1편",
    });
    expect(splitTitle("[WIL (Weekly I Learned)] 1~2주차 회고").prefix).toEqual(["WIL (Weekly I Learned)"]);
  });

  it("keeps titles without a prefix", () => {
    expect(splitTitle("그냥 제목")).toEqual({ prefix: [], title: "그냥 제목" });
  });
});

describe("htmlToMarkdown", () => {
  it("fences tistory code blocks with their language", () => {
    const md = htmlToMarkdown(
      '<pre class="bash" data-ke-language="bash"><code>echo "hi"\nls</code></pre>',
    );
    expect(md).toContain('```bash\necho "hi"\nls\n```');
  });

  it("turns every table into a markdown table using the first row as header", () => {
    const md = htmlToMarkdown(
      "<table><tr><td>항목</td><td>값</td></tr><tr><td>a|b</td><td>1</td></tr></table>",
    );
    expect(md).toContain("| 항목 | 값 |\n| --- | --- |\n| a\\|b | 1 |");
  });

  it("does not escape markdown-looking text such as numbered headings", () => {
    expect(htmlToMarkdown("<h2>1. 개발 소개</h2>")).toBe("## 1. 개발 소개");
  });

  it("keeps link text, drops urls, and reduces images to alt text", () => {
    const md = htmlToMarkdown('<p><a href="https://x.dev/long">문서</a> <img src="a.png" alt="구조도"></p>');
    expect(md).toContain("문서");
    expect(md).not.toContain("https://x.dev");
    expect(md).toContain("[이미지: 구조도]");
  });
});

describe("extractPost", () => {
  it("extracts metadata and markdown from a real post", () => {
    const post = extractPost(fixture(70), "https://hyunolike.tistory.com/70");
    expect(post).toMatchObject({
      id: 70,
      url: "https://hyunolike.tistory.com/70",
      title: "점검 페이지는 장애 난 시스템 밖에 있어야 한다",
      prefix: ["프로젝트"],
      category: "프로젝트",
      modifiedAt: "2026-09-17T23:14:22+09:00",
    });
    expect(post.summary.length).toBeGreaterThan(20);
    expect(post.markdown).toContain("## 정상 모드에서는 브라우저가 두 서버를 각각 호출한다");
  });

  it("excludes skin parts that appear on every page", () => {
    const post = extractPost(fixture(70), "https://hyunolike.tistory.com/70");
    expect(post.markdown).not.toContain("달레스터디"); // 스킨 상단 수상 기록
    expect(post.markdown).not.toContain("카테고리의 다른 글");
    expect(post.markdown).not.toContain("구독하기");
  });

  it("handles code-heavy, table-heavy and plain contents_style posts", () => {
    expect(extractPost(fixture(1), "https://hyunolike.tistory.com/1").markdown).toContain("```bash");
    expect(extractPost(fixture(60), "https://hyunolike.tistory.com/60").markdown).toContain("| --- |");
    expect(extractPost(fixture(51), "https://hyunolike.tistory.com/51").category).toBe("WEB");
  });

  it("fails loudly when the body selector finds almost nothing", () => {
    const html = '<meta property="og:title" content="[BE] 빈 글"><div id="article-view"><div class="contents_style"><p>짧음</p></div></div>';
    expect(() => extractPost(html, "https://hyunolike.tistory.com/999")).toThrow("본문 추출 실패");
  });
});
