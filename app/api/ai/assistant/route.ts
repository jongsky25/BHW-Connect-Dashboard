import { NextResponse } from "next/server";
import { z } from "zod";
import { runToolLoop } from "@/lib/ai/agent-loop";
import { auditNarrative } from "@/lib/ai/audit";
import { createInternalTools } from "@/lib/ai/dataset-tools";
import { INTERNAL_SYSTEM_PROMPT } from "@/lib/ai/internal-system-prompt";
import {
  isInternalAssistantRateLimited,
  recordInternalAssistantMessage,
} from "@/lib/ai/rate-limit";
import type { ChatMessage } from "@/lib/ai/providers/types";
import { getAdminUser } from "@/lib/db/require-admin";

export const runtime = "nodejs";

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(30),
});

/** Same NDJSON event vocabulary as the public chat, plus the tool result — internal users need to
 * see what a query actually returned, not just that one ran. */
type AssistantStreamEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "message"; content: string; provider: string | null }
  | { type: "capacity"; message: string }
  | { type: "error"; message: string };

function ndjsonStream(
  build: (send: (event: AssistantStreamEvent) => void) => Promise<void>,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: AssistantStreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await build(send);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

/**
 * Internal assistant (docs/AI_ASSISTANT_PLAN.md §8, Increment 1.4). The same `runToolLoop` and
 * NDJSON stream as the public chat, differing in exactly four ways, all of them owner decisions
 * from §0:
 *
 * - **Admin session only** (decision 2). `getAdminUser()` is re-checked here rather than trusted
 *   from the page: a route handler is reachable directly, and `proxy.ts` only gates `/admin/*`
 *   paths, not `/api/*`. This check is the security boundary for this endpoint — it fails closed.
 * - **The registry tool set** at `internal` exposure, so the assistant can reach every registered
 *   table rather than the six hand-written indicator tools.
 * - **No answer cache** (decision 4), neither read nor written. Internal use is exploratory and
 *   low-volume; a stale answer costs more here than a provider call does. Nothing internal is
 *   written to `ai_ask_log` either — that log is the corpus the *public* answer bank is curated
 *   from, and seeding it with internal exploration would corrupt what gets offered to visitors.
 * - **Relaxed rate limit** (§8 1.4), per admin user rather than per browser session.
 *
 * The numeric audit is unchanged (decision 3): `auditNarrative` strips any sentence whose numbers
 * are not in the tool payloads, on internal answers exactly as on public ones.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Admin session required." }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (await isInternalAssistantRateLimited(admin.id)) {
    return NextResponse.json(
      { error: "Assistant limit reached for now — wait a few minutes before continuing." },
      { status: 429 },
    );
  }
  await recordInternalAssistantMessage(admin.id);

  const messages: ChatMessage[] = [
    { role: "system", content: INTERNAL_SYSTEM_PROMPT },
    ...parsed.data.messages.map((m): ChatMessage => ({ role: m.role, content: m.content })),
  ];

  return ndjsonStream(async (send) => {
    try {
      const result = await runToolLoop(
        messages,
        (event) => send({ type: "tool_call", name: event.name, args: event.args }),
        createInternalTools(),
      );

      if (result.allCapped) {
        send({
          type: "capacity",
          message: "Every AI provider is at capacity or capped right now — try again shortly.",
        });
        return;
      }
      if (!result.finalText) {
        send({
          type: "message",
          content: "No answer came back — try rephrasing the question.",
          provider: null,
        });
        return;
      }

      const audited = auditNarrative(result.finalText, result.toolPayloads);
      send({
        type: "message",
        content:
          audited.text ||
          "Every sentence in that answer was stripped by the numeric audit, which means the figures in it were not in any tool result. Ask for a specific table or geography and try again.",
        provider: result.provider,
      });
    } catch {
      send({ type: "error", message: "Something went wrong answering that — please try again." });
    }
  });
}
