import "server-only";
import {
  ProviderRateLimitedError,
  ProviderRequestError,
  ProviderUnavailableError,
  type AIProvider,
  type ChatMessage,
  type ToolCall,
  type ToolDefinition,
} from "./types";

const MODEL = "gemini-flash-latest";
const BASE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

type GeminiPart =
  // `thought` marks an internal reasoning part (thinking models) that must never surface as answer
  // text; `thoughtSignature` is the opaque token that must be echoed back on the model's own
  // function-call parts, per Gemini's 2.5 thinking-model function-calling protocol.
  | { text: string; thought?: boolean }
  | { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

/**
 * Gemini has no "system" role and no "tool" role — a system message becomes `systemInstruction`,
 * and a tool result is folded back in as a `functionResponse` part on a `user`-role turn (the
 * shape Gemini's function-calling protocol expects), keyed by name since Gemini's protocol
 * doesn't carry the OpenAI-style tool_call_id at all.
 */
function toGeminiRequest(messages: ChatMessage[], tools: ToolDefinition[]) {
  const systemInstruction = messages.find((m) => m.role === "system")?.content;
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
    } else if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        // Replay the thoughtSignature Gemini gave us on this call — without it the continuation 400s
        // ("Function call is missing a thought_signature in functionCall parts").
        parts.push({
          functionCall: { name: call.name, args: call.arguments },
          ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
        });
      }
      contents.push({ role: "model", parts });
    } else if (message.role === "tool") {
      let response: Record<string, unknown>;
      try {
        response = JSON.parse(message.content);
      } catch {
        response = { result: message.content };
      }
      contents.push({ role: "user", parts: [{ functionResponse: { name: message.name, response } }] });
    }
  }

  return {
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
    contents,
    tools: tools.length
      ? [
          {
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          },
        ]
      : undefined,
  };
}

function parseToolCalls(parts: GeminiPart[]): ToolCall[] {
  const calls: ToolCall[] = [];
  let index = 0;
  for (const part of parts) {
    if ("functionCall" in part) {
      calls.push({
        id: `${part.functionCall.name}_${index++}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args,
        thoughtSignature: part.thoughtSignature,
      });
    }
  }
  return calls;
}

function parseText(parts: GeminiPart[]): string | null {
  const text = parts
    .filter((part): part is { text: string; thought?: boolean } => "text" in part && part.thought !== true)
    .map((part) => part.text)
    .join("");
  return text || null;
}

export function createGeminiProvider(): AIProvider {
  return {
    id: "gemini",
    async complete(messages, tools) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new ProviderUnavailableError("gemini");

      let response: Response;
      try {
        response = await fetch(`${BASE_URL}?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toGeminiRequest(messages, tools)),
        });
      } catch (cause) {
        throw new ProviderRequestError("gemini", null, cause instanceof Error ? cause.message : "network error");
      }

      if (response.status === 429) {
        throw new ProviderRateLimitedError("gemini");
      }
      if (!response.ok) {
        throw new ProviderRequestError("gemini", response.status, await response.text().catch(() => ""));
      }

      const json = await response.json();
      const parts: GeminiPart[] = json.candidates?.[0]?.content?.parts ?? [];
      return { content: parseText(parts), toolCalls: parseToolCalls(parts) };
    },
  };
}
