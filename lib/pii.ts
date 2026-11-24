/**
 * 사용자 입력의 개인정보를 외부 모델 제공자에 보내기 전에 가린다.
 * 기술 블로그 질문에는 IP, 포트, 버전, 에러 코드, 날짜 같은 숫자가 많으므로
 * 형식이 분명한 값만 가리고, 숫자만으로 구분되지 않는 계좌와 여권은 앞에 그 단어가 있을 때만 가린다.
 */

export type PiiKind = "주민등록번호" | "카드번호" | "계좌번호" | "여권번호" | "전화번호" | "이메일";
export type MaskResult = { text: string; counts: Partial<Record<PiiKind, number>> };

type Rule = { kind: PiiKind; pattern: RegExp; accept?: (match: string) => boolean; keepPrefix?: boolean };

const digits = (s: string) => s.replace(/\D/g, "");

/** 앞 6자리가 실제 날짜(월 1~12, 일 1~31)인지 */
function looksLikeBirthDate(match: string): boolean {
  const d = digits(match);
  const month = Number(d.slice(2, 4));
  const day = Number(d.slice(4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** 카드번호 체크섬. 우연히 13~19자리인 숫자를 카드로 오인하지 않게 한다. */
function passesLuhn(match: string): boolean {
  const d = digits(match);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

// 값 앞뒤 경계. 영문, 숫자, 밑줄, 점, 하이픈이 붙어 있으면 ID나 파일명의 일부로 보고 가리지 않는다.
// 뒤쪽은 문장 끝 마침표("…5678.")를 허용하고, 점이나 하이픈 뒤에 숫자나 문자가 이어질 때만 막는다.
const START = String.raw`(?<![\w.\-])`;
const END = String.raw`(?![\w]|[.\-][\w])`;
/** "계좌번호는", "계좌 번호가", "여권:" 처럼 키워드 뒤에 오는 말. 공백은 짧게 제한해 긴 공백에서 느려지지 않게 한다. */
const AFTER_KEYWORD = String.raw`(?:\s?번호)?(?:은|는|이|가|을|를|로|으로)?\s?[:：]?\s{0,3}`;
const re = (source: string) => new RegExp(source, "g");

/** 개인 이메일이 아니라 SSH 접속(git@, ubuntu@)이나 코드(this@)에 흔한 앞부분 */
const TECH_LOCAL_PARTS = new Set(["git", "ubuntu", "ec2-user", "root", "centos", "opc", "admin", "this", "super"]);

// 순서가 중요하다: 단어가 붙은 형식과 긴 숫자 형식(주민번호, 카드)을 전화번호보다 먼저 가린다
const RULES: Rule[] = [
  { kind: "계좌번호", pattern: re(String.raw`(계좌${AFTER_KEYWORD})(\d[\d-]{8,}\d)(?!\d)`), keepPrefix: true },
  { kind: "여권번호", pattern: re(String.raw`(여권${AFTER_KEYWORD})([A-Za-z]\d{3}[A-Za-z]\d{4}|[A-Za-z]{1,2}\d{7,8})(?![\dA-Za-z])`), keepPrefix: true },
  // 구분자 없는 13자리는 epoch millis나 주문번호와 구분되지 않아 "주민"이라는 말이 있을 때만 가린다
  { kind: "주민등록번호", pattern: re(String.raw`(주민(?:등록)?${AFTER_KEYWORD})(\d{13})(?!\d)`), accept: looksLikeBirthDate, keepPrefix: true },
  { kind: "주민등록번호", pattern: re(String.raw`${START}\d{6}(?:\s?-\s?|\s)[1-8]\d{6}${END}`), accept: looksLikeBirthDate },
  // 국내에서 쓰는 카드는 3(아멕스 15자리), 4, 5, 6으로 시작하는 15~16자리다. 타임스탬프와 ID를 줄이려고 그 형식만 본다
  { kind: "카드번호", pattern: re(String.raw`${START}[3-6]\d{3}(?:[ -]?\d{4}){2}[ -]?\d{3,4}${END}`), accept: passesLuhn },
  { kind: "전화번호", pattern: re(String.raw`${START}01[016789](?:\s?[-.]\s?|\s)?\d{3,4}(?:\s?[-.]\s?|\s)?\d{4}${END}`) },
  { kind: "전화번호", pattern: re(String.raw`${START}0(?:2|[3-6][1-5]|70)\s?-\s?\d{3,4}\s?-\s?\d{4}${END}`) },
  { kind: "이메일", pattern: /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g, accept: (m) => !TECH_LOCAL_PARTS.has(m.split("@")[0]!.toLowerCase()) },
];

export function maskPii(input: string): MaskResult {
  const counts: MaskResult["counts"] = {};
  let text = input;
  for (const { kind, pattern, accept, keepPrefix } of RULES) {
    text = text.replace(pattern, (match: string, ...groups: unknown[]) => {
      const value = keepPrefix ? (groups[1] as string) : match;
      if (accept && !accept(value)) return match;
      counts[kind] = (counts[kind] ?? 0) + 1;
      return keepPrefix ? `${groups[0] as string}[${kind}]` : `[${kind}]`;
    });
  }
  return { text, counts };
}
