import { describe, expect, it, vi } from "vitest";
import {
  handleCallback,
  handleLogin,
  handleLogout,
  readAdminEnv,
  SESSION_TTL_SEC,
  sessionCookieName,
  signSession,
  STATE_COOKIE,
  verifySession,
  type AdminEnv,
} from "@/lib/admin/auth";

const SECRET = "s".repeat(32);
const env: AdminEnv = { clientId: "cid", clientSecret: "csecret", sessionSecret: SECRET, adminIds: [61215550], appOrigin: "https://chat.example.dev" };
const NOW = 1_800_000_000;

describe("readAdminEnv", () => {
  const full = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "x", ADMIN_SESSION_SECRET: SECRET, ADMIN_GITHUB_IDS: "61215550, 7", APP_ORIGIN: "https://chat.example.dev/" };

  it("reads a complete config", () => {
    expect(readAdminEnv(full)).toEqual({ clientId: "cid", clientSecret: "x", sessionSecret: SECRET, adminIds: [61215550, 7], appOrigin: "https://chat.example.dev" });
  });

  it("turns the feature off when anything is missing or weak", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readAdminEnv({ ...full, GITHUB_CLIENT_ID: "" })).toBeNull();
    expect(readAdminEnv({ ...full, GITHUB_CLIENT_SECRET: undefined })).toBeNull();
    expect(readAdminEnv({ ...full, ADMIN_SESSION_SECRET: "short" })).toBeNull();
    expect(readAdminEnv({ ...full, ADMIN_GITHUB_IDS: "hyunolike" })).toBeNull();
    expect(readAdminEnv({ ...full, ADMIN_GITHUB_IDS: "" })).toBeNull();
  });
});

describe("session cookie", () => {
  const value = signSession(env, { sub: 61215550, login: "hyunolike", exp: NOW + 60 });

  it("round-trips a valid session", () => {
    expect(verifySession(env, value, NOW)).toEqual({ sub: 61215550, login: "hyunolike", exp: NOW + 60 });
  });

  it("rejects tampered, expired, foreign-secret and delisted sessions", () => {
    const [body, sig] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, sub: 61215550, login: "x", exp: NOW + 9999 })).toString("base64url");
    expect(verifySession(env, `${forged}.${sig}`, NOW)).toBeNull();
    expect(verifySession(env, `${body}.${sig}x`, NOW)).toBeNull();
    expect(verifySession(env, value, NOW + 60)).toBeNull();
    expect(verifySession({ ...env, sessionSecret: "t".repeat(32) }, value, NOW)).toBeNull();
    expect(verifySession({ ...env, adminIds: [1] }, value, NOW)).toBeNull();
    expect(verifySession(env, undefined, NOW)).toBeNull();
    expect(verifySession(env, "garbage", NOW)).toBeNull();
  });

  it("uses a __Host- cookie on https and a plain one locally", () => {
    expect(sessionCookieName(env)).toBe("__Host-admin_session");
    expect(sessionCookieName({ ...env, appOrigin: "http://localhost:3000" })).toBe("admin_session");
  });
});

