import "server-only";
import { createSupabaseServiceClient } from "@/lib/db/service-client";

const WINDOW_MINUTES = 10;
const MAX_MESSAGES_PER_WINDOW = 20;
/** The internal assistant's ceiling (docs/AI_ASSISTANT_PLAN.md §8, Increment 1.4: "relaxed rate
 * limits"). Relaxed, not removed: an admin exploring a question is low-volume and trusted, but the
 * provider quota it spends is the same free-tier budget the public chat depends on, so a runaway
 * loop must still hit a wall. Keyed on the admin's user id rather than a browser session. */
const MAX_INTERNAL_MESSAGES_PER_WINDOW = 60;
export const CHAT_EVENT_TYPE = "ai_chat_message";
export const CACHE_HIT_EVENT_TYPE = "ai_chat_cache_hit";
/** Its own event type, so internal exploration never lands in the public chat's usage figures. */
export const INTERNAL_EVENT_TYPE = "ai_assistant_message";

/** Per-session chat rate limit (BUILD_PLAN.md §8 2.4), backed by the existing `usage_events` log
 * rather than a new table — a chat turn is logged as a `ai_chat_message` event either way. Fails
 * open (not limited) on any read failure — including `createSupabaseServiceClient()` throwing
 * when unconfigured — since a false negative here just costs one extra AI call, while a false
 * positive (or an uncaught throw taking down the whole chat route with a 500) blocks a real
 * visitor for no reason. */
export async function isChatRateLimited(sessionId: string): Promise<boolean> {
  return isRateLimited(sessionId, CHAT_EVENT_TYPE, MAX_MESSAGES_PER_WINDOW);
}

async function isRateLimited(sessionId: string, eventType: string, max: number): Promise<boolean> {
  try {
    const supabase = createSupabaseServiceClient();
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const { count, error } = await supabase
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("event_type", eventType)
      .gte("created_at", since);

    if (error) return false;
    return (count ?? 0) >= max;
  } catch {
    return false;
  }
}

/** Per-admin limit for the internal assistant, same mechanism and same fail-open posture as the
 * public one, counted over its own event type. */
export async function isInternalAssistantRateLimited(adminUserId: string): Promise<boolean> {
  return isRateLimited(adminUserId, INTERNAL_EVENT_TYPE, MAX_INTERNAL_MESSAGES_PER_WINDOW);
}

/** Records one internal assistant turn against the admin's own id. */
export async function recordInternalAssistantMessage(adminUserId: string): Promise<void> {
  await recordEvent(adminUserId, null, INTERNAL_EVENT_TYPE);
}

/** Best-effort logging — a failure here (including an unconfigured service client) must never
 * block or crash the chat turn it's logging. */
export async function recordChatMessage(sessionId: string, geoCode: string | null): Promise<void> {
  await recordEvent(sessionId, geoCode, CHAT_EVENT_TYPE);
}

/** Answer-bank hits are logged under their own event type so they're measurable (hit rate =
 * cache_hit / (cache_hit + chat_message) over usage_events) and deliberately do NOT count
 * against the rate limit above — a hit costs no provider credits (ASK_CACHE_PLAN.md §0 #1). */
export async function recordChatCacheHit(sessionId: string, geoCode: string | null): Promise<void> {
  await recordEvent(sessionId, geoCode, CACHE_HIT_EVENT_TYPE);
}

async function recordEvent(
  sessionId: string,
  geoCode: string | null,
  eventType: string,
): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient();
    await supabase.from("usage_events").insert({
      session_id: sessionId,
      event_type: eventType,
      geo_code: geoCode,
    });
  } catch {
    // best-effort
  }
}
