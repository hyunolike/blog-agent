import * as cheerio from "cheerio";
import TurndownService from "turndown";
import type { Post } from "@/lib/types";

export const MIN_BODY_CHARS = 200;

export type ExtractedPost = Post & { markdown: string };

export function splitTitle(raw: string): { prefix: string[]; title: string } {
  const prefix: string[] = [];
  let rest = raw.trim();
  let m: RegExpMatchArray | null;
  while ((m = rest.match(/^\[([^\[\]]{1,40})\]\s*/))) {
    prefix.push(m[1]!.trim());
    rest = rest.slice(m[0].length);
  }
  return { prefix, title: rest.trim() };
}

const cellText = (el: Element) =>
  (el.textContent ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

function createTurndown(): TurndownService {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  // 결과물은 사람이 아니라 검색과 LLM이 읽는다. "1. 개발 소개"가 "1\. 개발 소개"로 바뀌지 않게 이스케이프를 끈다
  td.escape = (text: string) => text;

  td.addRule("unwrapEmphasisInHeading", {
    // 티스토리 에디터는 "제목 폰트 크게"를 <h2><b>텍스트</b></h2>처럼 굵게로도 표현한다.
    // 헤딩 자체가 이미 강조이므로 "## **텍스트**"처럼 이중으로 강조 표시하지 않는다.
    filter: (node) =>
      (node.nodeName === "STRONG" || node.nodeName === "B" || node.nodeName === "EM" || node.nodeName === "I") &&
      !!node.parentNode &&
      /^H[1-6]$/.test(node.parentNode.nodeName),
    replacement: (content) => content,
  });

  td.addRule("tistoryCode", {
    filter: (node) => node.nodeName === "PRE",
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const lang = (el.getAttribute("data-ke-language") ?? "").trim();
      const code = (el.textContent ?? "").replace(/\n+$/, "");
      const fence = code.includes("```") ? "````" : "```";
      return `\n\n${fence}${lang}\n${code}\n${fence}\n\n`;
    },
  });

  td.addRule("table", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = Array.from((node as HTMLElement).querySelectorAll("tr")).map((tr) =>
        Array.from(tr.querySelectorAll("th,td")).map(cellText),
      );
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      const header = rows[0]!;
      const body = rows.slice(1);
      return `\n\n${[line(header), line(Array(width).fill("---")), ...body.map(line)].join("\n")}\n\n`;
    },
  });

  td.addRule("linkTextOnly", {
    filter: "a",
    replacement: (content) => content,
  });

  td.addRule("imageAlt", {
    filter: "img",
    replacement: (_content, node) => {
      const alt = ((node as HTMLElement).getAttribute("alt") ?? "").trim();
      return alt ? `[이미지: ${alt}]` : "";
    },
  });

  return td;
}

const turndown = createTurndown();

export function htmlToMarkdown(html: string): string {
  return turndown
    .turndown(html)
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractPost(html: string, url: string): ExtractedPost {
  const $ = cheerio.load(html);
  const meta = (property: string) => $(`meta[property="${property}"]`).attr("content")?.trim() ?? "";

  const body = $("#article-view .contents_style").first();
  body.find("script, style, .another_category, .container_postbtn, [data-tistory-react-app]").remove();
  const markdown = htmlToMarkdown(body.html() ?? "");

  const visibleChars = markdown.replace(/\s+/g, "").length;
  if (visibleChars < MIN_BODY_CHARS) {
    throw new Error(`본문 추출 실패: ${url} (${visibleChars}자). 스킨의 #article-view 구조가 바뀌었는지 확인하세요.`);
  }

  const { prefix, title } = splitTitle(meta("og:title"));
  return {
    id: Number(new URL(url).pathname.slice(1)),
    url,
    title,
    prefix,
    category: $("p.category").first().text().trim(),
    summary: meta("og:description"),
    publishedAt: meta("article:published_time"),
    modifiedAt: meta("article:modified_time"),
    markdown,
  };
}
