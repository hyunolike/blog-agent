import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";

export type Limiter = { limit(key: string): Promise<{ success: boolean; reset: number }> };
export type Limiters = { ipMinute: Limiter; ipDay: Limiter; globalDay: Limiter };
export type LimitResult = { ok: true } | { ok: false; scope: "ip" | "global"; retryAfterSec: number };

export const LIMITS = { ipPerMinute: 10, ipPerDay: 50, globalPerDay: 500 };

const retryAfter = (reset: number, now: number) => Math.max(1, Math.ceil((reset - now) / 1000));

export async function checkLimits(l: Limiters, ip: string, now = Date.now()): Promise<LimitResult> {
  for (const limiter of [l.ipMinute, l.ipDay]) {
    const r = await limiter.limit(ip);
    if (!r.success) return { ok: false, scope: "ip", retryAfterSec: retryAfter(r.reset, now) };
  }
  const g = await l.globalDay.limit("all");
  if (!g.success) return { ok: false, scope: "global", retryAfterSec: retryAfter(g.reset, now) };
  return { ok: true };
}

function memoryWindow(max: number, windowMs: number, now: () => number): Limiter {
  const hits = new Map<string, { start: number; count: number }>();
  return {
    async limit(key) {
      const t = now();
      const start = Math.floor(t / windowMs) * windowMs;
      const cur = hits.get(key);
      const entry = cur && cur.start === start ? cur : { start, count: 0 };
      entry.count += 1;
      hits.set(key, entry);
      return { success: entry.count <= max, reset: start + windowMs };
    },
  };
}

/** Upstash 설정이 없는 로컬 개발용. 서버리스 인스턴스 사이에서는 공유되지 않는다. */
export function createMemoryLimiters(now: () => number = Date.now): Limiters {
  return {
    ipMinute: memoryWindow(LIMITS.ipPerMinute, 60_000, now),
    ipDay: memoryWindow(LIMITS.ipPerDay, 86_400_000, now),
    globalDay: memoryWindow(LIMITS.globalPerDay, 86_400_000, now),
  };
}

export function createUpstashLimiters(redis: Redis): Limiters {
  return {
    ipMinute: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(LIMITS.ipPerMinute, "1 m"), prefix: "rl:ip:m" }),
    ipDay: new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(LIMITS.ipPerDay, "1 d"), prefix: "rl:ip:d" }),
    globalDay: new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(LIMITS.globalPerDay, "1 d"), prefix: "rl:global:d" }),
  };
}
