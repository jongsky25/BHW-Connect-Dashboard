import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/providers";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { executeTool, TOOL_DEFINITIONS } from "@/lib/ai/tools";
import type { ChatMessage } from "@/lib/ai/providers/types";

export const runtime = "nodejs";

// TEMPORARY diagnostic endpoint (folder must not start with "_" — Next.js treats "_foo" as a private
// folder and excludes it from routing). Reproduces the two-step Gemini tool-calling flow (initial call →
// tool result fed back → continuation) and returns whatever the provider throws, so the exact
// upstream error on the failing continuation is visible without Vercel log access. Secret-gated and
// to be removed before this branch merges.
const DIAG_SECRET = "diag-7f3a9c2b";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== DIAG_SECRET) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const gemini = getProvider("gemini");
  const question = "How many total BHWs are there nationally? One sentence.";
  const out: Record<string, unknown> = {};

  // Step 1 — initial call, expect a tool call (this succeeds in production).
  let first;
  try {
    first = await gemini.complete(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
      TOOL_DEFINITIONS,
    );
    out.first = { content: first.content, toolCalls: first.toolCalls };
  } catch (e) {
    out.firstError = e instanceof Error ? { name: e.name, message: e.message } : String(e);
    return NextResponse.json(out);
  }

  if (first.toolCalls.length === 0) return NextResponse.json({ note: "no tool call on first turn", ...out });

  // Step 2 — execute the tool and feed the result back, then call again. This continuation is the
  // one that fails in the live chat loop.
  const call = first.toolCalls[0];
  const payload = await executeTool(call.name, call.arguments);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question },
    { role: "assistant", content: first.content, toolCalls: first.toolCalls },
    { role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(payload) },
  ];
  try {
    const second = await gemini.complete(messages, TOOL_DEFINITIONS);
    out.second = { content: second.content, toolCalls: second.toolCalls };
  } catch (e) {
    out.secondError = e instanceof Error ? { name: e.name, message: e.message } : String(e);
  }
  return NextResponse.json(out);
}
