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
  return /(?:^|[\s“”"'()])(?:이\s*글|현재\s*글|보고\s*있는\s*글|이\s*포스트)(?=[이가을를의에은는도과와로부터?!.,\s]|$)/.test(current) ||
    /^(?:\d+\s*줄\s*)?요약(?:해\s*줘|해|해줘요|해\s*주세요)?[.!?\s]*$/.test(current) ||
    (isFollowUpQuery(current) && !!query.split("\n")[1] && isCurrentPostQuery(query.split("\n").slice(1).join("\n")));
}

export function isFollowUpQuery(query: string): boolean {
  if (queryConcepts(query).length) return false;
  let text = query.trim().replace(/[.!?…]+$/g, "").replace(/^그럼\s*/, "").trim();
  const deictic = text.match(/^(?:그거|그것|그건|그\s*방식|그\s*방법)(?:은|는|을|의|에\s*대해)?\s*(.*)$/);
  if (deictic) {
    text = deictic[1]!.trim();
    if (!text) return true;
  }
  // Whole-phrase recognition fails closed on new Korean nouns, cancellation
  // clauses ("그거 말고 ..."), or other self-contained topic changes.
  text = text.replace(/\s*(?:알려\s*줘|설명해\s*줘|말해\s*줘|보여\s*줘|알려\s*주세요|설명해\s*주세요)$/, "").trim();
  return /^(?:(?:좀|조금)\s*)?(?:더\s*)?(?:자세히|설명|장단점(?:은|을)?|장점(?:은|을)?|단점(?:은|을)?|예시(?:는|를|도)?|이유(?:는|를)?|왜|어떻게|이어서)$/.test(text);
}
