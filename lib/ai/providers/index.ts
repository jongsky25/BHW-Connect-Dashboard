import "server-only";
import { createGeminiProvider } from "./gemini";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import type { AIProvider, ProviderId } from "./types";

export * from "./types";

/** Fixed priority order per BUILD_PLAN.md §2/§4.5 — never reordered at runtime. */
export const PROVIDER_CASCADE: ProviderId[] = ["gemini", "groq", "openrouter", "mistral"];

const REGISTRY: Record<ProviderId, AIProvider> = {
  gemini: createGeminiProvider(),
  groq: createOpenAICompatibleProvider({
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
  }),
  openrouter: createOpenAICompatibleProvider({
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    apiKeyEnv: "OPENROUTER_API_KEY",
    // Required by OpenRouter for attribution on the free tier — see docs/DECISIONS.md 2.1.
    extraHeaders: {
      "HTTP-Referer": "https://bhw-connect-jongsky25s-projects.vercel.app",
      "X-Title": "BHW Connect",
    },
  }),
  mistral: createOpenAICompatibleProvider({
    id: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    apiKeyEnv: "MISTRAL_API_KEY",
  }),
};

export function getProvider(id: ProviderId): AIProvider {
  return REGISTRY[id];
}
