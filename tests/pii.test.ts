import { describe, expect, it } from "vitest";
import { maskPii, type PiiKind } from "@/lib/pii";
import { loadQuestions } from "@/eval/load";

describe("maskPii", () => {
  it.each([
    ["제 번호는 010-1234-5678이에요", "제 번호는 [전화번호]이에요", "전화번호"],
    ["01012345678로 연락 주세요", "[전화번호]로 연락 주세요", "전화번호"],
    ["010 1234 5678", "[전화번호]", "전화번호"],
    ["회사 02-123-4567로 전화", "회사 [전화번호]로 전화", "전화번호"],
    ["메일은 hong.gildong+blog@example.co.kr 입니다", "메일은 [이메일] 입니다", "이메일"],
    ["주민번호 900101-1234567", "주민번호 [주민등록번호]", "주민등록번호"],
    ["주민번호는 9001011234567 맞나요", "주민번호는 [주민등록번호] 맞나요", "주민등록번호"],
    ["900101 1234567", "[주민등록번호]", "주민등록번호"],
    ["카드 4111-1111-1111-1111 결제", "카드 [카드번호] 결제", "카드번호"],
    ["4111 1111 1111 1111", "[카드번호]", "카드번호"],
    ["계좌번호 110-123-456789로 보내줘", "계좌번호 [계좌번호]로 보내줘", "계좌번호"],
    ["국민은행 계좌: 123456-01-234567", "국민은행 계좌: [계좌번호]", "계좌번호"],
    ["여권번호 M12345678", "여권번호 [여권번호]", "여권번호"],
    ["제 계좌번호는 110-123-456789입니다", "제 계좌번호는 [계좌번호]입니다", "계좌번호"],
    ["계좌 번호가 1002123456789예요", "계좌 번호가 [계좌번호]예요", "계좌번호"],
    ["여권번호는 M12345678이에요", "여권번호는 [여권번호]이에요", "여권번호"],
    ["새 여권 M123A4567", "새 여권 [여권번호]", "여권번호"],
    ["010 - 1234 - 5678", "[전화번호]", "전화번호"],
    ["연락처 010-1234-5678.", "연락처 [전화번호].", "전화번호"],
  ])("masks %s", (input, expected, kind) => {
    const { text, counts } = maskPii(input);
    expect(text).toBe(expected);
    expect(counts[kind as PiiKind]).toBe(1);
  });

  it("counts several values of several kinds without keeping the values", () => {
    const { text, counts } = maskPii("010-1111-2222, 010-3333-4444, a@b.com");
    expect(text).toBe("[전화번호], [전화번호], [이메일]");
    expect(counts).toEqual({ 전화번호: 2, 이메일: 1 });
    expect(JSON.stringify(counts)).not.toContain("1111");
  });

  it.each([
    "ORA-28040 에러는 어떻게 해결했어?",
    "MySQL 1213 데드락은 왜 났어?",
    "192.168.0.10:8080 으로 접속이 안 됐어",
    "Spring Boot 3.2.1에서 4.1로 올렸어?",
    "2026-11-24 배포에서 뭐가 바뀌었어?",
    "응답이 3.49s에서 0.925ms로 줄었다던데",
    "주문 ID 202611240001 같은 키로 락을 걸었어?",
    "8081 vs 8080 포트 문제",
    "카드 승인 API JaxWsProxyFactoryBean은 왜 썼어?",
    "1234-5678-9012-3456 같은 형식 검증은?", // Luhn을 통과하지 않는 16자리
    "991332-1234567", // 13월 32일은 날짜가 아니다
    "user@localhost 로 접속",
    "9001011234567", // 구분자 없는 13자리는 주민번호라는 말이 있을 때만 가린다
    "1711234567890 epoch millis로 저장했어",
    "20241124153012 형식 타임스탬프",
    "V20241124153012__add_column.sql",
    "snowflake ID 1234567890123456789",
    "ORD0101234567 주문",
    "git@github.com:org/repo.git 로 클론",
    "ssh ubuntu@ec2-1-2-3-4.compute-1.amazonaws.com",
    "this@MainActivity.run 블록",
  ])("leaves technical text alone: %s", (input) => {
    expect(maskPii(input)).toEqual({ text: input, counts: {} });
  });

  it("changes none of the evaluation questions", () => {
    for (const q of loadQuestions()) {
      for (const t of [q.question, ...((q as { history?: string[] }).history ?? [])]) expect(maskPii(t).text, q.id).toBe(t);
    }
  });
});
