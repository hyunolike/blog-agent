import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createUIMessageStream, createUIMessageStreamResponse, streamText, toUIMessageStream, type ToolSet } from "ai";
import { z } from "zod";
import { AI_UNAVAILABLE, parseBlogPostId } from "./config";
import type { ModelUsed } from "./fallback-model";
import { checkLimits, type Limiters } from "./limits";
import { buildModelMessages, buildSearchQuery, buildSources, SYSTEM_PROMPT, type TextMessage } from "./prompt";
import type { Searcher } from "./retrieval";
import type { ChatMetadata, ChatUIMessage } from "./types";

export type ChatDeps = {
  searcher: Searcher | null;
  embedQuery(text: string): Promise<number[]>;
  createModel(onUsed: (u: ModelUsed) => void): LanguageModelV4;
  limits: Limiters;
  allowedOrigins: string[];
  log(entry: Record<string, unknown>): void;
};

export const CHAT_LIMITS = { maxBodyBytes: 16384, maxMessages: 6, maxQuestionChars: 500, maxOutputTokens: 800 };
export { AI_UNAVAILABLE };

const INVALID_MESSAGE = "질문은 1~500자로 입력해 주세요.";

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "assistant"]),
        parts: z.array(z.object({ type: z.string(), text: z.string().optional() })),
      }),
    )
    .min(1)
    .max(CHAT_LIMITS.maxMessages),
  from: z.string().nullish(),
});

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

const invalid = () => json(400, { error: "invalid", message: INVALID_MESSAGE });

function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function handleChat(req: Request, deps: ChatDeps): Promise<Response> {
  const startedAt = Date.now();

  if (!deps.allowedOrigins.includes(req.headers.get("origin") ?? "")) {
    return json(403, { error: "forbidden", message: "허용되지 않은 요청이에요." });
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > CHAT_LIMITS.maxBodyBytes) return invalid();
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(raw));
  } catch {
    return invalid();
  }

  const messages: TextMessage[] = parsed.messages.map((m) => ({
    role: m.role,
    text: m.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("")
      .trim(),
  }));
  const question = messages[messages.length - 1]!;
  const questionChars = [...question.text].length;
  if (question.role !== "user" || questionChars === 0 || questionChars > CHAT_LIMITS.maxQuestionChars) return invalid();

  const limit = await checkLimits(deps.limits, clientIp(req));
  if (!limit.ok) {
    const message =
      limit.scope === "ip" ? `잠시 후 다시 시도해 주세요 (${limit.retryAfterSec}초)` : "오늘 답변 한도가 다 찼어요. 내일 다시 찾아주세요.";
    return json(429, { error: "rate_limited", scope: limit.scope, retryAfterSec: limit.retryAfterSec, message }, { "retry-after": String(limit.retryAfterSec) });
  }

  if (!deps.searcher) {
    return json(503, { error: "index_unavailable", message: "검색 인덱스를 준비 중이에요. 잠시 후 다시 시도해 주세요." });
  }

  const query = buildSearchQuery(messages);
  let queryVector: number[] | null = null;
  let embedFailed = false;
  try {
    queryVector = await deps.embedQuery(query);
  } catch {
    embedFailed = true;
  }

  const currentPostId = parseBlogPostId(parsed.from);
  const results = deps.searcher.search({ query, queryVector, currentPostId });
  const { block, sources } = buildSources(results);
  // 보고 있는 글이 있으면 검색이 그 글 요약을 맨 앞에 두므로 출처 1번이 된다
  const currentTitle = currentPostId !== null && sources[0]?.postId === currentPostId ? sources[0].title : undefined;

  let used: ModelUsed | undefined;
  let firstTextAt: number | undefined;
  const model = deps.createModel((u) => {
    used = u;
  });
  const postIds = [...new Set(sources.map((s) => s.postId))];

  const stream = createUIMessageStream<ChatUIMessage>({
    execute: ({ writer }) => {
      writer.write({ type: "start", messageMetadata: { sources } satisfies ChatMetadata });
      const result = streamText({
        model,
        instructions: SYSTEM_PROMPT,
        messages: buildModelMessages(messages, block, currentTitle),
        maxOutputTokens: CHAT_LIMITS.maxOutputTokens,
        maxRetries: 0,
        abortSignal: req.signal,
        onError: ({ error }) => {
          // 모든 모델이 실패하면 스트림은 finish 없이 start→error로 끝난다. 글자가 나온 뒤 끊기면 interrupted.
          // 여기서 직접 구조화 로그를 남기고, ai SDK의 기본 console.error(원시 에러) 출력을 대신한다.
          deps.log({
            event: "chat",
            outcome: firstTextAt === undefined ? "all_models_failed" : "interrupted",
            error: error instanceof Error ? error.message : String(error),
            totalMs: Date.now() - startedAt,
            postIds,
            questionChars,
            embedFailed,
          });
        },
      });
      writer.merge(
        toUIMessageStream<ToolSet, ChatUIMessage>({
          stream: result.stream,
          sendStart: false,
          onError: () => AI_UNAVAILABLE,
          messageMetadata: ({ part }) => {
            if (part.type === "text-delta" && firstTextAt === undefined) firstTextAt = Date.now();
            if (part.type !== "finish") return undefined;
            deps.log({
              event: "chat",
              outcome: "ok",
              model: used?.modelId,
              tier: used?.tier,
              fallbackReason: used?.reason,
              firstTextMs: firstTextAt ? firstTextAt - startedAt : null,
              totalMs: Date.now() - startedAt,
              usage: part.totalUsage,
              postIds,
              questionChars,
              embedFailed,
            });
            return { model: used?.modelId, tier: used?.tier } satisfies ChatMetadata;
          },
        }),
      );
    },
    onError: (err) => {
      deps.log({ event: "chat_error", error: err instanceof Error ? err.message : String(err), questionChars, embedFailed });
      return AI_UNAVAILABLE;
    },
  });

  if (embedFailed) deps.log({ event: "embed_failed", embedFailed: true });
  return createUIMessageStreamResponse({ stream });
}
