"use client";

import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/atom-one-dark.css";
import { linkCitations } from "@/lib/citations";
import { useState } from "react";
import { BLOG_ORIGIN } from "@/lib/config";
import type { FeedbackReason, Rating } from "@/lib/feedback";
import type { ChatUIMessage, SourceRef } from "@/lib/types";

export type RateFn = (responseId: string, rating: Rating, reason?: FeedbackReason) => void;
type FeedbackProps = { done: boolean; rated: boolean; onRate: RateFn };

export function MessageView({ message, feedback }: { message: ChatUIMessage; feedback?: FeedbackProps }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  if (message.role === "user") return <div className="msg msg-user">{text}</div>;

  const sources = message.metadata?.sources ?? [];
  const { markdown, cited } = linkCitations(text, sources);
  const citedSources = uniqueByPost(sources.filter((s) => cited.includes(s.n)));

  return (
    <div className="msg msg-bot">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children }) => {
            const internal = href?.startsWith(BLOG_ORIGIN);
            return (
              <a href={href} target={internal ? "_top" : "_blank"} rel={internal ? undefined : "noopener noreferrer"}>
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
      {citedSources.length > 0 && <SourceCards sources={citedSources} />}
      {feedback?.done && message.metadata?.responseId && text.trim() && (
        <FeedbackButtons responseId={message.metadata.responseId} rated={feedback.rated} onRate={feedback.onRate} />
      )}
    </div>
  );
}

const REASONS: { value: FeedbackReason; label: string }[] = [
  { value: "retrieval", label: "관련 글을 못 찾았어요" },
  { value: "wrong", label: "내용이 틀렸어요" },
  { value: "citation", label: "출처가 없거나 틀렸어요" },
  { value: "other", label: "기타" },
];

function FeedbackButtons({ responseId, rated, onRate }: { responseId: string; rated: boolean; onRate: RateFn }) {
  const [choosing, setChoosing] = useState(false);
  if (rated) return <p className="feedback-thanks">의견 고마워요</p>;
  if (choosing) {
    return (
      <div className="feedback" role="group" aria-label="아쉬운 점">
        {REASONS.map((r) => (
          <button key={r.value} type="button" className="chip" onClick={() => onRate(responseId, "down", r.value)}>
            {r.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="feedback" role="group" aria-label="답변 평가">
      <button type="button" className="feedback-btn" aria-label="도움이 됐어요" onClick={() => onRate(responseId, "up")}>
        👍
      </button>
      <button type="button" className="feedback-btn" aria-label="아쉬워요" onClick={() => setChoosing(true)}>
        👎
      </button>
    </div>
  );
}

export function uniqueByPost(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<number>();
  return sources.filter((s) => (seen.has(s.postId) ? false : (seen.add(s.postId), true)));
}

export function SourceCards({ sources }: { sources: SourceRef[] }) {
  return (
    <ul className="sources" aria-label="출처">
      {sources.map((s) => (
        <li key={s.postId}>
          <a href={s.url} target="_top">
            <span className="source-title">{s.title}</span>
            {s.section && <span className="source-section">{s.section}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}
