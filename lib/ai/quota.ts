import "server-only";
import { createSupabaseServiceClient } from "@/lib/db/service-client";
import { getProvider, PROVIDER_CASCADE } from "./providers";
import {
  ProviderRateLimitedError,
  ProviderRequestError,
  ProviderUnavailableError,
  type ChatMessage,
  type ProviderCompletion,
  type ProviderId,
  type ToolDefinition,
} from "./providers/types";

type WindowType = "minute" | "day";

/**
 * Seed values for a provider's *first* window row of each type — re-verified against each
 * provider's official docs at implementation time (2.1, see docs/DECISIONS.md). Deliberately
 * conservative where a provider no longer publishes a static number (Gemini, Mistral). Once a
 * row exists, its `limit_value` — not this constant — governs; an operator can raise or lower a
 * provider's live limit by editing the `ai_provider_quota` row directly, per BUILD_PLAN.md §4.5
 * ("store limits as rows... never as code constants").
 */
const SEED_LIMITS: Record<ProviderId, Record<WindowType, number>> = {
  gemini: { minute: 10, day: 1000 },
  groq: { minute: 30, day: 1000 },
  openrouter: { minute: 20, day: 50 },
  mistral: { minute: 1, day: 50 },
};

function windowStart(windowType: WindowType, now: Date): string {
  const d = new Date(now);
  if (windowType === "minute") {
    d.setUTCSeconds(0, 0);
  } else {
    d.setUTCHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

type QuotaRow = {
  id: number;
  request_count: number;
  limit_value: number;
  is_paused: boolean;
  paused_until: string | null;
};

async function getOrInitWindow(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  provider: ProviderId,
  windowType: WindowType,
  now: Date,
): Promise<QuotaRow> {
  const start = windowStart(windowType, now);
  const { data: existing } = await supabase
    .from("ai_provider_quota")
    .select("id, request_count, limit_value, is_paused, paused_until")
    .eq("provider", provider)
    .eq("window_type", windowType)
    .eq("window_start", start)
    .maybeSingle();
  if (existing) return existing;

  const { data: inserted } = await supabase
    .from("ai_provider_quota")
    .insert({
      provider,
      window_type: windowType,
      window_start: start,
      limit_value: SEED_LIMITS[provider][windowType],
    })
    .select("id, request_count, limit_value, is_paused, paused_until")
    .single();
  if (inserted) return inserted;

  // Lost the insert race to a concurrent request — the row now exists, read it back.
  const { data: retry } = await supabase
    .from("ai_provider_quota")
    .select("id, request_count, limit_value, is_paused, paused_until")
    .eq("provider", provider)
    .eq("window_type", windowType)
    .eq("window_start", start)
    .single();
  if (retry) return retry;

  throw new Error(`Could not initialize quota window for ${provider}/${windowType}`);
}

export type QuotaCheckResult =
  | { available: true }
  | { available: false; reason: "paused" | "capped_minute" | "capped_day" | "unavailable" };

/**
 * Check-before-call, per provider — never attempt a request the provider is already known to be
 * over quota for. Treats a failure to even read quota state (e.g. `SUPABASE_SERVICE_ROLE_KEY`
 * unconfigured) as unavailable rather than letting it throw — every provider shares the same
 * service client, so this failure mode is identical across the whole cascade and correctly
 * collapses to `completeWithCascade`'s `allCapped` signal instead of crashing the caller (see
 * docs/DECISIONS.md 2.4, caught via an actual local run of the chat route).
 */
export async function checkQuota(provider: ProviderId, now: Date = new Date()): Promise<QuotaCheckResult> {
  let minuteRow: QuotaRow;
  let dayRow: QuotaRow;
  try {
    const supabase = createSupabaseServiceClient();
    [minuteRow, dayRow] = await Promise.all([
      getOrInitWindow(supabase, provider, "minute", now),
      getOrInitWindow(supabase, provider, "day", now),
    ]);
  } catch {
    return { available: false, reason: "unavailable" };
  }

  if (dayRow.is_paused && dayRow.paused_until && new Date(dayRow.paused_until) > now) {
    return { available: false, reason: "paused" };
  }
  if (minuteRow.request_count >= minuteRow.limit_value) return { available: false, reason: "capped_minute" };
  if (dayRow.request_count >= dayRow.limit_value) return { available: false, reason: "capped_day" };
  return { available: true };
}

async function reserveRequest(provider: ProviderId, now: Date = new Date()): Promise<void> {
  const supabase = createSupabaseServiceClient();
  for (const windowType of ["minute", "day"] as const) {
    const row = await getOrInitWindow(supabase, provider, windowType, now);
    await supabase
      .from("ai_provider_quota")
      .update({ request_count: row.request_count + 1 })
      .eq("id", row.id);
  }
}

/** On an unexpected 429, pause the provider immediately rather than retrying it this window. */
async function recordRateLimited(
  provider: ProviderId,
  retryAfterSeconds: number | null,
  now: Date = new Date(),
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const dayRow = await getOrInitWindow(supabase, provider, "day", now);
  const pauseMs = Math.max((retryAfterSeconds ?? 60) * 1000, 60_000);
  await supabase
    .from("ai_provider_quota")
    .update({ is_paused: true, paused_until: new Date(now.getTime() + pauseMs).toISOString() })
    .eq("id", dayRow.id);
}

export type CascadeResult =
  | { allCapped: false; provider: ProviderId; completion: ProviderCompletion }
  | { allCapped: true; provider: null };

/**
 * Try each provider in fixed priority order (BUILD_PLAN.md §2/§4.5), skipping any that's already
 * capped/paused/unconfigured, pausing one that returns a live 429, and returning an explicit
 * all-capped signal — never an error — when every provider is exhausted. Callers (lib/ai/narrative.ts,
 * app/api/ai/chat/route.ts) turn `allCapped: true` into cached-content/honest-status fallbacks.
 */
export async function completeWithCascade(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  now: Date = new Date(),
): Promise<CascadeResult> {
  for (const providerId of PROVIDER_CASCADE) {
    const check = await checkQuota(providerId, now);
    if (!check.available) continue;

    try {
      await reserveRequest(providerId, now);
      const completion = await getProvider(providerId).complete(messages, tools);
      return { allCapped: false, provider: providerId, completion };
    } catch (err) {
      if (err instanceof ProviderRateLimitedError) {
        console.warn(`[ai] ${providerId} rate-limited (retryAfter=${err.retryAfterSeconds ?? "n/a"}s) — pausing`);
        await recordRateLimited(providerId, err.retryAfterSeconds, now);
        continue;
      }
      // No API key configured — expected for providers the operator hasn't set up; not worth logging.
      if (err instanceof ProviderUnavailableError) continue;
      // A real non-2xx / transport failure from a configured provider — the diagnostic that actually
      // matters, otherwise invisible: the cascade turns it into a silent "all capped" downstream.
      if (err instanceof ProviderRequestError) {
        console.error(`[ai] ${providerId} request failed (status=${err.status ?? "n/a"}): ${err.message}`);
        continue;
      }
      console.error(`[ai] ${providerId} unexpected error:`, err);
      continue;
    }
  }
  return { allCapped: true, provider: null };
}
