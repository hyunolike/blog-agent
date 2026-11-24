import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 관리자 기능 설정. 하나라도 빠지면 null이고 관리자 경로는 모두 404다. 채팅은 영향받지 않는다. */
export type AdminEnv = {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  adminIds: number[];
  appOrigin: string;
};

export const SESSION_TTL_SEC = 8 * 3600;
export const STATE_COOKIE = "admin_oauth_state";
const STATE_TTL_SEC = 600;
const MIN_SECRET = 32;

let warned = false;

export function readAdminEnv(env: Record<string, string | undefined> = process.env): AdminEnv | null {
  const clientId = env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  const sessionSecret = env.ADMIN_SESSION_SECRET ?? "";
  const adminIds = (env.ADMIN_GITHUB_IDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0);
  if (sessionSecret && sessionSecret.length < MIN_SECRET && !warned) {
    warned = true;
    console.warn(JSON.stringify({ event: "admin_config_warning", error: `ADMIN_SESSION_SECRET은 ${MIN_SECRET}자 이상이어야 합니다.` }));
  }
  if (!clientId || !clientSecret || sessionSecret.length < MIN_SECRET || adminIds.length === 0) return null;
  let appOrigin: string;
  try {
    appOrigin = new URL(env.APP_ORIGIN ?? "http://localhost:3000").origin;
  } catch {
    return null;
  }
  return { clientId, clientSecret, sessionSecret, adminIds, appOrigin };
}

const secure = (env: AdminEnv) => env.appOrigin.startsWith("https:");
/** https에서는 __Host- 접두사로 다른 하위 도메인이 쿠키를 덮어쓰지 못하게 한다 */
export const sessionCookieName = (env: AdminEnv) => (secure(env) ? "__Host-admin_session" : "admin_session");
export const redirectUri = (env: AdminEnv) => `${env.appOrigin}/api/admin/callback`;

export type Session = { sub: number; login: string; exp: number };

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest();

export function signSession(env: AdminEnv, s: Session): string {
  const body = b64(JSON.stringify({ v: 1, sub: s.sub, login: s.login, exp: s.exp }));
  return `${body}.${b64(mac(env.sessionSecret, body))}`;
}

export function verifySession(env: AdminEnv, value: string | undefined, nowSec: number): Session | null {
  if (!value) return null;
  const [body, sig, extra] = value.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = mac(env.sessionSecret, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { v?: number; sub?: number; login?: string; exp?: number };
    if (p.v !== 1 || typeof p.sub !== "number" || typeof p.exp !== "number" || typeof p.login !== "string") return null;
    if (p.exp <= nowSec || !env.adminIds.includes(p.sub)) return null;
    return { sub: p.sub, login: p.login, exp: p.exp };
  } catch {
    return null;
  }
}

/** Cookie 헤더에서 값 하나를 읽는다 */
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export function sessionOf(env: AdminEnv, req: Request, nowSec = Math.floor(Date.now() / 1000)): Session | null {
  return verifySession(env, readCookie(req, sessionCookieName(env)), nowSec);
}

function cookie(env: AdminEnv, name: string, value: string, attrs: { path: string; maxAge: number }): string {
  return [`${name}=${value}`, `Path=${attrs.path}`, `Max-Age=${attrs.maxAge}`, "HttpOnly", "SameSite=Lax", ...(secure(env) ? ["Secure"] : [])].join("; ");
}

export const sessionCookie = (env: AdminEnv, value: string) => cookie(env, sessionCookieName(env), value, { path: "/", maxAge: SESSION_TTL_SEC });
export const clearSessionCookie = (env: AdminEnv) => cookie(env, sessionCookieName(env), "", { path: "/", maxAge: 0 });
const stateCookie = (env: AdminEnv, value: string) => cookie(env, STATE_COOKIE, value, { path: "/api/admin/callback", maxAge: STATE_TTL_SEC });
const clearStateCookie = (env: AdminEnv) => cookie(env, STATE_COOKIE, "", { path: "/api/admin/callback", maxAge: 0 });

export function handleLogin(env: AdminEnv, random: () => string = () => randomBytes(16).toString("hex")): Response {
  const state = random();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", redirectUri(env));
  url.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { location: url.toString(), "set-cookie": stateCookie(env, state) } });
}

export type CallbackDeps = {
  fetch: typeof fetch;
  log(entry: Record<string, unknown>): void;
  nowSec?: () => number;
  timeoutMs?: number;
};

function page(status: number, message: string, env: AdminEnv, extraCookie?: string): Response {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  headers.append("set-cookie", clearStateCookie(env));
  if (extraCookie) headers.append("set-cookie", extraCookie);
  const html = `<!doctype html><meta charset="utf-8"><title>관리자 로그인</title><p>${message}</p><p><a href="/admin">관리자 화면으로</a></p>`;
  return new Response(html, { status, headers });
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function handleCallback(req: Request, env: AdminEnv, deps: CallbackDeps): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const saved = readCookie(req, STATE_COOKIE);
  if (url.searchParams.has("error") || !code || !state || !saved || !sameText(state, saved)) {
    deps.log({ event: "admin_login", result: "error", error: "bad_state" });
    return page(400, "로그인하지 못했어요. 다시 시도해 주세요.", env);
  }

  const signal = AbortSignal.timeout(deps.timeoutMs ?? 5000);
  let user: { id?: unknown; login?: unknown };
  try {
    const tokenRes = await deps.fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: env.clientId, client_secret: env.clientSecret, code, redirect_uri: redirectUri(env) }),
      signal,
    });
    const token = tokenRes.ok ? ((await tokenRes.json()) as { access_token?: string }).access_token : undefined;
    if (!token) throw new Error(`token exchange failed (${tokenRes.status})`);
    const userRes = await deps.fetch("https://api.github.com/user", {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": "blog-agent" },
      signal,
    });
    if (!userRes.ok) throw new Error(`user lookup failed (${userRes.status})`);
    user = (await userRes.json()) as { id?: unknown; login?: unknown };
  } catch (err) {
    deps.log({ event: "admin_login", result: "error", error: err instanceof Error ? err.message : String(err) });
    return page(502, "GitHub와 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.", env);
  }

  const id = typeof user.id === "number" ? user.id : NaN;
  if (!env.adminIds.includes(id)) {
    // 거절된 계정의 로그인 이름은 남기지 않는다
    deps.log({ event: "admin_login", result: "denied", id: Number.isFinite(id) ? id : null });
    return page(403, "이 계정은 관리자 화면에 들어갈 수 없어요.", env);
  }
  const nowSec = deps.nowSec?.() ?? Math.floor(Date.now() / 1000);
  const value = signSession(env, { sub: id, login: String(user.login ?? ""), exp: nowSec + SESSION_TTL_SEC });
  deps.log({ event: "admin_login", result: "ok", id });
  const headers = new Headers({ location: "/admin" });
  headers.append("set-cookie", clearStateCookie(env));
  headers.append("set-cookie", sessionCookie(env, value));
  return new Response(null, { status: 303, headers });
}

export function handleLogout(req: Request, env: AdminEnv, allowedOrigins: string[]): Response {
  if (!allowedOrigins.includes(req.headers.get("origin") ?? "")) return Response.json({ error: "forbidden" }, { status: 403 });
  return new Response(null, { status: 303, headers: { location: "/admin", "set-cookie": clearSessionCookie(env) } });
}
