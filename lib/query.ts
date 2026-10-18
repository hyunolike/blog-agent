import { tokenize } from "./tokenize";

// Conversation scaffolding must not outweigh an exact technical noun in BM25.
const STOP = new Set([
  "를", "을", "에", "의", "이", "가", "그", "더", "해", "줘", "왜", "뭐", "좀", "것", "곳", "수", "는", "와", "과",
  "어떤", "어떻", "떻게", "어디", "디에", "이유", "뭐야", "알려", "려줘", "보여", "여줘", "해줘", "썼어", "써봤", "봤어", "했어", "있어",
]);
const GENERIC = new Set(["the", "and", "for", "with", "from", "this", "that", "api", "http", "https", "www", "com", "json", "true", "false", "null"]);

export function searchTerms(query: string): string[] {
  return [...new Set(tokenize(query).filter((t) => !STOP.has(t)))];
}

/** Exact technical names, not Hangul bigram overlaps or embedding similarity. */
export function queryConcepts(query: string): string[] {
  const terms = searchTerms(query);
  return terms.filter((t) => /^[a-z][a-z0-9_.-]{2,}$/.test(t) && !GENERIC.has(t) &&
    // ORA-28040 is an entity; its tokenizer fragment ORA is not a new entity.
    !terms.some((whole) => whole !== t && /[_.-]/.test(whole) && whole.split(/[_.-]+/).includes(t)));

}

export function isComparisonQuery(query: string): boolean {
  return /비교|차이|공통(?:점|된)|연관(?:성|된|관계)|관계(?:를|가|는|에|도|[?.!\s]|$)|연결된\s*글|여러\s*글|다른\s*글/.test(query.split("\n")[0] ?? "");
}

export function isCurrentPostQuery(query: string): boolean {
  const current = query.split("\n")[0]?.trim() ?? "";
  return /이\s*글|현재\s*글|보고\s*있는\s*글|이\s*포스트/.test(current) || /^(?:\d+\s*줄\s*)?요약(?:해\s*줘|해|해줘요|해\s*주세요)?[.!?\s]*$/.test(current);
}

export function isFollowUpQuery(query: string): boolean {
  return /^(?:그럼\s*)?(?:그거|그것|그건|그\s*방식|그\s*방법|이어서|더\s*자세|좀\s*더|장단점은|단점은|장점은)/.test(query.trim()) && queryConcepts(query).length === 0;
}
