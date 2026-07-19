import "server-only";
import { createSupabaseServiceClient } from "@/lib/db/service-client";

const WINDOW_MINUTES = 10;
const MAX_MESSAGES_PER_WINDOW = 20;
export const CHAT_EVENT_TYPE = "ai_chat_message";

/** Per-session chat rate limit (BUILD_PLAN.md §8 2.4), backed by the existing `usage_events` log
 * rather than a new table — a chat turn is logged as a `ai_chat_message` event either way. Fails
 * open (not limited) on any read failure — including `createSupabaseServiceClient()` throwing
 * when unconfigured — since a false negative here just costs one extra AI call, while a false
 * positive (or an uncaught throw taking down the whole chat route with a 500) blocks a real
 * visitor for no reason. */
export async function isChatRateLimited(sessionId: string): Promise<boolean> {
  try {
    const supabase = createSupabaseServiceClient();
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const { count, error } = await supabase
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("event_type", CHAT_EVENT_TYPE)
      .gte("created_at", since);

    if (error) return false;
    return (count ?? 0) >= MAX_MESSAGES_PER_WINDOW;
  } catch {
    return false;
  }
}

/** Best-effort logging — a failure here (including an unconfigured service client) must never
 * block or crash the chat turn it's logging. */
export async function recordChatMessage(sessionId: string, geoCode: string | null): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient();
    await supabase.from("usage_events").insert({
      session_id: sessionId,
      event_type: CHAT_EVENT_TYPE,
      geo_code: geoCode,
    });
  } catch {
    // best-effort
  }
}
