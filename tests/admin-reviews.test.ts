import { describe, expect, it, vi } from "vitest";
import { sessionCookieName, signSession, type AdminEnv } from "@/lib/admin/auth";
import { handleReviewsGet, handleReviewsPost, type ReviewDeps } from "@/lib/admin/reviews";
import { createMemoryFeedbackStore, FEEDBACK_TTL, type FeedbackRecord } from "@/lib/feedback";

const ORIGIN = "https://chat.example.dev";
const env: AdminEnv = { clientId: "c", clientSecret: "s", sessionSecret: "k".repeat(32), adminIds: [7], appOrigin: ORIGIN };
const NOW = Date.parse("2026-11-24T12:00:00.000Z");
const A = "3f2b8c1e-0000-4000-8000-000000000001";
const B = "9a8b7c6d-0000-4000-8000-000000000002";
const C = "11112222-0000-4000-8000-000000000003";

const rec = (responseId: string, over: Partial<FeedbackRecord> = {}): FeedbackRecord => ({
  responseId,
  rating: "down",
  reason: "retrieval",
  ratedAt: "2026-11-24T01:00:00.000Z",
  question: "점검 플래그 어디에 뒀어?",
  history: [
    { role: "user", text: "이전 질문" },
    { role: "assistant", text: "이전 답변" },
  ],
  answer: "답변[1]",
  chunkIds: ["70-1"],
  postIds: [70, 99],
  currentPostId: 70,
  model: "m/a",
  promptVersion: "abcd1234",
  createdAt: "2026-11-24T00:59:00.000Z",
  ...over,
});

async function setup(records: FeedbackRecord[] = [rec(A), rec(B, { ratedAt: "2026-11-24T02:00:00.000Z" })]) {
  const store = createMemoryFeedbackStore(() => NOW);
  for (const r of records) await store.saveFeedback(r);
  const log = vi.fn();
  const deps: ReviewDeps = {
    env,
    store,
    allowedOrigins: [ORIGIN],
    posts: () => [
      { id: 70, title: "점검 페이지", url: "https://hyunolike.tistory.com/70" },
      { id: 80, title: "Redis 캐시", url: "https://hyunolike.tistory.com/80" },
    ],
    evalIds: () => new Set(["q-01"]),
    log,
    now: () => NOW,
  };
  return { store, deps, log };
}

