import { describe, expect, it } from "vitest";
import { createMemoryFlags, exhaustTtlMs } from "@/lib/flags";

const NOW = Date.parse("2026-09-29T15:00:00Z");
const NEXT_UTC_MIDNIGHT = Date.parse("2026-09-30T00:00:00Z");

describe("exhaustTtlMs", () => {
  it("waits until the reported reset time", () => {
    expect(exhaustTtlMs(NOW + 30_000, NOW)).toBe(30_000);
  });

  it("accepts reset times in seconds", () => {
    expect(exhaustTtlMs((NOW + 30_000) / 1000, NOW)).toBe(30_000);
  });

  it("defaults to one minute when no reset time is known", () => {
    expect(exhaustTtlMs(null, NOW)).toBe(60_000);
  });

  it("never waits past the next UTC midnight or less than a second", () => {
    expect(exhaustTtlMs(NOW + 48 * 3600_000, NOW)).toBe(NEXT_UTC_MIDNIGHT - NOW);
    expect(exhaustTtlMs(NOW - 5000, NOW)).toBe(1000);
  });

  it("always returns an integer, even for a fractional reset time", () => {
    expect(Number.isInteger(exhaustTtlMs(NOW + 1234.5, NOW))).toBe(true);
    expect(Number.isInteger(exhaustTtlMs((NOW + 30_500) / 1000 + 0.0001, NOW))).toBe(true);
  });
});

describe("createMemoryFlags", () => {
  it("expires the exhausted flag after its ttl", async () => {
    let now = NOW;
    const flags = createMemoryFlags(() => now);
    await flags.markPrimaryLimited(NOW + 10_000);
    expect(await flags.isPrimaryLimited()).toBe(true);
    now += 10_001;
    expect(await flags.isPrimaryLimited()).toBe(false);
  });
});
