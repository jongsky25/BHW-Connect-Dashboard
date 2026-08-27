import "server-only";
import { completeWithCascade } from "./quota";
import { executeToolFrom, TOOLS, type Tool } from "./tools";
import type { ChatMessage, ProviderId } from "./providers/types";

const MAX_TOOL_ROUNDS = 4;

/**
 * Appended as a USER turn when the round limit forces a wrap-up — never a second system message.
 * `lib/ai/providers/gemini.ts` builds `systemInstruction` from `messages.find((m) => m.role ===
 * "system")`, which keeps only the FIRST system-role message and silently drops every later one
 * from the request entirely (its `contents`-building loop has `if (message.role === "system")
 * continue`). A nudge sent as a second system message would therefore be invisible to Gemini
 * specifically — confirmed live to be the provider that produced the failure this fixes: five
 * clean completions all landed on Gemini (`ai_provider_quota`, well under its per-minute cap),
 * with nothing logged for any other provider and no error or warning anywhere in the runtime
 * logs, so the empty answer was Gemini returning a genuinely blank completion, not a retry, a
 * rate limit, or a fallback. A `user` turn is the one message shape both provider families
 * (`gemini.ts`, `openai-compatible.ts`) carry through unmodified.
 */
const WRAP_UP_NUDGE =
  "No further tool calls are available. Answer now, using only what the tool results above " +
  "actually show. If nothing above supports a grounded answer, say so plainly and name what " +
  "specific data or document would resolve it — an empty response is not an acceptable answer.";

/** Stronger and more explicit than WRAP_UP_NUDGE, used only for the one retry below — naming the
 * failure directly rather than repeating the same instruction verbatim, since a repeat is exactly
 * what just failed to produce anything. */
const RETRY_NUDGE =
  "Your previous reply had no text in it, which is not acceptable. Write something now: either a " +
  "grounded answer from the tool results above, or an explicit statement of what is missing and " +
  "would be needed to answer. Do not return an empty response again.";

export type ToolCallEvent = { name: string; args: Record<string, unknown> };

export type ToolLoopResult = {
  finalText: string | null;
  /** Every tool-result payload returned this run — the sole basis for lib/ai/audit.ts's numeric audit. */
  toolPayloads: unknown[];
  provider: ProviderId | null;
  allCapped: boolean;
};

/**
 * Drives one tool-calling conversation to completion: call the provider cascade, execute any
 * tool calls it requests, feed the results back, repeat until it returns plain content (or the
 * round limit is hit, at which point tools are withdrawn and the model is explicitly told this
 * turn must produce an answer, with one retry if it still does not). Shared by the narrative
 * generator (single-shot) and the chat route (multi-turn) so both get identical grounding
 * behavior.
 *
 * `tools` defaults to the public set. The internal assistant (Increment 1.4) passes the
 * registry-driven set instead, so scope is decided by which tools exist in the loop rather than by
 * what a system prompt asks the model not to call.
 */
export async function runToolLoop(
  initialMessages: ChatMessage[],
  onToolCall?: (event: ToolCallEvent) => void,
  tools: Tool[] = TOOLS,
): Promise<ToolLoopResult> {
  const toolDefinitions = tools.map((tool) => tool.definition);
  const messages: ChatMessage[] = [...initialMessages];
  const toolPayloads: unknown[] = [];
  let providerUsed: ProviderId | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await completeWithCascade(messages, toolDefinitions);
    if (result.allCapped) return { finalText: null, toolPayloads, provider: null, allCapped: true };

    providerUsed = result.provider;
    const { content, toolCalls } = result.completion;

    if (toolCalls.length === 0) {
      return { finalText: content, toolPayloads, provider: providerUsed, allCapped: false };
    }

    messages.push({ role: "assistant", content, toolCalls });
    for (const call of toolCalls) {
      onToolCall?.({ name: call.name, args: call.arguments });
      const payload = await executeToolFrom(tools, call.name, call.arguments);
      toolPayloads.push(payload);
      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(payload),
      });
    }
  }

  // Out of rounds without a final answer — one last call with tools withdrawn to force a wrap-up
  // from whatever's already been gathered, rather than looping indefinitely. Withdrawing the
  // tools was already true; what was missing is telling the model that this turn is the one that
  // must produce text, which is the gap that let a clean, error-free completion come back blank.
  messages.push({ role: "user", content: WRAP_UP_NUDGE });
  const finalAttempt = await completeWithCascade(messages, []);
  if (finalAttempt.allCapped)
    return { finalText: null, toolPayloads, provider: providerUsed, allCapped: true };
  if (finalAttempt.completion.content?.trim()) {
    return {
      finalText: finalAttempt.completion.content,
      toolPayloads,
      provider: finalAttempt.provider,
      allCapped: false,
    };
  }

  // The nudge alone still returned nothing — an observed failure, not a hypothetical one, so it
  // gets one retry rather than falling straight through to "no answer came back". The model's own
  // empty turn goes back into history first, so the retry can see what it just failed to do and
  // the stronger nudge reads as a correction rather than a repeat of an instruction that already
  // did not work.
  messages.push({
    role: "assistant",
    content: finalAttempt.completion.content,
    toolCalls: finalAttempt.completion.toolCalls,
  });
  messages.push({ role: "user", content: RETRY_NUDGE });
  const retryAttempt = await completeWithCascade(messages, []);
  if (retryAttempt.allCapped)
    return { finalText: null, toolPayloads, provider: finalAttempt.provider, allCapped: true };
  return {
    finalText: retryAttempt.completion.content,
    toolPayloads,
    provider: retryAttempt.provider,
    allCapped: false,
  };
}
