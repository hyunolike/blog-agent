import { handleCallback } from "@/lib/admin/auth";
import { adminContext, notFound, unavailable } from "@/lib/admin/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const ctx = adminContext();
  if (ctx.kind === "not_found") return notFound();
  if (ctx.kind === "unavailable") return unavailable();
  return handleCallback(req, ctx.env, { fetch, log: (entry) => console.log(JSON.stringify(entry)) });
}
