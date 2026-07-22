import "server-only";
import { getActiveDataset } from "@/lib/db/dataset";
import { getGeoByCode } from "@/lib/db/geo";
import { createSupabaseServiceClient } from "@/lib/db/service-client";
import { runToolLoop } from "./agent-loop";
import { askCacheKey } from "./ask-cache";
import { auditNarrative } from "./audit";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { ChatMessage } from "./providers/types";

/**
 * Refresh-on-ingest for the answer bank (docs/ASK_CACHE_PLAN.md §6 A3.3): after a dataset refresh
 * bumps the data version, every `approved` entry keyed to the old version goes dormant (the
 * serving path keys on the *current* version, so it can never quote stale numbers — it just
 * misses). This regenerates those curated, high-value questions under the current version so the
 * first visitor after an ingestion still gets an instant answer instead of eating a live call.
 *
 * `auto` entries are deliberately NOT refreshed here — they regenerate lazily on first ask, which
 * keeps this bounded to the small admin-curated set. Runs inside the daily precompute cron.
 *
 * Regeneration reruns the exact grounding path a live ask would (same system prompt, same page
 * context reconstructed from geo_code, same numeric audit), so a refreshed answer is held to the
 * identical safety bar. A hand-edited approved answer is therefore replaced on a version bump by
 * design: its numbers were checked against the *old* data, so carrying its text forward verbatim
 * under a new version would risk quoting stale figures — the one thing the whole scheme forbids.
 */

export type AskRefreshResult = {
  /** Approved entries found on a stale version (the work queue). */
  staleTotal: number;
  attempted: number;
  refreshed: number;
  ranOutOfTime: boolean;
};

const EMPTY: AskRefreshResult = { staleTotal: 0, attempted: 0, refreshed: 0, ranOutOfTime: false };

export async function refreshApprovedAskAnswers(opts: {
  startedAt: number;
  deadlineMs: number;
  limit?: number;
}): Promise<AskRefreshResult> {
  try {
    const dataVersion = (await getActiveDataset())?.lastUpdatedAt ?? "unknown";
    const supabase = createSupabaseServiceClient();

    const { data: stale, error } = await supabase
      .from("ai_ask_cache")
      .select("cache_key, question_display, question_norm, geo_code")
      .eq("status", "approved")
      .neq("data_version", dataVersion)
      .limit(opts.limit ?? 50);

    if (error || !stale || stale.length === 0) return { ...EMPTY, staleTotal: stale?.length ?? 0 };

    let attempted = 0;
    let refreshed = 0;
    let ranOutOfTime = false;

    for (const row of stale) {
      if (Date.now() - opts.startedAt > opts.deadlineMs) {
        ranOutOfTime = true;
        break;
      }
      attempted++;
      if (await regenerateOne(supabase, row, dataVersion)) refreshed++;
    }

    return { staleTotal: stale.length, attempted, refreshed, ranOutOfTime };
  } catch {
    return EMPTY;
  }
}

type StaleRow = { cache_key: string; question_display: string; question_norm: string; geo_code: string | null };

async function regenerateOne(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  row: StaleRow,
  dataVersion: string,
): Promise<boolean> {
  // Reconstruct the same page-context line the chat route injects, so the regenerated answer is
  // grounded in the same place the admin approved it for.
  let contextLine = "";
  if (row.geo_code) {
    const geo = await getGeoByCode(row.geo_code);
    if (geo && geo.geoLevel !== "national") {
      contextLine = `\n\nThe user is currently viewing geo_code ${geo.geoCode} (level ${geo.geoLevel}) on the dashboard — treat it as the place they mean if their question doesn't name one.`;
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + contextLine },
    { role: "user", content: row.question_display },
  ];

  const result = await runToolLoop(messages);
  if (result.allCapped || !result.finalText) return false;

  const audited = auditNarrative(result.finalText, result.toolPayloads);
  if (!audited.text) return false; // nothing grounded survived — keep the dormant old row, retry next run

  const newKey = askCacheKey(dataVersion, row.geo_code, row.question_norm);
  const { error: upsertErr } = await supabase.from("ai_ask_cache").upsert({
    cache_key: newKey,
    question_norm: row.question_norm,
    question_display: row.question_display,
    geo_code: row.geo_code,
    answer_md: audited.text,
    provider: result.provider,
    data_version: dataVersion,
    status: "approved", // stays approved so it keeps getting refreshed on the next version bump
    generated_at: new Date().toISOString(),
  });
  if (upsertErr) return false;

  // Drop the superseded old-version row now that the new one is safely written (guard against the
  // no-op case where the version string is unchanged and both keys are identical).
  if (newKey !== row.cache_key) {
    await supabase.from("ai_ask_cache").delete().eq("cache_key", row.cache_key);
  }
  return true;
}
