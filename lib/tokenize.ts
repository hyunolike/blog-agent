const ASCII_TERM = /[a-z0-9](?:[a-z0-9_.\-]*[a-z0-9])?/g;
const HANGUL_RUN = /[가-힣]+/g;

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const term of lower.match(ASCII_TERM) ?? []) {
    out.push(term);
    if (/[_.\-]/.test(term)) out.push(...term.split(/[_.\-]+/).filter(Boolean));
  }
  for (const run of lower.match(HANGUL_RUN) ?? []) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}
