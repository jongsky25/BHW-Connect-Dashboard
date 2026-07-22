import "server-only";
import { createSupabaseServiceClient } from "./service-client";

/**
 * Admin-side reads and curation writes for the Ask-the-Data answer bank (docs/ASK_CACHE_PLAN.md
 * §6, Phase A3). `ai_ask_cache`/`ai_ask_log` are service-role-only, so every call here goes
 * through the service client — same pattern as lib/db/usage-analytics.ts and lib/db/admin.ts.
 * Reads return empty on a query error but, like those siblings, don't defensively catch an
 * unconfigured client: the `/admin` layout's auth gate has already established a working service
 * client before any page under it runs, so that failure mode can't reach here. The public
 * serving path (lib/ai/ask-cache.ts) is the one that fails fully open.
 */

export type AskBankStatus = "auto" | "approved" | "blocked";

export const ASK_BANK_STATUSES: AskBankStatus[] = ["auto", "approved", "blocked"];

export function isAskBankStatus(value: unknown): value is AskBankStatus {
  return typeof value === "string" && (ASK_BANK_STATUSES as string[]).includes(value);
}

export type AskBankRow = {
  cacheKey: string;
  questionDisplay: string;
  questionNorm: string;
  geoCode: string | null;
  answerMd: string;
  provider: string | null;
  dataVersion: string;
  status: AskBankStatus;
  hitCount: number;
  generatedAt: string;
  lastHitAt: string | null;
};

/** Every bank entry, most-hit first — the curation worklist. Bounded; the bank is small by
 * nature (one row per distinct question × geo × dataset version). */
export async function listAskBank(limit = 200): Promise<AskBankRow[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("ai_ask_cache")
    .select(
      "cache_key, question_display, question_norm, geo_code, answer_md, provider, data_version, status, hit_count, generated_at, last_hit_at",
    )
    .order("hit_count", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map((row) => ({
    cacheKey: row.cache_key,
    questionDisplay: row.question_display,
    questionNorm: row.question_norm,
    geoCode: row.geo_code,
    answerMd: row.answer_md,
    provider: row.provider,
    dataVersion: row.data_version,
    status: (isAskBankStatus(row.status) ? row.status : "auto"),
    hitCount: row.hit_count,
    generatedAt: row.generated_at,
    lastHitAt: row.last_hit_at,
  }));
}

export type AskLogGroup = {
  questionNorm: string;
  /** A recent raw phrasing, for display. */
  sample: string;
  asks: number;
  servedLive: number;
  servedFromCache: number;
  lastAskedAt: string;
  /** Distinct geo scopes this question was asked under ("national" for no page context). */
  geoScopes: string[];
};

/**
 * Frequent questions from the capture log, grouped by normalized question over a bounded recent
 * scan and aggregated in memory — the "what do people actually ask" view (plan §6 A3.1), and the
 * shortlist of what's worth curating. Mirrors usage-analytics.ts's bounded-scan approach rather
 * than adding a SQL rollup.
 */
export async function listFrequentQuestions(sinceDays = 30, limit = 50): Promise<AskLogGroup[]> {
  const supabase = createSupabaseServiceClient();
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("ai_ask_log")
    .select("question_norm, question_raw, geo_code, served_from, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error || !data) return [];

  const groups = new Map<string, AskLogGroup & { scopeSet: Set<string> }>();
  for (const row of data) {
    let g = groups.get(row.question_norm);
    if (!g) {
      g = {
        questionNorm: row.question_norm,
        sample: row.question_raw,
        asks: 0,
        servedLive: 0,
        servedFromCache: 0,
        lastAskedAt: row.created_at,
        geoScopes: [],
        scopeSet: new Set<string>(),
      };
      groups.set(row.question_norm, g);
    }
    g.asks += 1;
    if (row.served_from === "cache") g.servedFromCache += 1;
    else g.servedLive += 1;
    g.scopeSet.add(row.geo_code ?? "national");
    // rows arrive newest-first, so the first-seen created_at is the most recent
  }

  return [...groups.values()]
    .map(({ scopeSet, ...g }) => ({ ...g, geoScopes: [...scopeSet] }))
    .sort((a, b) => b.asks - a.asks)
    .slice(0, limit);
}

/**
 * Set a bank entry's curation status (plan §6 A3.2). `blocked` makes the serving path miss the
 * question forever (always live) and — because storeAskAnswer never overwrites a non-`auto` row —
 * stops it being repopulated; `approved` pins it so a fresh generation can't clobber it;
 * resetting to `auto` returns it to lazy regeneration.
 */
export async function setAskBankStatus(cacheKey: string, status: AskBankStatus): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("ai_ask_cache").update({ status }).eq("cache_key", cacheKey);
  return !error;
}

/** Edit an entry's answer text and pin it (`approved`) so write-back can't overwrite the edit. */
export async function updateAskBankAnswer(cacheKey: string, answerMd: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("ai_ask_cache")
    .update({ answer_md: answerMd, status: "approved" })
    .eq("cache_key", cacheKey);
  return !error;
}

/** Remove an entry entirely — for a bad `auto` capture you want regenerated fresh on next ask.
 * (To make a question always go live instead, block it — deletion lets it be recaptured.) */
export async function deleteAskBankEntry(cacheKey: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("ai_ask_cache").delete().eq("cache_key", cacheKey);
  return !error;
}

export type AskCacheSavings = { liveMessages: number; cacheHits: number };

/** Credit-savings signal from usage_events (plan §4 A2.5): live chat turns vs answer-bank hits
 * over the window. Hit rate = cacheHits / (cacheHits + liveMessages). Bounded scan. */
export async function getAskCacheSavings(sinceDays = 30): Promise<AskCacheSavings> {
  const supabase = createSupabaseServiceClient();
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("usage_events")
    .select("event_type")
    .in("event_type", ["ai_chat_message", "ai_chat_cache_hit"])
    .gte("created_at", since)
    .limit(20_000);

  if (error || !data) return { liveMessages: 0, cacheHits: 0 };
  let liveMessages = 0;
  let cacheHits = 0;
  for (const row of data) {
    if (row.event_type === "ai_chat_cache_hit") cacheHits += 1;
    else liveMessages += 1;
  }
  return { liveMessages, cacheHits };
}
