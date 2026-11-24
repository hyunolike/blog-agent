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

export type FeedbackStore = {
  saveContext(responseId: string, ctx: ResponseContext): Promise<void>;
  getContext(responseId: string): Promise<ResponseContext | null>;
  saveFeedback(record: FeedbackRecord): Promise<void>;
  listFeedback(): Promise<FeedbackRecord[]>;
};

export const FEEDBACK_TTL = { contextSec: 86_400, feedbackSec: 90 * 86_400 };
export const FEEDBACK_LIMIT = { ipPerDay: 100 };

const ctxKey = (id: string) => `fb:ctx:${id}`;
const recordKey = (id: string) => `fb:rec:${id}`;
const INDEX_KEY = "fb:index";

/** Upstash 설정이 없는 로컬 개발과 테스트용. 서버리스 인스턴스 사이에서는 공유되지 않는다. */
export function createMemoryFeedbackStore(now: () => number = Date.now): FeedbackStore {
  const contexts = new Map<string, { ctx: ResponseContext; expiresAt: number }>();
  const records = new Map<string, FeedbackRecord>();
  return {
    async saveContext(id, ctx) {
      contexts.set(id, { ctx, expiresAt: now() + FEEDBACK_TTL.contextSec * 1000 });
    },
    async getContext(id) {
      const hit = contexts.get(id);
      return hit && hit.expiresAt > now() ? hit.ctx : null;
    },
    async saveFeedback(record) {
      records.set(record.responseId, record);
    },
    async listFeedback() {
      return [...records.values()];
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
    async listFeedback() {
      const ids = await redis.zrange<string[]>(INDEX_KEY, 0, -1);
      if (ids.length === 0) return [];
      const recs = await redis.mget<(FeedbackRecord | null)[]>(...ids.map(recordKey));
      // 90일이 지나 본문이 만료된 ID는 목록에서도 지운다
      const expired = ids.filter((_, i) => !recs[i]);
      if (expired.length > 0) await redis.zrem(INDEX_KEY, ...expired);
      return recs.filter((r): r is FeedbackRecord => r !== null);
    },
  };
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
