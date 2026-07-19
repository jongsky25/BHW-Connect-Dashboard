import { NextResponse } from "next/server";
import { z } from "zod";
import { runToolLoop } from "@/lib/ai/agent-loop";
import { auditNarrative } from "@/lib/ai/audit";
import { isChatRateLimited, recordChatMessage } from "@/lib/ai/rate-limit";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import type { ChatMessage } from "@/lib/ai/providers/types";
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
  | { type: "message"; content: string; provider: string | null }
  | { type: "capacity"; message: string }
  | { type: "error"; message: string };

/**
 * "Ask the data" chat (BUILD_PLAN.md §8 2.4). Streams newline-delimited JSON: a `tool_call` event
 * per lookup the model makes (tool-call transparency — "Looked up: training coverage, Region
 * VII"), then exactly one final `message`/`capacity`/`error` event. True token-level streaming of
 * the answer isn't used deliberately: the post-hoc numeric audit (2.2) has to see the complete
 * response before any of it is safe to show, so streaming partial unaudited text would risk
 * flashing an ungrounded number before it gets stripped — see docs/DECISIONS.md 2.4.
 */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { sessionId, geoCode, geoLevel, messages } = parsed.data;

  if (await isChatRateLimited(sessionId)) {
    return NextResponse.json(
      { error: "You've reached the chat limit for now — please wait a few minutes and try again." },
      { status: 429 },
    );
  }
  await recordChatMessage(sessionId, geoCode ?? null);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

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
          send({ type: "tool_call", name: event.name, args: event.args });
        });

        if (result.allCapped) {
          send({ type: "capacity", message: "Live AI is at capacity right now — please try again shortly." });
        } else if (!result.finalText) {
          send({ type: "message", content: "I couldn't come up with an answer to that — try rephrasing.", provider: null });
        } else {
          const audited = auditNarrative(result.finalText, result.toolPayloads);
          send({
            type: "message",
            content:
              audited.text ||
              "I couldn't find a fully grounded answer to that in the dataset — try asking about a specific place or indicator (accreditation, demographics, training, honorarium, or service years).",
            provider: result.provider,
          });
        }
      } catch {
        send({ type: "error", message: "Something went wrong answering that — please try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
