import { adminContext, notFound, unavailable } from "@/lib/admin/deps";
import { handleReviewsGet, handleReviewsPost } from "@/lib/admin/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const ctx = adminContext();
  if (ctx.kind === "not_found") return notFound();
  if (ctx.kind === "unavailable") return unavailable();
  return handleReviewsGet(req, ctx.deps);
}

export function POST(req: Request) {
  const ctx = adminContext();
  if (ctx.kind === "not_found") return notFound();
  if (ctx.kind === "unavailable") return unavailable();
  return handleReviewsPost(req, ctx.deps);
}
