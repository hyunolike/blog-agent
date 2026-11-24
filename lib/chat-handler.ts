import { createHash, randomUUID } from "node:crypto";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createUIMessageStream, createUIMessageStreamResponse, streamText, toUIMessageStream, type ToolSet } from "ai";
import { z } from "zod";
import { AI_UNAVAILABLE, parseBlogPostId } from "./config";
import type { ModelUsed } from "./fallback-model";
import type { FeedbackStore } from "./feedback";
import { checkLimits, type Limiters } from "./limits";
import { maskPii, type MaskResult } from "./pii";
import { ANSWER_REMINDER, buildModelMessages, buildSearchQuery, buildSources, SYSTEM_PROMPT, type TextMessage } from "./prompt";
import type { Searcher } from "./retrieval";
import type { ChatMetadata, ChatUIMessage } from "./types";

export type ChatDeps = {
  searcher: Searcher | null;
  embedQuery(text: string): Promise<number[]>;
  createModel(onUsed: (u: ModelUsed) => void): LanguageModelV4;
  limits: Limiters;
  allowedOrigins: string[];
  log(entry: Record<string, unknown>): void;
  /** 답변 평가를 받을 수 있게 응답 맥락을 잠시 둔다. 없으면 평가 버튼이 나오지 않는다. */
  feedback?: FeedbackStore;
};

/** 평가를 프롬프트 변경 전후로 나눠 보려고 지시문 해시를 함께 저장한다 */
export const PROMPT_VERSION = createHash("sha256").update(SYSTEM_PROMPT).update(ANSWER_REMINDER).digest("hex").slice(0, 8);

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

  // 개인정보는 외부 모델(임베딩, 답변)에 보내기 전에 가린다. 이전 대화도 함께 보내므로 모두 가린다
  const masked: MaskResult["counts"] = {};
  const safeMessages: TextMessage[] = messages.map((m) => {
    const { text, counts } = maskPii(m.text);
    for (const [kind, n] of Object.entries(counts) as [keyof MaskResult["counts"], number][]) masked[kind] = (masked[kind] ?? 0) + n;
    return { role: m.role, text };
  });
  // 로그에는 가린 값이 아니라 종류별 개수만 남긴다
  const maskedLog = Object.keys(masked).length > 0 ? { masked } : {};

  const query = buildSearchQuery(safeMessages);
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
  const responseId = deps.feedback ? randomUUID() : undefined;

  const stream = createUIMessageStream<ChatUIMessage>({
    execute: ({ writer }) => {
      writer.write({ type: "start", messageMetadata: { sources, ...(responseId ? { responseId } : {}) } satisfies ChatMetadata });
      const result = streamText({
        model,
        instructions: SYSTEM_PROMPT,
        messages: buildModelMessages(safeMessages, block, currentTitle),
        maxOutputTokens: CHAT_LIMITS.maxOutputTokens,
        maxRetries: 0,
        abortSignal: req.signal,
        // 스트림은 이 콜백이 끝난 뒤 닫히므로, 화면에 평가 버튼이 나올 때는 맥락이 이미 저장돼 있다
        onEnd: async ({ text }) => {
          if (!deps.feedback || !responseId || !text.trim()) return;
          try {
            await deps.feedback.saveContext(responseId, {
              question: safeMessages[safeMessages.length - 1]!.text,
              history: safeMessages.slice(0, -1),
              answer: text,
              chunkIds: results.slice(0, sources.length).map((r) => r.chunk.id),
              postIds,
              currentPostId,
              model: used?.modelId,
              promptVersion: PROMPT_VERSION,
              createdAt: new Date().toISOString(),
            });
          } catch (err) {
            deps.log({ event: "feedback_context_error", error: err instanceof Error ? err.message : String(err) });
          }
        },
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
            ...maskedLog,
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
              ...maskedLog,
            });
            return { model: used?.modelId, tier: used?.tier } satisfies ChatMetadata;
          },
        }),
      );
    },
    onError: (err) => {
      deps.log({ event: "chat_error", error: err instanceof Error ? err.message : String(err), questionChars, embedFailed, ...maskedLog });
      return AI_UNAVAILABLE;
    },
  });

  if (embedFailed) deps.log({ event: "embed_failed", embedFailed: true });
  return createUIMessageStreamResponse({ stream });
}
