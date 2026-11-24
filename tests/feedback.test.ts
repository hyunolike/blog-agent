import { describe, expect, it, vi } from "vitest";
import { createMemoryFeedbackStore, createRedisFeedbackStore, FEEDBACK_TTL, handleFeedback, type FeedbackDeps, type ResponseContext } from "@/lib/feedback";
import { newCandidates, planExport, summarize, toCandidate } from "@/eval/feedback";

const ORIGIN = "https://chat.example.dev";
const ID = "3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f";

const ctx: ResponseContext = {
  question: "점검 플래그 어디에 뒀어?",
  history: [
    { role: "user", text: "이전 질문" },
    { role: "assistant", text: "이전 답변" },
  ],
  answer: "Edge Config에 뒀어요 [1]",
  chunkIds: ["70-1"],
  postIds: [70],
  currentPostId: null,
  model: "m/a",
  promptVersion: "abcd1234",
  createdAt: "2026-11-24T00:00:00.000Z",
};

async function setup(over: Partial<FeedbackDeps> = {}) {
  const store = createMemoryFeedbackStore();
  await store.saveContext(ID, ctx);
  const deps: FeedbackDeps = {
    store,
    limiter: { limit: async () => ({ success: true, reset: 0 }) },
    allowedOrigins: [ORIGIN],
    log: () => {},
    now: () => Date.parse("2026-11-24T01:00:00.000Z"),
    ...over,
  };
  return deps;
}

