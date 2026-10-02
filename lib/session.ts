import type { ChatUIMessage } from "./types";

export function loadSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveSession(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장이 막힌 환경(Safari 서드파티 iframe, 사생활 보호 모드)에서는 대화 유지만 포기한다
  }
}

const WIRE_MESSAGES = 6;
const ASSISTANT_CHARS = 600;

export function toWire(messages: ChatUIMessage[]) {
  return messages.slice(-WIRE_MESSAGES).map((m) => {
    const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return {
      id: m.id,
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      parts: [{ type: "text" as const, text: m.role === "assistant" ? text.slice(0, ASSISTANT_CHARS) : text }],
    };
  });
}
