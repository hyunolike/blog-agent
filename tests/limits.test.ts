import { describe, expect, it, vi } from "vitest";
import { checkLimits, createMemoryLimiters, LIMITS, type Limiter } from "@/lib/limits";

const allow: Limiter = { limit: async () => ({ success: true, reset: 0 }) };
const deny = (reset: number): Limiter => ({ limit: async () => ({ success: false, reset }) });

describe("checkLimits", () => {
  const now = 1_000_000;

  it("passes when every limiter passes", async () => {
    expect(await checkLimits({ ipMinute: allow, ipDay: allow, globalDay: allow }, "1.1.1.1", now)).toEqual({ ok: true });
  });

  it("reports ip limits with seconds until reset and does not consume the global quota", async () => {
    const global = { limit: vi.fn(allow.limit) };
    const result = await checkLimits({ ipMinute: deny(now + 12_300), ipDay: allow, globalDay: global }, "1.1.1.1", now);
    expect(result).toEqual({ ok: false, scope: "ip", retryAfterSec: 13 });
    expect(global.limit).not.toHaveBeenCalled();
  });

  it("reports the global daily limit", async () => {
    const result = await checkLimits({ ipMinute: allow, ipDay: allow, globalDay: deny(now + 3600_000) }, "1.1.1.1", now);
    expect(result).toEqual({ ok: false, scope: "global", retryAfterSec: 3600 });
  });
});

describe("createMemoryLimiters", () => {
  it("allows ipPerMinute requests per ip per minute", async () => {
    let t = 0;
    const l = createMemoryLimiters(() => t);
    for (let i = 0; i < LIMITS.ipPerMinute; i++) expect((await checkLimits(l, "a", t)).ok).toBe(true);
    expect((await checkLimits(l, "a", t)).ok).toBe(false);
    expect((await checkLimits(l, "b", t)).ok).toBe(true);
    t += 60_000;
    expect((await checkLimits(l, "a", t)).ok).toBe(true);
  });
});
