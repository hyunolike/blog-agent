import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { sessionCookieName, verifySession } from "@/lib/admin/auth";
import { adminContext } from "@/lib/admin/deps";
import { pendingReviews } from "@/lib/admin/reviews";
import { ReviewList } from "./review-list";
import "./admin.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "평가 검토", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const ctx = adminContext();
  if (ctx.kind === "not_found") notFound();
  if (ctx.kind === "unavailable") {
    return (
      <main className="admin">
        <h1>평가 검토</h1>
        <p className="admin-error">평가 저장소에 연결하지 못했어요. 배포 환경변수를 확인해 주세요.</p>
      </main>
    );
  }

  // 페이지가 직접 세션을 검증한다. 화면 쪽 검사에 기대지 않는다
  const session = verifySession(ctx.env, (await cookies()).get(sessionCookieName(ctx.env))?.value, Math.floor(Date.now() / 1000));
  if (!session) {
    return (
      <main className="admin admin-login">
        <h1>평가 검토</h1>
        <p>관리자만 들어올 수 있어요.</p>
        <a className="admin-btn primary" href="/api/admin/login">
          GitHub로 로그인
        </a>
      </main>
    );
  }

  let items: Awaited<ReturnType<typeof pendingReviews>> | null = null;
  try {
    items = await pendingReviews(ctx.deps);
  } catch (err) {
    ctx.deps.log({ event: "admin_review_error", error: err instanceof Error ? err.message : String(err) });
  }
  const posts = ctx.deps.posts();

  return (
    <main className="admin">
      <header className="admin-head">
        <h1>평가 검토</h1>
        <form method="post" action="/api/admin/logout">
          <span className="admin-who">{session.login}</span>
          <button className="admin-btn" type="submit">
            로그아웃
          </button>
        </form>
      </header>
      {items === null ? (
        <p className="admin-error">평가 목록을 읽지 못했어요. 잠시 뒤 새로고침해 주세요.</p>
      ) : (
        <ReviewList initial={items} posts={posts} />
      )}
    </main>
  );
}
