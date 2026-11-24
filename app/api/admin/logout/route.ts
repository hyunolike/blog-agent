import { handleLogout } from "@/lib/admin/auth";
import { adminContext, notFound, unavailable } from "@/lib/admin/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  const ctx = adminContext();
  if (ctx.kind === "not_found") return notFound();
  if (ctx.kind === "unavailable") return unavailable();
  return handleLogout(req, ctx.env, ctx.deps.allowedOrigins);
}
