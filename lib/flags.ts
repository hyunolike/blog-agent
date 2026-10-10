import type { Redis } from "@upstash/redis";

export type FlagStore = {
  isPrimaryLimited(): Promise<boolean>;
  markPrimaryLimited(resetAtMs: number | null): Promise<void>;
};

const KEY = "primary-limited";

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** 응답의 X-RateLimit-Reset(ms 또는 s)으로 기본 모델을 얼마나 건너뛸지 정한다. 헤더가 없으면 1분이다. */
export function exhaustTtlMs(resetAtMs: number | null, now: number): number {
  let reset = resetAtMs;
  if (reset !== null && reset < 1e12) reset *= 1000;
  const wanted = reset === null ? 60_000 : reset - now;
  return Math.ceil(Math.min(Math.max(wanted, 1000), nextUtcMidnight(now) - now));
}

export function createMemoryFlags(now: () => number = Date.now): FlagStore {
  let until = 0;
  return {
    async isPrimaryLimited() {
      return now() < until;
    },
    async markPrimaryLimited(resetAtMs) {
      until = now() + exhaustTtlMs(resetAtMs, now());
    },
  };
}

export function createRedisFlags(redis: Redis): FlagStore {
  return {
    async isPrimaryLimited() {
      return (await redis.get(KEY)) !== null;
    },
    async markPrimaryLimited(resetAtMs) {
      await redis.set(KEY, "1", { px: exhaustTtlMs(resetAtMs, Date.now()) });
    },
  };
}
