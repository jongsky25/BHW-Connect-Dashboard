import { NextResponse } from "next/server";
import { z } from "zod";
import { runToolLoop } from "@/lib/ai/agent-loop";
import { lookupAskCache, lookupAskCacheNearMatch, normalizeQuestion, storeAskAnswer } from "@/lib/ai/ask-cache";
import { recordAsk, type AskLogEntry } from "@/lib/ai/ask-log";
import { auditNarrative } from "@/lib/ai/audit";
import { isChatRateLimited, recordChatCacheHit, recordChatMessage } from "@/lib/ai/rate-limit";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import type { ChatMessage } from "@/lib/ai/providers/types";
import { getActiveDataset } from "@/lib/db/dataset";
import { geoLevelSchema } from "@/lib/filters/schema";

export const runtime = "nodejs";

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  geoCode: z.string().min(1).max(20).optional(),
  geoLevel: geoLevelSchema.optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2000) }))
    .min(1)
    .max(20),
});

/** One line of newline-delimited JSON streamed to the client as the tool loop progresses. */
type ChatStreamEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "message"; content: string; provider: string | null; cached?: boolean }
  | { type: "capacity"; message: string }
  | { type: "error"; message: string };

function ndjsonStream(build: (send: (event: ChatStreamEvent) => void) => Promise<void>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await build(send);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

/**
 * "Ask the data" chat (BUILD_PLAN.md §8 2.4). Streams newline-delimited JSON: a `tool_call` event
 * per lookup the model makes (tool-call transparency — "Looked up: training coverage, Region
 * VII"), then exactly one final `message`/`capacity`/`error` event. True token-level streaming of
 * the answer isn't used deliberately: the post-hoc numeric audit (2.2) has to see the complete
 * response before any of it is safe to show, so streaming partial unaudited text would risk
 * flashing an ungrounded number before it gets stripped — see docs/DECISIONS.md 2.4.
 *
 * Answer bank (docs/ASK_CACHE_PLAN.md): a single-turn question is checked against `ai_ask_cache`
 * before the provider cascade — a hit replays a previously audited answer at zero credit cost and
 * skips the rate limit (a hit costs nothing to serve; §0 #1). Every turn, live or cached, is
 * captured to `ai_ask_log` best-effort. Follow-up turns are never cached: they only mean
 * something with the conversation history.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { sessionId, geoCode, geoLevel, messages } = parsed.data;

  const userMessages = messages.filter((m) => m.role === "user");
  const questionRaw = userMessages[userMessages.length - 1]?.content ?? "";
  const questionNorm = normalizeQuestion(questionRaw);
  const isSingleTurn = messages.length === 1 && messages[0].role === "user";

  // Same staleness scheme as ai_narrative_cache: the active dataset's last_updated_at is the
  // cache version, so a fresh ingestion invalidates every stored answer. getActiveDataset
  // degrades to null (→ "unknown") when the database is unreachable.
  const dataVersion = (await getActiveDataset())?.lastUpdatedAt ?? "unknown";

  const logEntry = (partial: Pick<AskLogEntry, "answerMd" | "outcome" | "provider" | "servedFrom" | "toolTrace">) =>
    recordAsk({
      sessionId,
      questionRaw,
      questionNorm,
      geoCode: geoCode ?? null,
      geoLevel: geoLevel ?? null,
      turnIndex: Math.max(0, userMessages.length - 1),
      dataVersion,
      latencyMs: Date.now() - startedAt,
      ...partial,
    });

  // First-layer response: exact-match bank hit, then (if enabled) a trigram near-match on an
  // approved answer. Both cost no provider credits, so they skip the rate limit and stream
  // instantly; only the served_from marker differs, for analysis.
  let bankHit: { answerMd: string; provider: string | null } | null = null;
  let servedFrom: "cache" | "cache_near" = "cache";
  if (isSingleTurn) {
    bankHit = await lookupAskCache(questionNorm, geoCode ?? null, dataVersion);
    if (!bankHit) {
      const near = await lookupAskCacheNearMatch(questionNorm, geoCode ?? null, dataVersion);
      if (near) {
        bankHit = { answerMd: near.answerMd, provider: near.provider };
        servedFrom = "cache_near";
      }
    }
  }
  if (bankHit) {
    const hit = bankHit;
    await recordChatCacheHit(sessionId, geoCode ?? null);
    return ndjsonStream(async (send) => {
      send({ type: "message", content: hit.answerMd, provider: hit.provider, cached: true });
      await logEntry({ answerMd: hit.answerMd, outcome: "answered", provider: hit.provider, servedFrom, toolTrace: [] });
    });
  }

  if (await isChatRateLimited(sessionId)) {
    return NextResponse.json(
      { error: "You've reached the chat limit for now — please wait a few minutes and try again." },
      { status: 429 },
    );
  }
  await recordChatMessage(sessionId, geoCode ?? null);

  return ndjsonStream(async (send) => {
    const toolTrace: { name: string; args: Record<string, unknown> }[] = [];
    try {
      const contextLine =
        geoCode && geoLevel
          ? `\n\nThe user is currently viewing geo_code ${geoCode} (level ${geoLevel}) on the dashboard — treat it as the place they mean if their question doesn't name one.`
          : "";

      const chatMessages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT + contextLine },
        ...messages.map((m): ChatMessage => ({ role: m.role, content: m.content })),
      ];

      const result = await runToolLoop(chatMessages, (event) => {
        toolTrace.push(event);
        send({ type: "tool_call", name: event.name, args: event.args });
      });

      if (result.allCapped) {
        send({ type: "capacity", message: "Live AI is at capacity right now — please try again shortly." });
        await logEntry({ answerMd: null, outcome: "capacity", provider: null, servedFrom: "live", toolTrace });
      } else if (!result.finalText) {
        send({ type: "message", content: "I couldn't come up with an answer to that — try rephrasing.", provider: null });
        await logEntry({ answerMd: null, outcome: "audited_empty", provider: result.provider, servedFrom: "live", toolTrace });
      } else {
        const audited = auditNarrative(result.finalText, result.toolPayloads);
        send({
          type: "message",
          content:
            audited.text ||
            "I couldn't find a fully grounded answer to that in the dataset — try asking about a specific place or indicator (accreditation, demographics, training, honorarium, or service years).",
          provider: result.provider,
        });
        if (audited.text && isSingleTurn) {
          await storeAskAnswer({
            questionNorm,
            questionDisplay: questionRaw,
            geoCode: geoCode ?? null,
            dataVersion,
            answerMd: audited.text,
            provider: result.provider,
          });
        }
        await logEntry({
          answerMd: audited.text || null,
          outcome: audited.text ? "answered" : "audited_empty",
          provider: result.provider,
          servedFrom: "live",
          toolTrace,
        });
      }
    } catch {
      send({ type: "error", message: "Something went wrong answering that — please try again." });
      await logEntry({ answerMd: null, outcome: "error", provider: null, servedFrom: "live", toolTrace });
    }
  });
}
