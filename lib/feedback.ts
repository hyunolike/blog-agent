import type { Redis } from "@upstash/redis";
import { z } from "zod";
import type { Limiter } from "./limits";

/** 답변 하나의 맥락. 저장하는 텍스트는 모두 개인정보 마스킹을 거친 것이다. */
export type ResponseContext = {
  question: string;
  history: { role: "user" | "assistant"; text: string }[];
  answer: string;
  chunkIds: string[];
  postIds: number[];
  currentPostId: number | null;
  model?: string;
  promptVersion: string;
  createdAt: string;
};

export const FEEDBACK_REASONS = ["retrieval", "wrong", "citation", "other"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
export type Rating = "up" | "down";
export type FeedbackRecord = ResponseContext & { responseId: string; rating: Rating; reason?: FeedbackReason; ratedAt: string };

/** 관리자 검토 결과. 평가 기록(90일)이 먼저 만료돼도 평가셋으로 내보낼 수 있게 질문을 스냅샷으로 둔다 */
export type Review = {
  action: "approve" | "dismiss";
  expectedPostIds: number[];
  reviewedBy: number;
  reviewedAt: string;
  question: string;
  history: string[];
  currentPostId: number | null;
};

export type FeedbackStore = {
  saveContext(responseId: string, ctx: ResponseContext): Promise<void>;
  getContext(responseId: string): Promise<ResponseContext | null>;
  saveFeedback(record: FeedbackRecord): Promise<void>;
  getFeedback(responseId: string): Promise<FeedbackRecord | null>;
  listFeedback(): Promise<FeedbackRecord[]>;
  getReview(responseId: string): Promise<Review | null>;
  saveReview(responseId: string, review: Review): Promise<void>;
  listReviews(): Promise<(Review & { responseId: string })[]>;
};

export const FEEDBACK_TTL = { contextSec: 86_400, feedbackSec: 90 * 86_400, reviewSec: 180 * 86_400 };
export const FEEDBACK_LIMIT = { ipPerDay: 100 };

const ctxKey = (id: string) => `fb:ctx:${id}`;
const recordKey = (id: string) => `fb:rec:${id}`;
const INDEX_KEY = "fb:index";
const reviewKey = (id: string) => `fb:rev:${id}`;
const REVIEW_INDEX_KEY = "fb:rev:index";

/** Upstash 설정이 없는 로컬 개발과 테스트용. 서버리스 인스턴스 사이에서는 공유되지 않는다. */
export function createMemoryFeedbackStore(now: () => number = Date.now): FeedbackStore {
  const contexts = new Map<string, { ctx: ResponseContext; expiresAt: number }>();
  const records = new Map<string, { record: FeedbackRecord; expiresAt: number }>();
  const reviews = new Map<string, { review: Review; expiresAt: number }>();
  const alive = <T extends { expiresAt: number }>(hit: T | undefined) => (hit && hit.expiresAt > now() ? hit : undefined);
  return {
    async saveContext(id, ctx) {
      contexts.set(id, { ctx, expiresAt: now() + FEEDBACK_TTL.contextSec * 1000 });
    },
    async getContext(id) {
      const hit = contexts.get(id);
      return hit && hit.expiresAt > now() ? hit.ctx : null;
    },
    async saveFeedback(record) {
      records.set(record.responseId, { record, expiresAt: now() + FEEDBACK_TTL.feedbackSec * 1000 });
    },
    async getFeedback(id) {
      return alive(records.get(id))?.record ?? null;
    },
    async listFeedback() {
      return [...records.values()].filter((h) => alive(h)).map((h) => h.record);
    },
    async getReview(id) {
      return alive(reviews.get(id))?.review ?? null;
    },
    async saveReview(id, review) {
      reviews.set(id, { review, expiresAt: now() + FEEDBACK_TTL.reviewSec * 1000 });
    },
    async listReviews() {
      return [...reviews.entries()].filter(([, h]) => alive(h)).map(([responseId, h]) => ({ ...h.review, responseId }));
    },
  };
}

export function createRedisFeedbackStore(redis: Redis): FeedbackStore {
  return {
    async saveContext(id, ctx) {
      await redis.set(ctxKey(id), ctx, { ex: FEEDBACK_TTL.contextSec });
    },
    async getContext(id) {
      return (await redis.get<ResponseContext>(ctxKey(id))) ?? null;
    },
    async saveFeedback(record) {
      await redis.set(recordKey(record.responseId), record, { ex: FEEDBACK_TTL.feedbackSec });
      await redis.zadd(INDEX_KEY, { score: Date.parse(record.ratedAt), member: record.responseId });
    },
    async getFeedback(id) {
      return (await redis.get<FeedbackRecord>(recordKey(id))) ?? null;
    },
    async listFeedback() {
      return listIndexed<FeedbackRecord>(redis, INDEX_KEY, recordKey);
    },
    async getReview(id) {
      return (await redis.get<Review>(reviewKey(id))) ?? null;
    },
    async saveReview(id, review) {
      await redis.set(reviewKey(id), review, { ex: FEEDBACK_TTL.reviewSec });
      await redis.zadd(REVIEW_INDEX_KEY, { score: Date.parse(review.reviewedAt), member: id });
    },
    async listReviews() {
      const ids = await redis.zrange<string[]>(REVIEW_INDEX_KEY, 0, -1);
      if (ids.length === 0) return [];
      const revs = await redis.mget<(Review | null)[]>(...ids.map(reviewKey));
      const expired = ids.filter((_, i) => !revs[i]);
      if (expired.length > 0) await redis.zrem(REVIEW_INDEX_KEY, ...expired);
      return ids.flatMap((responseId, i) => (revs[i] ? [{ ...revs[i]!, responseId }] : []));
    },
  };
}

/** 정렬 집합의 ID로 본문을 읽는다. 본문이 만료된 ID는 목록에서도 지운다 */
async function listIndexed<T>(redis: Redis, indexKey: string, keyOf: (id: string) => string): Promise<T[]> {
  const ids = await redis.zrange<string[]>(indexKey, 0, -1);
  if (ids.length === 0) return [];
  const values = await redis.mget<(T | null)[]>(...ids.map(keyOf));
  const expired = ids.filter((_, i) => !values[i]);
  if (expired.length > 0) await redis.zrem(indexKey, ...expired);
  return values.filter((v): v is T => v !== null);
}

export type FeedbackDeps = {
  store: FeedbackStore;
  limiter: Limiter;
  allowedOrigins: string[];
  log(entry: Record<string, unknown>): void;
  now?: () => number;
};

const bodySchema = z.object({
  responseId: z.string().uuid(),
  rating: z.enum(["up", "down"]),
  reason: z.enum(FEEDBACK_REASONS).optional(),
});

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) => Response.json(body, { status, headers });

