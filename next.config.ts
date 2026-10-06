import type { NextConfig } from "next";

const frameAncestors = process.env.FRAME_ANCESTORS ?? "https://hyunolike.tistory.com";

const config: NextConfig = {
  outputFileTracingIncludes: { "/api/chat": ["./data/index.json"] },
  async headers() {
    return [
      { source: "/embed", headers: [{ key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors}` }] },
      { source: "/widget.js", headers: [{ key: "Cache-Control", value: "public, max-age=300" }] },
    ];
  },
};

export default config;
