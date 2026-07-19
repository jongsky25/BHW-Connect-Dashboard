import "server-only";
import { completeWithCascade } from "./quota";
import { executeTool, TOOL_DEFINITIONS } from "./tools";
import type { ChatMessage, ProviderId } from "./providers/types";

const MAX_TOOL_ROUNDS = 4;

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
 * round limit is hit, at which point tools are withdrawn to force a wrap-up answer). Shared by
 * the narrative generator (single-shot) and the chat route (multi-turn) so both get identical
 * grounding behavior.
 */
export async function runToolLoop(
  initialMessages: ChatMessage[],
  onToolCall?: (event: ToolCallEvent) => void,
): Promise<ToolLoopResult> {
  const messages: ChatMessage[] = [...initialMessages];
  const toolPayloads: unknown[] = [];
  let providerUsed: ProviderId | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await completeWithCascade(messages, TOOL_DEFINITIONS);
    if (result.allCapped) return { finalText: null, toolPayloads, provider: null, allCapped: true };

    providerUsed = result.provider;
    const { content, toolCalls } = result.completion;

    if (toolCalls.length === 0) {
      return { finalText: content, toolPayloads, provider: providerUsed, allCapped: false };
    }

    messages.push({ role: "assistant", content, toolCalls });
    for (const call of toolCalls) {
      onToolCall?.({ name: call.name, args: call.arguments });
      const payload = await executeTool(call.name, call.arguments);
      toolPayloads.push(payload);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(payload) });
    }
  }

  // Out of rounds without a final answer — one last call with tools withdrawn to force a wrap-up
  // from whatever's already been gathered, rather than looping indefinitely.
  const finalAttempt = await completeWithCascade(messages, []);
  if (finalAttempt.allCapped) return { finalText: null, toolPayloads, provider: providerUsed, allCapped: true };
  return {
    finalText: finalAttempt.completion.content,
    toolPayloads,
    provider: finalAttempt.provider,
    allCapped: false,
  };
}
