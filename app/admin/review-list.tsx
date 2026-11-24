"use client";

import { useMemo, useState } from "react";
import type { PostInfo, PostRef, ReviewItem } from "@/lib/admin/reviews";

const REASONS: Record<string, string> = {
  retrieval: "관련 글을 못 찾음",
  wrong: "내용이 틀림",
  citation: "출처가 없거나 틀림",
  other: "기타",
};

const ERRORS: Record<string, string> = {
  unauthorized: "로그인이 만료됐어요. 새로고침해서 다시 로그인해 주세요.",
  conflict: "이미 검토한 평가예요.",
  not_found: "평가 기록이 만료됐거나 없어요.",
  invalid: "정답 글을 1~10개 골라 주세요.",
};

export function ReviewList({ initial, posts }: { initial: ReviewItem[]; posts: PostInfo[] | null }) {
  const [items, setItems] = useState(initial);
  if (items.length === 0) return <p className="admin-empty">검토할 👎가 없어요.</p>;
  return (
    <>
      <p className="admin-count">검토할 👎 {items.length}건</p>
      {!posts && <p className="admin-error">글 인덱스를 읽지 못했어요. 승인은 잠시 막아 뒀어요.</p>}
      <ol className="admin-list">
        {items.map((item) => (
          <li key={item.responseId}>
            <ReviewCard item={item} posts={posts} onDone={() => setItems((xs) => xs.filter((x) => x.responseId !== item.responseId))} />
          </li>
        ))}
      </ol>
    </>
  );
}

function PostLink({ post }: { post: PostRef }) {
  if (!post.url) return <span className="muted">(인덱스에 없는 글 #{post.id})</span>;
  return (
    <a href={post.url} target="_blank" rel="noreferrer">
      {post.title}
    </a>
  );
}

function ReviewCard({ item, posts, onDone }: { item: ReviewItem; posts: PostInfo[] | null; onDone: () => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleOf = useMemo(() => new Map((posts ?? []).map((p) => [p.id, p.title])), [posts]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !posts) return [];
    return posts.filter((p) => p.title.toLowerCase().includes(q) && !picked.includes(p.id)).slice(0, 8);
  }, [query, posts, picked]);

  const toggle = (id: number) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  async function send(action: "approve" | "dismiss") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ responseId: item.responseId, action, ...(action === "approve" ? { expectedPostIds: picked } : {}) }),
      });
      if (res.ok) return onDone();
      const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
      setError(ERRORS[code ?? ""] ?? "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } catch {
      setError("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  const retrievedIds = item.retrievedPosts.map((p) => p.id);
  const extra = picked.filter((id) => !retrievedIds.includes(id));

  return (
    <article className="card">
      <div className="card-meta">
        <span className="tag">{REASONS[item.reason ?? "other"] ?? item.reason}</span>
        <time dateTime={item.ratedAt}>{new Date(item.ratedAt).toLocaleString("ko-KR")}</time>
        <span className="muted">
          {item.model ?? "모델 미상"} · 프롬프트 {item.promptVersion}
        </span>
      </div>
      {item.previousQuestions.length > 0 && (
        <ul className="prev">
          {item.previousQuestions.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      )}
      <p className="question">{item.question}</p>
      <details className="answer">
        <summary>챗봇 답변 보기</summary>
        <p>{item.answer}</p>
      </details>
      {item.currentPost && (
        <p className="muted">
          보고 있던 글: <PostLink post={item.currentPost} />
        </p>
      )}

      <fieldset className="pick" disabled={busy}>
        <legend>정답 글 고르기</legend>
        <p className="muted">그때 검색된 글</p>
        {item.retrievedPosts.length === 0 && <p className="muted">검색된 글이 없었어요.</p>}
        {item.retrievedPosts.map((p) => (
          <label key={p.id} className="pick-row">
            <input type="checkbox" checked={picked.includes(p.id)} disabled={!p.url} onChange={() => toggle(p.id)} />
            <PostLink post={p} />
          </label>
        ))}
        {extra.map((id) => (
          <label key={id} className="pick-row">
            <input type="checkbox" checked onChange={() => toggle(id)} />
            <span>{titleOf.get(id) ?? `#${id}`}</span>
          </label>
        ))}
        <label className="search">
          <span className="muted">다른 글 찾기</span>
          <input id={`search-${item.responseId}`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목으로 검색" disabled={!posts} />
        </label>
        {matches.length > 0 && (
          <ul className="matches">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => (toggle(p.id), setQuery(""))}>
                  {p.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {error && <p className="admin-error">{error}</p>}
      <div className="actions">
        <button className="admin-btn primary" type="button" disabled={busy || !posts || picked.length === 0 || picked.length > 10} onClick={() => send("approve")}>
          승인 ({picked.length})
        </button>
        <button className="admin-btn" type="button" disabled={busy} onClick={() => send("dismiss")}>
          제외
        </button>
      </div>
    </article>
  );
}