const session = (sub = 7, exp = NOW / 1000 + 60) => `${sessionCookieName(env)}=${signSession(env, { sub, login: "me", exp })}`;
const get = (cookie?: string) => new Request(`${ORIGIN}/api/admin/reviews`, { headers: cookie ? { cookie } : {} });
const post = (body: unknown, opts: { cookie?: string; origin?: string } = {}) =>
  new Request(`${ORIGIN}/api/admin/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: opts.origin ?? ORIGIN, ...(opts.cookie === undefined ? { cookie: session() } : opts.cookie ? { cookie: opts.cookie } : {}) },
    body: JSON.stringify(body),
  });

describe("GET /api/admin/reviews", () => {
  it("needs a valid session", async () => {
    const { deps } = await setup();
    expect((await handleReviewsGet(get(), deps)).status).toBe(401);
    expect((await handleReviewsGet(get(session(8)), deps)).status).toBe(401);
    expect((await handleReviewsGet(get(session(7, NOW / 1000 - 1)), deps)).status).toBe(401);
  });

  it("lists unreviewed down ratings newest first with post titles", async () => {
    const { deps } = await setup([rec(A), rec(B, { ratedAt: "2026-11-24T02:00:00.000Z" }), rec(C, { rating: "up", reason: undefined })]);
    const { items } = (await (await handleReviewsGet(get(session()), deps)).json()) as { items: { responseId: string }[] };
    expect(items.map((i) => i.responseId)).toEqual([B, A]);
    expect(items[1]).toMatchObject({
      previousQuestions: ["이전 질문"],
      retrievedPosts: [
        { id: 70, title: "점검 페이지", url: "https://hyunolike.tistory.com/70" },
        { id: 99, title: null, url: null },
      ],
      currentPost: { id: 70, title: "점검 페이지" },
    });
  });

  it("hides ratings already in the deployed eval set", async () => {
    const { deps } = await setup();
    deps.evalIds = () => new Set(["fb-3f2b8c1e"]);
    const { items } = (await (await handleReviewsGet(get(session()), deps)).json()) as { items: { responseId: string }[] };
    expect(items.map((i) => i.responseId)).toEqual([B]);
  });
});

describe("POST /api/admin/reviews", () => {
  it("approves with a snapshot and drops the item from the list", async () => {
    const { deps, store, log } = await setup();
    const res = await handleReviewsPost(post({ responseId: A, action: "approve", expectedPostIds: [80, 70, 80] }), deps);
    expect(res.status).toBe(200);
    expect(await store.getReview(A)).toEqual({
      action: "approve",
      expectedPostIds: [80, 70],
      reviewedBy: 7,
      reviewedAt: "2026-11-24T12:00:00.000Z",
      question: "점검 플래그 어디에 뒀어?",
      history: ["이전 질문"],
      currentPostId: 70,
    });
    const { items } = (await (await handleReviewsGet(get(session()), deps)).json()) as { items: { responseId: string }[] };
    expect(items.map((i) => i.responseId)).toEqual([B]);
    expect(log).toHaveBeenCalledWith({ event: "admin_review", id: 7, responseId: A, action: "approve" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("점검 플래그");
  });

  it("stores a dismissal with no posts", async () => {
    const { deps, store } = await setup();
    expect((await handleReviewsPost(post({ responseId: A, action: "dismiss", expectedPostIds: [70] }), deps)).status).toBe(200);
    expect(await store.getReview(A)).toMatchObject({ action: "dismiss", expectedPostIds: [] });
  });

  it("rejects bad sessions, origins and bodies", async () => {
    const { deps } = await setup();
    expect((await handleReviewsPost(post({ responseId: A, action: "dismiss" }, { cookie: "" }), deps)).status).toBe(401);
    expect((await handleReviewsPost(post({ responseId: A, action: "dismiss" }, { origin: "https://evil.example" }), deps)).status).toBe(403);
    expect((await handleReviewsPost(post({ responseId: "nope", action: "dismiss" }), deps)).status).toBe(400);
    expect((await handleReviewsPost(post({ responseId: A, action: "approve" }), deps)).status).toBe(400);
    expect((await handleReviewsPost(post({ responseId: A, action: "approve", expectedPostIds: [12345] }), deps)).status).toBe(400);
    expect((await handleReviewsPost(post({ responseId: A, action: "approve", expectedPostIds: Array.from({ length: 11 }, (_, i) => i + 1) }), deps)).status).toBe(400);
  });

  it("returns 404 for unknown or thumbs-up records and 409 on a second review", async () => {
    const { deps } = await setup([rec(A), rec(C, { rating: "up", reason: undefined })]);
    expect((await handleReviewsPost(post({ responseId: B, action: "dismiss" }), deps)).status).toBe(404);
    expect((await handleReviewsPost(post({ responseId: C, action: "dismiss" }), deps)).status).toBe(404);
    expect((await handleReviewsPost(post({ responseId: A, action: "dismiss" }), deps)).status).toBe(200);
    expect((await handleReviewsPost(post({ responseId: A, action: "approve", expectedPostIds: [70] }), deps)).status).toBe(409);
  });

  it("returns 503 when the index or the store is unavailable", async () => {
    const { deps, store } = await setup();
    expect((await handleReviewsPost(post({ responseId: A, action: "approve", expectedPostIds: [70] }), { ...deps, posts: () => null })).status).toBe(503);
    vi.spyOn(store, "saveReview").mockRejectedValueOnce(new Error("redis down"));
    expect((await handleReviewsPost(post({ responseId: A, action: "dismiss" }), deps)).status).toBe(503);
  });
});

describe("memory store reviews", () => {
  it("keeps reviews longer than feedback records", async () => {
    let t = 0;
    const store = createMemoryFeedbackStore(() => t);
    await store.saveFeedback(rec(A));
    await store.saveReview(A, { action: "dismiss", expectedPostIds: [], reviewedBy: 7, reviewedAt: "x", question: "q", history: [], currentPostId: null });
    t = FEEDBACK_TTL.feedbackSec * 1000;
    expect(await store.getFeedback(A)).toBeNull();
    expect(await store.listFeedback()).toEqual([]);
    expect(await store.listReviews()).toHaveLength(1);
    t = FEEDBACK_TTL.reviewSec * 1000;
    expect(await store.listReviews()).toEqual([]);
  });
});