function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function handleFeedback(req: Request, deps: FeedbackDeps): Promise<Response> {
  if (!deps.allowedOrigins.includes(req.headers.get("origin") ?? "")) {
    return json(403, { error: "forbidden" });
  }
  const raw = await req.text();
  if (raw.length > 1024) return json(400, { error: "invalid" });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(JSON.parse(raw));
  } catch {
    return json(400, { error: "invalid" });
  }

  const now = deps.now ?? Date.now;
  const limit = await deps.limiter.limit(clientIp(req));
  if (!limit.success) {
    const retryAfterSec = Math.max(1, Math.ceil((limit.reset - now()) / 1000));
    return json(429, { error: "rate_limited", retryAfterSec }, { "retry-after": String(retryAfterSec) });
  }

  try {
    const ctx = await deps.store.getContext(body.responseId);
    if (!ctx) return json(404, { error: "not_found" });
    // 👍에는 사유가 없다. 👎인데 사유가 없으면 기타로 본다
    const reason = body.rating === "down" ? (body.reason ?? "other") : undefined;
    await deps.store.saveFeedback({ ...ctx, responseId: body.responseId, rating: body.rating, ...(reason ? { reason } : {}), ratedAt: new Date(now()).toISOString() });
    deps.log({ event: "feedback", rating: body.rating, reason, model: ctx.model, promptVersion: ctx.promptVersion, postIds: ctx.postIds });
    return json(200, { ok: true });
  } catch (err) {
    deps.log({ event: "feedback_error", error: err instanceof Error ? err.message : String(err) });
    return json(503, { error: "unavailable" });
  }
}
