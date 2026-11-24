import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { createMemoryFeedbackStore, createRedisFeedbackStore, FEEDBACK_LIMIT, type FeedbackStore } from "./feedback";
import type { Limiter } from "./limits";

// Redis가 없을 때 채팅과 평가 라우트가 같은 메모리 저장소를 보도록 전역에 하나만 둔다(로컬 개발용).
// 라우트마다 번들이 따로 만들어져도 globalThis는 같은 프로세스에서 공유된다.
const g = globalThis as { __blogAgentFeedbackStore?: FeedbackStore };

export function sharedFeedbackStore(redis: Redis | null): FeedbackStore {
  if (redis) return createRedisFeedbackStore(redis);
  g.__blogAgentFeedbackStore ??= createMemoryFeedbackStore();
  return g.__blogAgentFeedbackStore;
}

export function feedbackLimiter(redis: Redis | null): Limiter {
  if (redis) return new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(FEEDBACK_LIMIT.ipPerDay, "1 d"), prefix: "rl:fb:d" });
  const hits = new Map<string, { day: number; count: number }>();
  return {
    async limit(key) {
      const day = Math.floor(Date.now() / 86_400_000);
      const cur = hits.get(key);
      const entry = cur && cur.day === day ? cur : { day, count: 0 };
      entry.count += 1;
      hits.set(key, entry);
      return { success: entry.count <= FEEDBACK_LIMIT.ipPerDay, reset: (day + 1) * 86_400_000 };
    },
  };
}
