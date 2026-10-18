/** Ingest adds this curated membership line; it is not an original-body witness. */
export function originalChunkText(text: string): string {
  return text.replace(/^프로젝트: [^\n]*(?:\n|$)/, "");
}

/** Return the exact ASCII concept occurrence, never a substring of another word. */
export function conceptOffset(text: string, concept: string, start = 0): number {
  const escaped = concept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|[^a-z0-9_])(${escaped})(?=$|[^a-z0-9_])`, "i").exec(text.slice(start));
  return match ? start + match.index + match[1]!.length : -1;
}
