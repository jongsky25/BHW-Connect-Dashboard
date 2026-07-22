import "server-only";
import { createSupabaseServiceClient } from "@/lib/db/service-client";

/**
 * Ask-the-Data answer bank (docs/ASK_CACHE_PLAN.md §4): the first-layer response for single-turn
 * chat questions. A question the tool loop has already answered — and the numeric audit already
 * verified — is served straight from `ai_ask_cache` at zero provider cost. Every read/write here
 * fails open (a miss / a no-op), matching lib/ai/rate-limit.ts: the bank must never be able to
 * break the chat route, only make it cheaper.
 */

/** Stripped once each from the front of a normalized question. Fixed and tiny on purpose — every
 * extra rewrite rule is a chance for two genuinely different questions to collide, and a
 * collision serves a wrong answer while a miss just costs one live call (plan §5). */
const POLITENESS_PREFIXES = ["please ", "pls ", "can you ", "could you "];

/**
 * The exact-match cache key surface (plan §5): NFKC → lowercase → collapse whitespace → strip
 * terminal punctuation → strip leading politeness prefixes. Nothing cleverer — bias toward
 * missing, never toward colliding.
 */
export function normalizeQuestion(raw: string): string {
  let q = raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  q = q.replace(/[?.!]+$/, "").trimEnd();
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of POLITENESS_PREFIXES) {
      if (q.startsWith(prefix)) {
        q = q.slice(prefix.length).trimStart();
        stripped = true;
      }
    }
  }
  return q;
}

/** `data_version|geo_scope|question_norm` — same shape and delimiter as ai_narrative_cache's key.
 * Geo context is part of the question: the route injects "currently viewing geo_code X" into the
 * system prompt, so identical words mean different answers on different place pages. */
export function askCacheKey(dataVersion: string, geoCode: string | null, questionNorm: string): string {
  return `${dataVersion}|${geoCode ?? "national"}|${questionNorm}`;
}

export type AskCacheHit = { answerMd: string; provider: string | null };

/** Best-effort hit_count/last_hit_at bump, shared by the exact and near-match paths. Racy under
 * concurrent hits by design — it's a popularity signal for the A3 curation page, not accounting. */
async function bumpHitCount(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  cacheKey: string,
  currentCount: number,
): Promise<void> {
  await supabase
    .from("ai_ask_cache")
    .update({ hit_count: currentCount + 1, last_hit_at: new Date().toISOString() })
    .eq("cache_key", cacheKey);
}

/**
 * Bank lookup for a single-turn question. Returns null (a miss) for blocked entries and on any
 * error, including an unconfigured service client.
 */
export async function lookupAskCache(
  questionNorm: string,
  geoCode: string | null,
  dataVersion: string,
): Promise<AskCacheHit | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const key = askCacheKey(dataVersion, geoCode, questionNorm);
    const { data, error } = await supabase
      .from("ai_ask_cache")
      .select("answer_md, provider, status, hit_count")
      .eq("cache_key", key)
      .maybeSingle();

    if (error || !data || data.status === "blocked" || !data.answer_md) return null;

    await bumpHitCount(supabase, key, data.hit_count);
    return { answerMd: data.answer_md, provider: data.provider };
  } catch {
    return null;
  }
}

/** Whether the near-match path (A4) is enabled. Off by default (plan §0 #4: "off until measured")
 * — trigram matching can serve a stored answer to a differently-worded question, so it stays
 * behind an explicit env switch, flippable without a code change once the A3 hit-rate data
 * justifies it. */
export function isNearMatchEnabled(): boolean {
  const v = process.env.ASK_NEAR_MATCH_ENABLED;
  return v === "1" || v === "true";
}

/** Trigram threshold for a near-match, in [0,1]. Defaults to a conservative 0.85; override via
 * `ASK_NEAR_MATCH_THRESHOLD` while tuning against the real ai_ask_log corpus. */
export function nearMatchThreshold(): number {
  const raw = Number(process.env.ASK_NEAR_MATCH_THRESHOLD);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1) return 0.85;
  return raw;
}

export type AskNearHit = AskCacheHit & { matchedNorm: string; score: number };

/**
 * Near-match lookup (A4): the best `approved` entry in the same geo scope and data version whose
 * normalized question is trigram-similar to the asked one, at/above the configured threshold.
 * Returns null when disabled, on a miss, or on any error. Held to a stricter bar than exact match
 * (approved-only) because the numeric audit verified the stored answer against the *stored*
 * question, not the asked one — see the match_ask_answer migration.
 */
export async function lookupAskCacheNearMatch(
  questionNorm: string,
  geoCode: string | null,
  dataVersion: string,
): Promise<AskNearHit | null> {
  if (!isNearMatchEnabled()) return null;
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("match_ask_answer", {
      q: questionNorm,
      scope: geoCode ?? "national",
      version: dataVersion,
      min_sim: nearMatchThreshold(),
    });

    const match = !error && data && data.length > 0 ? data[0] : null;
    if (!match || !match.answer_md) return null;

    // Read current hit_count for the matched row, then bump — the rpc doesn't return it.
    const { data: row } = await supabase
      .from("ai_ask_cache")
      .select("hit_count")
      .eq("cache_key", match.cache_key)
      .maybeSingle();
    if (row) await bumpHitCount(supabase, match.cache_key, row.hit_count);

    return { answerMd: match.answer_md, provider: match.provider, matchedNorm: match.question_norm, score: match.score };
  } catch {
    return null;
  }
}

/**
 * Write-back after a live generation whose audited answer survived non-empty. Never touches an
 * `approved` or `blocked` row: an admin-edited answer must not be clobbered by a fresh
 * generation, and a blocked question must stay blocked (plan §4 A2.2). Best-effort — a failure
 * here just means the next identical ask goes live again.
 */
export async function storeAskAnswer(params: {
  questionNorm: string;
  questionDisplay: string;
  geoCode: string | null;
  dataVersion: string;
  answerMd: string;
  provider: string | null;
}): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient();
    const key = askCacheKey(params.dataVersion, params.geoCode, params.questionNorm);

    const { data: existing } = await supabase
      .from("ai_ask_cache")
      .select("status")
      .eq("cache_key", key)
      .maybeSingle();
    if (existing && existing.status !== "auto") return;

    await supabase.from("ai_ask_cache").upsert({
      cache_key: key,
      question_norm: params.questionNorm,
      question_display: params.questionDisplay,
      geo_code: params.geoCode,
      answer_md: params.answerMd,
      provider: params.provider,
      data_version: params.dataVersion,
      status: "auto",
      generated_at: new Date().toISOString(),
    });
  } catch {
    // best-effort
  }
}
