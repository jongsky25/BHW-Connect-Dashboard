/** JSON-schema-shaped parameter spec for a tool, matching both the OpenAI and Gemini tool-calling formats. */
export type ToolParameterSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
};

export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ProviderCompletion = { content: string | null; toolCalls: ToolCall[] };

export const PROVIDER_IDS = ["gemini", "groq", "openrouter", "mistral"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** One provider's chat/tool-calling client. Every implementation normalizes to this shape so the
 * quota cascade (lib/ai/quota.ts) never needs to know which provider it's talking to. */
export type AIProvider = {
  id: ProviderId;
  complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ProviderCompletion>;
};

/** Thrown when a provider has no API key configured — treated the same as "capped" by the cascade. */
export class ProviderUnavailableError extends Error {
  constructor(public readonly provider: ProviderId) {
    super(`${provider}: no API key configured`);
    this.name = "ProviderUnavailableError";
  }
}

/** Thrown on a 429 (or equivalent quota-exhausted signal) — triggers an immediate pause per §4.5. */
export class ProviderRateLimitedError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(`${provider}: rate limited`);
    this.name = "ProviderRateLimitedError";
  }
}

/** Any other non-2xx response or transport failure. */
export class ProviderRequestError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly status: number | null,
    detail: string,
  ) {
    super(`${provider}: request failed${status ? ` (${status})` : ""} - ${detail.slice(0, 200)}`);
    this.name = "ProviderRequestError";
  }
}
