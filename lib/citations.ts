import type { SourceRef } from "./types";

const CODE = /(```[\s\S]*?```|`[^`\n]*`)/g;
const CITE = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;

export function linkCitations(markdown: string, sources: SourceRef[]): { markdown: string; cited: number[] } {
  const byN = new Map(sources.map((s) => [s.n, s]));
  const cited = new Set<number>();

  const linkPart = (text: string) =>
    text.replace(CITE, (_match, group: string) =>
      group
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => byN.has(n))
        .map((n) => {
          cited.add(n);
          return `[\\[${n}\\]](${byN.get(n)!.url})`;
        })
        .join(""),
    );

  const out = markdown
    .split(CODE)
    .map((part, i) => (i % 2 === 1 ? part : linkPart(part)))
    .join("");
  return { markdown: out, cited: [...cited].sort((a, b) => a - b) };
}