describe("login", () => {
  it("redirects to GitHub with a state cookie and a fixed redirect_uri", () => {
    const res = handleLogin(env, () => "abc123");
    const loc = new URL(res.headers.get("location")!);
    expect(res.status).toBe(302);
    expect(loc.origin + loc.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://chat.example.dev/api/admin/callback");
    expect(loc.searchParams.get("state")).toBe("abc123");
    expect(loc.searchParams.has("scope")).toBe(false);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${STATE_COOKIE}=abc123`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api\/admin\/callback/);
    expect(cookie).toMatch(/Secure/);
  });
});

describe("callback", () => {
  const callback = (query: string, cookie?: string) =>
    new Request(`https://chat.example.dev/api/admin/callback?${query}`, { headers: cookie ? { cookie } : {} });

  function github(user: unknown, opts: { tokenStatus?: number; token?: string | null } = {}) {
    return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).includes("access_token")) {
        const body = opts.token === null ? { error: "bad_verification_code" } : { access_token: opts.token ?? "gho_x" };
        return Response.json(body, { status: opts.tokenStatus ?? 200 });
      }
      return Response.json(user);
    });
  }
  const deps = (fetch: ReturnType<typeof github>) => ({ fetch: fetch as unknown as typeof globalThis.fetch, log: vi.fn(), nowSec: () => NOW });
  const cookies = (res: Response) => res.headers.getSetCookie();

  it("signs in an allowed GitHub id and clears the state cookie", async () => {
    const fetch = github({ id: 61215550, login: "hyunolike" });
    const res = await handleCallback(callback("code=c&state=s1", `${STATE_COOKIE}=s1`), env, deps(fetch));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin");
    const set = cookies(res);
    expect(set.some((c) => c.startsWith(`${STATE_COOKIE}=;`) && c.includes("Max-Age=0"))).toBe(true);
    const session = set.find((c) => c.startsWith("__Host-admin_session="))!;
    expect(session).toContain(`Max-Age=${SESSION_TTL_SEC}`);
    const value = session.split(";")[0]!.split("=")[1];
    expect(verifySession(env, value, NOW)).toMatchObject({ sub: 61215550 });
    const [tokenCall, userCall] = fetch.mock.calls;
    expect(JSON.parse(String((tokenCall![1] as RequestInit).body))).toMatchObject({ redirect_uri: "https://chat.example.dev/api/admin/callback" });
    expect((userCall![1] as RequestInit).headers).toMatchObject({ "user-agent": "blog-agent", authorization: "Bearer gho_x" });
  });

  it("rejects a bad or missing state before calling GitHub", async () => {
    for (const [query, cookie] of [
      ["code=c&state=s1", `${STATE_COOKIE}=other`],
      ["code=c&state=s1", undefined],
      ["state=s1", `${STATE_COOKIE}=s1`],
      ["error=access_denied&state=s1", `${STATE_COOKIE}=s1`],
    ] as const) {
      const fetch = github({ id: 61215550 });
      const res = await handleCallback(callback(query, cookie), env, deps(fetch));
      expect(res.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
      expect(cookies(res).some((c) => c.includes("admin_session"))).toBe(false);
      expect(cookies(res).some((c) => c.startsWith(`${STATE_COOKIE}=;`))).toBe(true);
    }
  });

  it("refuses ids outside the allow list without logging their login", async () => {
    const d = deps(github({ id: 42, login: "stranger" }));
    const res = await handleCallback(callback("code=c&state=s1", `${STATE_COOKIE}=s1`), env, d);
    expect(res.status).toBe(403);
    expect(cookies(res).some((c) => c.includes("admin_session"))).toBe(false);
    expect(JSON.stringify(d.log.mock.calls)).not.toContain("stranger");
  });

  it("returns 502 when GitHub fails", async () => {
    const req = () => callback("code=c&state=s1", `${STATE_COOKIE}=s1`);
    expect((await handleCallback(req(), env, deps(github({}, { token: null })))).status).toBe(502);
    expect((await handleCallback(req(), env, deps(github({}, { tokenStatus: 500 })))).status).toBe(502);
    const userDown = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => (String(url).includes("access_token") ? Response.json({ access_token: "t" }) : new Response("", { status: 401 })));
    expect((await handleCallback(req(), env, deps(userDown))).status).toBe(502);
  });
});

describe("logout", () => {
  it("clears the session for same-origin posts only", () => {
    const post = (origin: string) => new Request("https://chat.example.dev/api/admin/logout", { method: "POST", headers: { origin } });
    expect(handleLogout(post("https://evil.example"), env, [env.appOrigin]).status).toBe(403);
    const res = handleLogout(post(env.appOrigin), env, [env.appOrigin]);
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-admin_session=;.*Max-Age=0/);
  });
});
