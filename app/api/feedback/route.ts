import { Redis } from "@upstash/redis";
import { readEnv } from "@/lib/env";
import { handleFeedback, type FeedbackDeps } from "@/lib/feedback";
import { feedbackLimiter, sharedFeedbackStore } from "@/lib/feedback-deps";

export const runtime = "nodejs";

let deps: FeedbackDeps | undefined;

function getDeps(): FeedbackDeps {
  if (deps) return deps;
  const env = readEnv();
  const redis =
    env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
      ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
      : null;
  deps = {
    store: sharedFeedbackStore(redis),
    limiter: feedbackLimiter(redis),
    allowedOrigins: env.allowedOrigins,
    log: (entry) => console.log(JSON.stringify(entry)),
  };
  return deps;
}

export async function POST(req: Request) {
  return handleFeedback(req, getDeps());
}
