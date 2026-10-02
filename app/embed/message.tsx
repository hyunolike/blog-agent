"use client";

import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/atom-one-dark.css";
import { linkCitations } from "@/lib/citations";
import { BLOG_ORIGIN } from "@/lib/config";
import type { ChatUIMessage, SourceRef } from "@/lib/types";

export function MessageView({ message }: { message: ChatUIMessage }) {
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
