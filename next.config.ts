import type { NextConfig } from "next";

const frameAncestors = process.env.FRAME_ANCESTORS ?? "https://hyunolike.tistory.com";

const adminHeaders = [
  { key: "Cache-Control", value: "no-store" },
  { key: "X-Robots-Tag", value: "noindex" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const config: NextConfig = {
  outputFileTracingIncludes: {
    "/api/chat": ["./data/index.json"],
    // 검토 화면은 글 제목과, 이미 평가셋에 옮긴 ID를 배포된 파일에서 읽는다
    "/admin": ["./data/index.json", "./eval/questions.jsonl"],
    "/api/admin/reviews": ["./data/index.json", "./eval/questions.jsonl"],
  },
  async headers() {
    return [
      { source: "/embed", headers: [{ key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors}` }] },
      { source: "/widget.js", headers: [{ key: "Cache-Control", value: "public, max-age=300" }] },
      ...["/admin", "/admin/:path*", "/api/admin/:path*"].map((source) => ({ source, headers: adminHeaders })),
    ];
  },
};

export default config;
