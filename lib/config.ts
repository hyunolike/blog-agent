export const BLOG_ORIGIN = "https://hyunolike.tistory.com";

/** 모든 모델이 실패했을 때 스트림 error 조각에 싣는 표시. 서버와 클라이언트가 함께 쓴다. */
export const AI_UNAVAILABLE = "AI_UNAVAILABLE";

const POST_PATH = /^\/(?:m\/)?(\d+)$/;

/** 블로그 글 URL이면 글 번호를, 아니면 null을 돌려준다. */
export function parseBlogPostId(raw: string | null | undefined): number | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== BLOG_ORIGIN) return null;
  const m = url.pathname.match(POST_PATH);
  return m ? Number(m[1]) : null;
}
