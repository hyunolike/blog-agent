import type { Redis } from "@upstash/redis";

export type FlagStore = {
  isFreeExhausted(): Promise<boolean>;
  markFreeExhausted(resetAtMs: number | null): Promise<void>;
};

const KEY = "free-exhausted";

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** OpenRouter의 X-RateLimit-Reset(ms 또는 s)으로 무료 소진 표시를 얼마나 둘지 정한다. */
export function exhaustTtlMs(resetAtMs: number | null, now: number): number {
  let reset = resetAtMs;
  if (reset !== null && reset < 1e12) reset *= 1000;
  const wanted = reset === null ? 60_000 : reset - now;
  return Math.ceil(Math.min(Math.max(wanted, 1000), nextUtcMidnight(now) - now));
}

export function createMemoryFlags(now: () => number = Date.now): FlagStore {
  let until = 0;
  return {
    async isFreeExhausted() {
      return now() < until;
    },
    async markFreeExhausted(resetAtMs) {
      until = now() + exhaustTtlMs(resetAtMs, now());
    },
  };
}

export function createRedisFlags(redis: Redis): FlagStore {
  return {
    async isFreeExhausted() {
      return (await redis.get(KEY)) !== null;
    },
    async markFreeExhausted(resetAtMs) {
      await redis.set(KEY, "1", { px: exhaustTtlMs(resetAtMs, Date.now()) });
    },
  };
}
