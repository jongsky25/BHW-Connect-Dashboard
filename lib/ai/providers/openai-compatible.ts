import "server-only";
import {
  ProviderRateLimitedError,
  ProviderRequestError,
  ProviderUnavailableError,
  type AIProvider,
  type ChatMessage,
  type ProviderId,
  type ToolCall,
  type ToolDefinition,
} from "./types";

type OpenAICompatibleConfig = {
  id: ProviderId;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  extraHeaders?: Record<string, string>;
};

type OpenAIToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

function toOpenAIMessages(messages: ChatMessage[]) {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls?.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      };
    }
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    return { role: message.role, content: message.content };
  });
}

function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

function parseToolCalls(raw: OpenAIToolCall[] | undefined): ToolCall[] {
  if (!raw) return [];
  return raw.map((call) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      args = {};
    }
    return { id: call.id, name: call.function.name, arguments: args };
  });
}

/**
 * Factory for any provider exposing an OpenAI-compatible `/chat/completions` endpoint — covers
 * Groq, OpenRouter, and Mistral (all three), so the request/response translation is written once.
 * Gemini needs its own implementation (lib/ai/providers/gemini.ts) — its native REST API uses a
 * different request/response shape for both messages and function-calling.
 */
export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): AIProvider {
  return {
    id: config.id,
    async complete(messages, tools) {
      const apiKey = process.env[config.apiKeyEnv];
      if (!apiKey) throw new ProviderUnavailableError(config.id);

      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            ...config.extraHeaders,
          },
          body: JSON.stringify({
            model: config.model,
            messages: toOpenAIMessages(messages),
            tools: tools.length ? toOpenAITools(tools) : undefined,
          }),
        });
      } catch (cause) {
        throw new ProviderRequestError(config.id, null, cause instanceof Error ? cause.message : "network error");
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        throw new ProviderRateLimitedError(config.id, retryAfter ? Number(retryAfter) : null);
      }
      if (!response.ok) {
        throw new ProviderRequestError(config.id, response.status, await response.text().catch(() => ""));
      }

      const json = await response.json();
      const choice = json.choices?.[0]?.message;
      return {
        content: choice?.content ?? null,
        toolCalls: parseToolCalls(choice?.tool_calls),
      };
    },
  };
}
