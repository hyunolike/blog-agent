import { z } from "zod";
import type { FeedbackRecord, FeedbackStore, Review } from "../feedback";
import type { AdminEnv, Session } from "./auth";
import { sessionOf } from "./auth";

export type PostRef = { id: number; title: string | null; url: string | null };
export type PostInfo = { id: number; title: string; url: string };

export type ReviewItem = {
  responseId: string;
  question: string;
  previousQuestions: string[];
  answer: string;
  reason: string | undefined;
  model: string | undefined;
  promptVersion: string;
  ratedAt: string;
  retrievedPosts: PostRef[];
  currentPost: PostRef | null;
};

/** 평가셋 후보와 같은 ID 규칙(eval/feedback.ts의 toCandidate) */
export const evalIdOf = (responseId: string) => `fb-${responseId.slice(0, 8)}`;

export type ReviewDeps = {
  env: AdminEnv;
  store: FeedbackStore;
  allowedOrigins: string[];
  /** 배포에 포함된 글 인덱스. 읽지 못하면 null */
  posts: () => PostInfo[] | null;
  /** 배포에 포함된 eval/questions.jsonl의 ID */
  evalIds: () => Set<string>;
  log(entry: Record<string, unknown>): void;
  now?: () => number;
};

const ref = (byId: Map<number, PostInfo>, id: number): PostRef => {
  const p = byId.get(id);
  return { id, title: p?.title ?? null, url: p?.url ?? null };
};

/** 검토할 👎: 아직 검토하지 않았고 평가셋에도 없는 것, 최근 평가부터 */
export async function pendingReviews(deps: ReviewDeps): Promise<ReviewItem[]> {
  const [records, reviews] = await Promise.all([deps.store.listFeedback(), deps.store.listReviews()]);
  const reviewed = new Set(reviews.map((r) => r.responseId));
  const inEval = deps.evalIds();
  const byId = new Map((deps.posts() ?? []).map((p) => [p.id, p]));
  return records
    .filter((r) => r.rating === "down" && !reviewed.has(r.responseId) && !inEval.has(evalIdOf(r.responseId)))
    .sort((a, b) => b.ratedAt.localeCompare(a.ratedAt))
    .map((r) => ({
      responseId: r.responseId,
      question: r.question,
      previousQuestions: r.history.filter((m) => m.role === "user").map((m) => m.text),
      answer: r.answer,
      reason: r.reason,
      model: r.model,
      promptVersion: r.promptVersion,
      ratedAt: r.ratedAt,
      retrievedPosts: r.postIds.map((id) => ref(byId, id)),
      currentPost: r.currentPostId === null ? null : ref(byId, r.currentPostId),
    }));
}

const bodySchema = z.object({
  responseId: z.string().uuid(),
  action: z.enum(["approve", "dismiss"]),
  expectedPostIds: z.array(z.number().int().positive()).optional(),
});

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

function authorize(req: Request, deps: ReviewDeps): Session | null {
  return sessionOf(deps.env, req, Math.floor((deps.now?.() ?? Date.now()) / 1000));
}

export async function handleReviewsGet(req: Request, deps: ReviewDeps): Promise<Response> {
  if (!authorize(req, deps)) return json(401, { error: "unauthorized" });
  try {
    return json(200, { items: await pendingReviews(deps) });
  } catch (err) {
    deps.log({ event: "admin_review_error", error: err instanceof Error ? err.message : String(err) });
    return json(503, { error: "unavailable" });
  }
}

function snapshot(r: FeedbackRecord): Pick<Review, "question" | "history" | "currentPostId"> {
  return { question: r.question, history: r.history.filter((m) => m.role === "user").map((m) => m.text), currentPostId: r.currentPostId };
}

export async function handleReviewsPost(req: Request, deps: ReviewDeps): Promise<Response> {
  const session = authorize(req, deps);
  if (!session) return json(401, { error: "unauthorized" });
  if (!deps.allowedOrigins.includes(req.headers.get("origin") ?? "")) return json(403, { error: "forbidden" });
  const raw = await req.text();
  if (raw.length > 1024) return json(400, { error: "invalid" });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(JSON.parse(raw));
  } catch {
    return json(400, { error: "invalid" });
  }

  let expectedPostIds: number[] = [];
  if (body.action === "approve") {
    expectedPostIds = [...new Set(body.expectedPostIds ?? [])];
    if (expectedPostIds.length === 0 || expectedPostIds.length > 10) return json(400, { error: "invalid" });
    const posts = deps.posts();
    if (!posts) return json(503, { error: "unavailable" });
    const known = new Set(posts.map((p) => p.id));
    if (expectedPostIds.some((id) => !known.has(id))) return json(400, { error: "invalid" });
  }

  try {
    const record = await deps.store.getFeedback(body.responseId);
    if (!record || record.rating !== "down") return json(404, { error: "not_found" });
    // 검토는 한 번으로 끝난다. 내보낸 평가셋과 Redis가 서로 달라지지 않게 한다
    const reviewedAt = new Date(deps.now?.() ?? Date.now()).toISOString();
    const saved = await deps.store.saveReview(body.responseId, { action: body.action, expectedPostIds, reviewedBy: session.sub, reviewedAt, ...snapshot(record) });
    if (!saved) return json(409, { error: "conflict" });
    deps.log({ event: "admin_review", id: session.sub, responseId: body.responseId, action: body.action });
    return json(200, { ok: true });
  } catch (err) {
    deps.log({ event: "admin_review_error", error: err instanceof Error ? err.message : String(err) });
    return json(503, { error: "unavailable" });
  }
}
