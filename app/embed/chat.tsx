"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { AI_UNAVAILABLE } from "@/lib/config";
import { loadSession, saveSession, toWire } from "@/lib/session";
import type { ChatUIMessage } from "@/lib/types";
import { MessageView, SourceCards, uniqueByPost } from "./message";

const STORAGE_KEY = "blog-agent:messages";
const STORED_MESSAGES = 20;
const MAX_CHARS = 500;
const SUGGESTIONS = ["운영 중인 프로젝트는 뭐가 있어?", "장애 대응 경험을 알려줘", "systemd timer는 왜 썼어?"];

function errorMessage(error: Error | undefined): string | null {
  if (!error || error.message === AI_UNAVAILABLE) return null;
  try {
    const body = JSON.parse(error.message) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // JSON이 아닌 오류는 아래 기본 문구로 보여준다
  }
  return "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

const close = () => window.parent.postMessage({ type: "blog-agent:close" }, "*");

export function Chat({ from }: { from: string | null }) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const { messages, setMessages, sendMessage, regenerate, status, error, clearError } = useChat<ChatUIMessage>({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => ({ body: { messages: toWire(messages as ChatUIMessage[]), from } }),
    }),
  });

  useEffect(() => {
    const saved = loadSession<ChatUIMessage[]>(STORAGE_KEY);
    if (saved?.length) setMessages(saved);
  }, [setMessages]);

  useEffect(() => {
    if (status === "ready" || status === "error") saveSession(STORAGE_KEY, messages.slice(-STORED_MESSAGES));
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const busy = status === "submitted" || status === "streaming";
  const ask = (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    clearError();
    void sendMessage({ text: q.slice(0, MAX_CHARS) });
    setInput("");
  };

  const last = messages[messages.length - 1];
  const lastText = last?.role === "assistant" ? last.parts.map((p) => (p.type === "text" ? p.text : "")).join("") : "";
  const aiDown = error?.message === AI_UNAVAILABLE;
  const suggestions = from ? ["이 글 3줄 요약해줘", ...SUGGESTIONS] : SUGGESTIONS;

  return (
    <div className="chat">
      <header className="chat-header">
        <span className="chat-title">
          ~/ask hyunolike<span className="caret" aria-hidden="true" />
        </span>
        <button type="button" className="chat-close" onClick={close} aria-label="채팅 닫기">
          ×
        </button>
      </header>

      <div className="chat-list" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>블로그 글을 바탕으로 답해 드려요.</p>
            <div className="chips">
              {suggestions.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} message={m} />
        ))}
        {status === "submitted" && <div className="msg msg-bot typing">글을 찾아보는 중…</div>}

        {aiDown && !lastText && last?.role === "assistant" && (
          <div className="notice">
            <p>AI 답변은 지금 어려워요. 대신 관련 글이에요.</p>
            <SourceCards sources={uniqueByPost(last.metadata?.sources ?? []).slice(0, 3)} />
          </div>
        )}
        {aiDown && lastText && (
          <div className="notice">
            <p>답변이 중간에 끊겼어요.</p>
            <button type="button" className="retry" onClick={() => void regenerate()}>
              다시 시도
            </button>
          </div>
        )}
        {errorMessage(error) && <div className="notice">{errorMessage(error)}</div>}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <label htmlFor="q" className="sr-only">
          질문 입력
        </label>
        <input
          id="q"
          value={input}
          maxLength={MAX_CHARS}
          onChange={(e) => setInput(e.target.value)}
          placeholder="무엇이든 물어보세요"
          autoComplete="off"
        />
        <button type="submit" disabled={busy || !input.trim()}>
          보내기
        </button>
      </form>
      <p className="chat-disclaimer">블로그 글을 바탕으로 AI가 답해요. 틀릴 수 있어요. 개인정보는 입력하지 마세요.</p>
    </div>
  );
}
