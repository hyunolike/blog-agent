import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSession, saveSession, toWire } from "@/lib/session";
import type { ChatUIMessage } from "@/lib/types";

afterEach(() => vi.unstubAllGlobals());

describe("session storage access", () => {
  it("returns null instead of throwing when storage is missing", () => {
    expect(loadSession("k")).toBeNull();
    expect(() => saveSession("k", [1])).not.toThrow();
  });

  it("returns null instead of throwing when storage access is blocked", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(loadSession("k")).toBeNull();
    expect(() => saveSession("k", [1])).not.toThrow();
  });

  it("round-trips json when storage works and ignores corrupt values", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    saveSession("k", { a: 1 });
    expect(loadSession("k")).toEqual({ a: 1 });
    store.set("k", "{broken");
    expect(loadSession("k")).toBeNull();
  });
});

describe("toWire", () => {
  const msg = (i: number, role: "user" | "assistant", text: string): ChatUIMessage => ({
    id: String(i),
    role,
    parts: [{ type: "text", text }],
    metadata: { sources: [{ n: 1, postId: 1, title: "t", url: "u", section: "" }] },
  });

  it("keeps the last six messages, strips metadata, and trims assistant text", () => {
    const messages = Array.from({ length: 8 }, (_, i) => msg(i, i % 2 ? "assistant" : "user", i % 2 ? "답".repeat(900) : `질문 ${i}`));
    const wire = toWire(messages);
    expect(wire.map((m) => m.id)).toEqual(["2", "3", "4", "5", "6", "7"]);
    expect(wire[1]!.parts[0]!.text.length).toBe(600);
    expect(wire[0]).toEqual({ id: "2", role: "user", parts: [{ type: "text", text: "질문 2" }] });
  });
});
