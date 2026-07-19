import "server-only";
import { getActiveDataset } from "@/lib/db/dataset";
import { createSupabaseServiceClient } from "@/lib/db/service-client";
import type { GeoLevel } from "@/lib/filters/schema";
import { runToolLoop } from "./agent-loop";
import { auditNarrative } from "./audit";
import { SYSTEM_PROMPT } from "./system-prompt";

export type NarrativeType = "overview";

/** `data_version|geo|narrative_type`, per BUILD_PLAN.md §4.1 — bumping the active dataset's
 * `last_updated_at` (a fresh ingestion) invalidates every cached narrative automatically. */
function cacheKey(dataVersion: string, geoCode: string, narrativeType: NarrativeType): string {
  return `${dataVersion}|${geoCode}|${narrativeType}`;
}

export type Narrative = {
  content: string;
  provider: string | null;
  generatedAt: string;
  /** True if served from `ai_narrative_cache` rather than generated live this call. */
  cached: boolean;
};

// Generous relative to the daily precompute cron (2.3) — a live cache miss only reflects a
// dataset version bump or a not-yet-precomputed place, not routine staleness.
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 2;

type CachedRow = { content_md: string | null; provider: string | null; generated_at: string };

function asNarrative(row: CachedRow): Narrative | null {
  if (!row.content_md) return null;
  return { content: row.content_md, provider: row.provider, generatedAt: row.generated_at, cached: true };
}

/**
 * Cache lookup → live generate → write-back (BUILD_PLAN.md §4.2/§4.5). Returns null only when
 * there's neither a fresh cache entry nor a usable live generation and no stale entry to fall
 * back to — callers (the AI insight component, the precompute cron) treat null as "render the
 * Phase 1 template narrative instead," never as an error. Catches everything, including
 * `SUPABASE_SERVICE_ROLE_KEY`/AI env vars being unconfigured (e.g. a preview build with only the
 * public Supabase keys set) — an AI feature must never be able to break a page that doesn't
 * otherwise depend on it, matching `getActiveDataset`'s degrade-gracefully pattern.
 */
export async function getOrGenerateNarrative(
  geoCode: string,
  geoLevel: GeoLevel,
  geoName: string,
  narrativeType: NarrativeType = "overview",
): Promise<Narrative | null> {
  try {
    return await generateOrReadCache(geoCode, geoLevel, geoName, narrativeType);
  } catch {
    return null;
  }
}

async function generateOrReadCache(
  geoCode: string,
  geoLevel: GeoLevel,
  geoName: string,
  narrativeType: NarrativeType,
): Promise<Narrative | null> {
  const dataset = await getActiveDataset();
  const dataVersion = dataset?.lastUpdatedAt ?? "unknown";
  const key = cacheKey(dataVersion, geoCode, narrativeType);

  const supabase = createSupabaseServiceClient();
  const { data: cached } = await supabase
    .from("ai_narrative_cache")
    .select("content_md, provider, generated_at")
    .eq("cache_key", key)
    .maybeSingle();

  if (cached?.content_md && Date.now() - new Date(cached.generated_at).getTime() < CACHE_TTL_MS) {
    return asNarrative(cached);
  }

  const prompt = `Write a short (2-4 sentence) narrative summarizing BHW figures for ${geoName} (geo_code ${geoCode}, geoLevel ${geoLevel}). Call getIndicatorByGeo for the accreditation and demographics indicators, and check getTrainingCoverage/getHonorariumStats for anything worth mentioning. Lead with the Total BHWs vs. Validated profiles framing, then one or two more findings from the data. One paragraph, plain language, WPSAR tone.`;

  const result = await runToolLoop([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ]);

  if (result.allCapped || !result.finalText) {
    return cached ? asNarrative(cached) : null;
  }

  const audited = auditNarrative(result.finalText, result.toolPayloads);
  if (!audited.text) {
    // Every sentence got stripped by the numeric audit — nothing safe survived this generation;
    // fall back to whatever's cached (even if stale) rather than serving an empty narrative.
    return cached ? asNarrative(cached) : null;
  }

  const generatedAt = new Date().toISOString();
  await supabase.from("ai_narrative_cache").upsert({
    cache_key: key,
    content_md: audited.text,
    provider: result.provider,
    model: null,
    generated_at: generatedAt,
    data_version: dataVersion,
  });

  return { content: audited.text, provider: result.provider, generatedAt, cached: false };
}
