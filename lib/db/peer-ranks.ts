import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";
import type { GeoLevel } from "@/lib/filters/schema";

export type PeerRank = {
  indicator: string;
  value: number | null;
  /** The geo's own validated-profile total — the suppression denominator. */
  nTotal: number | null;
  /** 1 = highest value among siblings with data. */
  rankPosition: number | null;
  nSiblings: number | null;
  /** percent_rank × 100 (0 = lowest, 100 = highest). */
  percentile: number | null;
  isOutlier: boolean;
};

/**
 * One geo's standing among its same-level siblings for a base indicator (E2.3/
 * E2.4), from the precomputed `agg_peer_ranks` table. Returns null when the geo
 * isn't ranked (national has no siblings; barangay is excluded from the table).
 */
export async function getPeerRank(
  geoCode: string,
  geoLevel: GeoLevel,
  indicator: string,
): Promise<PeerRank | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_peer_ranks")
    .select("indicator, value, n_total, rank_position, n_siblings, percentile, is_outlier")
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .eq("indicator", indicator)
    .maybeSingle();

  if (error || !data) return null;

  return {
    indicator: data.indicator,
    value: data.value,
    nTotal: data.n_total,
    rankPosition: data.rank_position,
    nSiblings: data.n_siblings,
    percentile: data.percentile,
    isOutlier: data.is_outlier,
  };
}

/**
 * Batch variant of `getPeerRank`: every requested indicator's standing for one
 * geo, in a single `.in()` query — for pages (E1.5) that build a
 * `FigureBenchmarkProps.peer` line for several figures at once instead of
 * issuing one round trip per indicator. Returns a map keyed by indicator name;
 * an indicator with no row (not one of `agg_peer_ranks`'s 6 covered
 * indicators, or this geo unranked) simply has no entry — same "never fake a
 * rank" rule as `getPeerRank`. Empty map at national/barangay, since neither
 * grain has rows in `agg_peer_ranks`.
 */
export async function getPeerRanks(
  geoCode: string,
  geoLevel: GeoLevel,
  indicators: readonly string[],
): Promise<Map<string, PeerRank>> {
  if (indicators.length === 0) return new Map();

  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return new Map();

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_peer_ranks")
    .select("indicator, value, n_total, rank_position, n_siblings, percentile, is_outlier")
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .in("indicator", indicators);

  if (error || !data) return new Map();

  return new Map(
    data.map((row) => [
      row.indicator,
      {
        indicator: row.indicator,
        value: row.value,
        nTotal: row.n_total,
        rankPosition: row.rank_position,
        nSiblings: row.n_siblings,
        percentile: row.percentile,
        isOutlier: row.is_outlier,
      },
    ]),
  );
}
