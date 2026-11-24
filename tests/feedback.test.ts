import { describe, expect, it, vi } from "vitest";
import { createMemoryFeedbackStore, FEEDBACK_TTL, handleFeedback, type FeedbackDeps, type ResponseContext } from "@/lib/feedback";
import { summarize, toCandidate } from "@/eval/feedback";

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
});
