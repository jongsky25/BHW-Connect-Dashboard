import { NextResponse } from "next/server";
import { z } from "zod";
import { runToolLoop } from "@/lib/ai/agent-loop";
import { auditNarrative } from "@/lib/ai/audit";
import { auditCitations, collectCitations, type Citation } from "@/lib/ai/citations";
import { createInternalTools } from "@/lib/ai/dataset-tools";
import { figureFromPayloads, type AssistantFigure } from "@/lib/ai/figure-from-payload";
import { suggestFollowUps } from "@/lib/ai/follow-ups";
import { INTERNAL_SYSTEM_PROMPT } from "@/lib/ai/internal-system-prompt";
import {
  pinnedRouteSchema,
  routeScopeSchema,
  routeSystemFacts,
  type AssistantRoute,
} from "@/lib/ai/route";
import { routeRequest } from "@/lib/ai/route-request";
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
  // Increment 5.1. What the reader pinned on the chips (lane and output only — see
  // `pinnedRouteSchema` for why scope is not pinnable).
  pinnedRoute: pinnedRouteSchema.optional(),
  // The place the previous turn resolved, so a follow-up that names none still has one. A
  // fallback, never an override: a question that names its own place always wins. Shape-checked
  // here and re-derived from `dim_geo` by `routeRequest`, because this schema can prove a string
  // is twenty characters but not that it names a place.
  carriedScope: routeScopeSchema.nullable().optional(),
});

/** Same NDJSON event vocabulary as the public chat, plus the tool result — internal users need to
 * see what a query actually returned, not just that one ran. */
type AssistantStreamEvent =
  // Increment 5.1. Emitted before any tool runs, so the chips render while the loop is still
  // working and the reader can see what the question was taken to be *before* the answer lands.
  | { type: "route"; route: AssistantRoute }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  // Increment 5.2. `followUps` are derived from this turn's tool payloads by a pure function,
  // never authored by the model — a suggested question is a promise the assistant can answer it.
  | { type: "message"; content: string; provider: string | null; followUps: string[] }
  // Increment 2.3. Emitted from the retrieval payload, never from the answer text: the model does
  // not get to author its own citations, so it cannot mis-cite a passage it was never handed.
  // `droppedPages` names the pages a sentence claimed before the citation audit removed it.
  | { type: "citations"; citations: Citation[]; droppedPages: number[] }
  // Increment 5.6. Built from the tool payloads, never from the answer text — the same inversion
  // as the citations above: a model cannot mis-plot data it was never handed.
  | { type: "figure"; figure: AssistantFigure }
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
 *
 * Increment 2.3 adds a second audit beside it, for the half the first one cannot see. The numeric
 * audit checks numbers; a document claim carries no number and passes untouched, so per §7 its
 * citation is the only check it gets. `auditCitations` therefore drops any sentence naming a
 * document page that was not retrieved this turn, and `collectCitations` emits the passages that
 * *were* — which is what the UI renders and links to. Both run on the same `toolPayloads` the
 * numeric audit uses, in the same place, for the same reason: evidence comes from the tool
 * results, never from the prose.
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

  // Increment 5.1. Routed off the latest user turn — the route describes the question being asked,
  // not the conversation, and a follow-up ("and its training coverage?") gets its scope from the
  // pin the client carries forward rather than from re-reading the history.
  const lastUserTurn = [...parsed.data.messages].reverse().find((m) => m.role === "user");
  const route = await routeRequest(
    lastUserTurn?.content ?? "",
    parsed.data.pinnedRoute,
    parsed.data.carriedScope,
  );

  // Concatenated into the single system message, never appended as a second one:
  // `lib/ai/providers/gemini.ts` builds `systemInstruction` from the first system-role message and
  // drops every later one, so a second system message would be invisible on the provider the
  // cascade reaches first — the same trap `agent-loop.ts` documents for its wrap-up nudge.
  const messages: ChatMessage[] = [
    { role: "system", content: INTERNAL_SYSTEM_PROMPT + routeSystemFacts(route) },
    ...parsed.data.messages.map((m): ChatMessage => ({ role: m.role, content: m.content })),
  ];

  return ndjsonStream(async (send) => {
    send({ type: "route", route });
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
          followUps: [],
        });
        return;
      }

      // Pages first, then numbers. A sentence must pass both, so the order cannot change which
      // sentences survive — but it decides which check gets to explain a removal, and the two
      // overlap more than they look. `auditNarrative` counts a slide number as a number, so
      // "per slide 42" is usually stripped for containing an untraceable 42 before the citation
      // pass ever sees it, and the reader is told the *figures* were ungrounded when the actual
      // fault was a fabricated page. Running citations first reports the specific, actionable
      // failure and names the slide.
      //
      // This also makes clear where the citation pass is genuinely load-bearing rather than
      // redundant: when a fabricated page number happens to appear elsewhere in the payloads —
      // 42 as a row count, say — the numeric audit passes it and only this check catches it.
      const citations = collectCitations(result.toolPayloads);
      const cited = auditCitations(result.finalText, citations);
      const audited = auditNarrative(cited.text, result.toolPayloads);

      const droppedPages = [...new Set(cited.rejected.flatMap((r) => r.pages))];
      const strippedEverything = Boolean(result.finalText.trim()) && !audited.text;

      send({
        type: "message",
        followUps: suggestFollowUps(route, result.toolPayloads),
        content:
          audited.text ||
          (droppedPages.length > 0
            ? `That answer cited ${droppedPages.length === 1 ? "a slide" : "slides"} (${droppedPages.join(", ")}) that no document search returned, so it was dropped. Ask again and it will search before answering.`
            : strippedEverything
              ? "Every sentence in that answer was stripped by the numeric audit, which means the figures in it were not in any tool result. Ask for a specific table or geography and try again."
              : "No answer came back — try rephrasing the question."),
        provider: result.provider,
      });

      // After the message, so the answer renders first and its sources settle beneath it.
      if (citations.length > 0 || droppedPages.length > 0) {
        send({ type: "citations", citations, droppedPages });
      }

      // Only when the reader asked for one. A chart is an answer to "show me", not a decoration
      // on every reply, and an unasked-for figure below a two-line answer is noise.
      if (route.output === "chart" || route.output === "slide") {
        const figure = figureFromPayloads(result.toolPayloads);
        if (figure) send({ type: "figure", figure });
      }
    } catch {
      send({ type: "error", message: "Something went wrong answering that — please try again." });
    }
  });
}
