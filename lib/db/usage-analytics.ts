import "server-only";
import { createSupabaseServiceClient } from "./service-client";

/**
 * `usage_events`/`feedback` are insert-only to the public (no SELECT policy — see 0.3), so every
 * read here goes through the service-role client. Reserved for the precompute cron (2.3, ranking
 * places to precompute AI narratives for) and the admin usage dashboard (2.5).
 */

export type VisitedGeo = { geoCode: string; visits: number };

/**
 * Most-visited geos by page view in the last `sinceDays` days, ranked by a bounded recent-events
 * scan aggregated in memory — a good-enough ranking for "which places to precompute narratives
 * for," not an exhaustive analytics query (BUILD_PLAN.md's `usage_events` has no pre-built
 * per-geo rollup; adding a real one is out of scope for this).
 */
export async function getTopVisitedGeos(limit = 20, sinceDays = 30): Promise<VisitedGeo[]> {
  const supabase = createSupabaseServiceClient();
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("usage_events")
    .select("geo_code")
    .not("geo_code", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error || !data) return [];

  const counts = new Map<string, number>();
  for (const row of data) {
    if (!row.geo_code) continue;
    counts.set(row.geo_code, (counts.get(row.geo_code) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([geoCode, visits]) => ({ geoCode, visits }));
}

export type EventTypeCount = { eventType: string; count: number };

/** Event-type breakdown over the last `sinceDays` days — backs the admin usage dashboard (2.5). */
export async function getUsageEventCounts(sinceDays = 30): Promise<EventTypeCount[]> {
  const supabase = createSupabaseServiceClient();
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("usage_events")
    .select("event_type")
    .gte("created_at", since)
    .limit(10_000);

  if (error || !data) return [];

  const counts = new Map<string, number>();
  for (const row of data) {
    counts.set(row.event_type, (counts.get(row.event_type) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([eventType, count]) => ({ eventType, count }));
}