const post = (body: unknown, origin = ORIGIN) =>
  new Request(`${ORIGIN}/api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-real-ip": "1.2.3.4" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("handleFeedback", () => {
  it("stores a down rating with its reason and the response context", async () => {
    const deps = await setup();
    const res = await handleFeedback(post({ responseId: ID, rating: "down", reason: "retrieval" }), deps);
    expect(res.status).toBe(200);
    const [rec] = await deps.store.listFeedback();
    expect(rec).toMatchObject({ ...ctx, responseId: ID, rating: "down", reason: "retrieval", ratedAt: "2026-11-24T01:00:00.000Z" });
  });

  it("stores no reason for up and treats a missing down reason as other", async () => {
    const deps = await setup();
    await handleFeedback(post({ responseId: ID, rating: "up", reason: "wrong" }), deps);
    expect((await deps.store.listFeedback())[0]!.reason).toBeUndefined();
    await handleFeedback(post({ responseId: ID, rating: "down" }), deps);
    const all = await deps.store.listFeedback();
    expect(all).toHaveLength(1); // 같은 응답은 덮어쓴다
    expect(all[0]).toMatchObject({ rating: "down", reason: "other" });
  });

  it("rejects other origins, bad bodies, and unknown responses", async () => {
    const deps = await setup();
    expect((await handleFeedback(post({ responseId: ID, rating: "up" }, "https://evil.example"), deps)).status).toBe(403);
    for (const body of ["{", { responseId: "x", rating: "up" }, { responseId: ID, rating: "meh" }, { responseId: ID, rating: "down", reason: "bad" }, { responseId: ID, rating: "up", pad: "x".repeat(2000) }]) {
      expect((await handleFeedback(post(body), deps)).status).toBe(400);
    }
    const res = await handleFeedback(post({ responseId: "00000000-0000-4000-8000-000000000000", rating: "up" }), deps);
    expect(res.status).toBe(404);
    expect(await deps.store.listFeedback()).toHaveLength(0);
  });

  it("rate limits per IP", async () => {
    const limit = vi.fn(async () => ({ success: false, reset: Date.parse("2026-11-24T01:00:10.000Z") }));
    const deps = await setup({ limiter: { limit } });
    const res = await handleFeedback(post({ responseId: ID, rating: "up" }), deps);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("10");
    expect(limit).toHaveBeenCalledWith("1.2.3.4");
  });

  it("returns 503 and logs when the store fails", async () => {
    const log = vi.fn();
    const deps = await setup({ log });
    deps.store.saveFeedback = async () => {
      throw new Error("redis down");
    };
    expect((await handleFeedback(post({ responseId: ID, rating: "up" }), deps)).status).toBe(503);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "feedback_error" }));
  });
});

describe("memory feedback store", () => {
  it("forgets contexts after a day", async () => {
    let t = 0;
    const store = createMemoryFeedbackStore(() => t);
    await store.saveContext(ID, ctx);
    t = FEEDBACK_TTL.contextSec * 1000 - 1;
    expect(await store.getContext(ID)).not.toBeNull();
    t += 1;
    expect(await store.getContext(ID)).toBeNull();
  });
});

describe("feedback export", () => {
  const rec = (over: object) => ({ ...ctx, responseId: ID, rating: "down" as const, ratedAt: "2026-11-24T01:00:00.000Z", ...over });

  it("summarizes ratings and reasons per group", () => {
    const rows = summarize([rec({ rating: "up" }), rec({ reason: "wrong" }), rec({ reason: "wrong" }), rec({ model: "m/b", reason: "retrieval" })], (r) => r.model ?? "");
    expect(rows).toEqual([
      { group: "m/a", up: 1, down: 2, reasons: { wrong: 2 } },
      { group: "m/b", up: 0, down: 1, reasons: { retrieval: 1 } },
    ]);
  });

  it("turns a down rating into an eval question candidate", () => {
    expect(toCandidate(rec({ reason: "citation", currentPostId: 70 }))).toEqual({
      id: "fb-3f2b8c1e",
      type: "followup",
      question: ctx.question,
      history: ["이전 질문"],
      currentPostId: 70,
      expectedPostIds: [],
      feedback: { reason: "citation", answer: ctx.answer, retrievedPostIds: [70], chunkIds: ["70-1"], model: "m/a", promptVersion: "abcd1234", ratedAt: "2026-11-24T01:00:00.000Z" },
    });
    expect(toCandidate(rec({ history: [] }))).toMatchObject({ type: "single" });
    expect(toCandidate(rec({ history: [], currentPostId: 70 }))).toMatchObject({ type: "current", currentPostId: 70 });
    expect(toCandidate(rec({ history: [] }))).not.toHaveProperty("history");
  });

  it("leaves out candidates already moved to the eval set", () => {
    const other = "9a8b7c6d-0000-4000-8000-000000000000";
    const { fresh, skipped } = newCandidates([rec({}), rec({ responseId: other })], new Set(["fb-3f2b8c1e", "q-01"]));
    expect(fresh.map((c) => c.id)).toEqual(["fb-9a8b7c6d"]);
    expect(skipped).toBe(1);
  });
});

describe("approved review export", () => {
  const review = (responseId: string, over: object = {}) => ({
    responseId,
    action: "approve" as const,
    expectedPostIds: [70],
    reviewedBy: 7,
    reviewedAt: "2026-11-24T12:00:00.000Z",
    question: "점검 플래그 어디에 뒀어?",
    history: [] as string[],
    currentPostId: null as number | null,
    ...over,
  });
  const A = "3f2b8c1e-0000-4000-8000-000000000001";
  const B = "9a8b7c6d-0000-4000-8000-000000000002";

  it("turns approvals into eval questions from the snapshot only", () => {
    const { added, already, warnings } = planExport(
      [review(A, { history: ["이전 질문"], currentPostId: 70 }), review(B, { action: "dismiss", expectedPostIds: [] })],
      new Set(),
      new Set([70]),
    );
    expect(added).toEqual([{ id: "fb-3f2b8c1e", type: "followup", question: "점검 플래그 어디에 뒀어?", history: ["이전 질문"], currentPostId: 70, expectedPostIds: [70] }]);
    expect(added[0]).not.toHaveProperty("feedback");
    expect({ already, warnings }).toEqual({ already: 0, warnings: [] });
  });

  it("adds each approval once across runs", () => {
    const first = planExport([review(A)], new Set(["q-01"]), new Set([70]));
    const second = planExport([review(A)], new Set(["q-01", ...first.added.map((q) => q.id)]), new Set([70]));
    expect(first.added).toHaveLength(1);
    expect(second).toEqual({ added: [], already: 1, warnings: [] });
  });

  it("skips posts missing from the index and colliding ids", () => {
    const twin = "3f2b8c1e-ffff-4000-8000-000000000009";
    const { added, warnings } = planExport([review(A), review(twin, { reviewedAt: "2026-11-25T00:00:00.000Z" }), review(B, { expectedPostIds: [999] })], new Set(), new Set([70]));
    expect(added.map((q) => q.id)).toEqual(["fb-3f2b8c1e"]);
    expect(warnings).toHaveLength(2);
  });
});

describe("redis review store", () => {
  const review = { action: "dismiss" as const, expectedPostIds: [], reviewedBy: 7, reviewedAt: "2026-11-24T12:00:00.000Z", question: "q", history: [], currentPostId: null };
  const fakeRedis = (over: Record<string, unknown>) =>
    ({ set: vi.fn(async () => "OK"), zadd: vi.fn(async () => 1), del: vi.fn(async () => 1), ...over }) as unknown as Parameters<typeof createRedisFeedbackStore>[0];

  it("writes with NX and reports an existing review", async () => {
    const redis = fakeRedis({ set: vi.fn(async () => null) });
    expect(await createRedisFeedbackStore(redis).saveReview(ID, review)).toBe(false);
    expect((redis as unknown as { set: ReturnType<typeof vi.fn> }).set).toHaveBeenCalledWith(`fb:rev:${ID}`, review, { ex: FEEDBACK_TTL.reviewSec, nx: true });
    expect((redis as unknown as { zadd: ReturnType<typeof vi.fn> }).zadd).not.toHaveBeenCalled();
  });

  it("rolls the review back when the index write fails", async () => {
    const redis = fakeRedis({ zadd: vi.fn(async () => { throw new Error("down"); }) });
    await expect(createRedisFeedbackStore(redis).saveReview(ID, review)).rejects.toThrow("down");
    expect((redis as unknown as { del: ReturnType<typeof vi.fn> }).del).toHaveBeenCalledWith(`fb:rev:${ID}`);
  });
});
