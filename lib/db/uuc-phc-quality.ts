import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";
import type { GeoLevel } from "@/lib/filters/schema";

/**
 * UUC for PHC 2025 — the cleaning report as data (plan U10).
 *
 * `docs/UUC_PHC_2025_CLEANING_REPORT.md` §6 is the most important thing written about this dataset
 * and it was invisible to anyone using it. `/uuc-phc/data-quality` renders it.
 *
 * **Every figure this module returns is computed, and none is typed.** That is not a style
 * preference: the page is a claim about our own data quality, and a hand-written "1,584" drifts the
 * first time the extract is regenerated. A stale data-quality page is worse than none, because it
 * is read as an assurance. So the two `ref_uuc_phc_*` relations behind this module are **views** —
 * they cannot go stale against the fact table they read — and the one table
 * (`ref_uuc_phc_published_delta`) is re-derived by its own migration rather than seeded.
 *
 * Three of the page's four sections need nothing new at all, and this module deliberately does not
 * duplicate them: per-indicator capping comes from `agg_uuc_phc_indicator_dist`'s national rows
 * (U9), and the count of barangays criterion (d) cannot be evaluated for comes from
 * `agg_uuc_phc_criteria` (U7). What is here is what those cannot say.
 */

/**
 * The national data-quality facts.
 *
 * **`nBarangaysCapped` and `nValuesCapped` are different numbers and must not be swapped.** 1,584
 * values fall across 1,397 barangays, because 167 barangays carry more than one bounded value.
 * Printing the value count as a barangay count overstates the affected share of the list by 13%.
 *
 * **No share is derived here, unlike every other read module in this section.** The page prints
 * several — one per bounded indicator plus the overall one — and they have to round alike and floor
 * alike: two bounded ABR values in 5,987 is 0.03%, which must read "<0.1%" rather than "0%" or the
 * table says none were bounded. One formatter (`components/uuc-phc/quality-format.ts`) does that
 * for all of them; a share precomputed here at a different precision would be the odd one out on
 * its own page, which is the drift deriving-in-one-place exists to prevent.
 */
export type UucPhcQualityTotals = {
  /** Barangays on the 2025 list — the denominator for every share on the page. */
  nListed: number;
  /** Barangays carrying at least one value bounded during cleaning. */
  nBarangaysCapped: number;
  /** Values bounded during cleaning, across all seven boundable indicators. */
  nValuesCapped: number;
  /** Barangays carrying more than one — the whole difference between the two counts above. */
  nBarangaysMultiCapped: number;
  /**
   * How far a recomputation of criterion (d) from the published columns lands from the score the
   * source office recorded. **A measurement of a gap, never a score.** The source scored the values
   * before cleaning bounded them, so the recomputation is a different quantity wearing the same
   * name — and `nNoRouteIfRecomputed` is the evidence that it is wrong rather than merely
   * different, because the AO makes a listed barangay with no qualifying route impossible.
   */
  nScoreDisagreement: number;
  nScoreUnderstated: number;
  nNoRouteIfRecomputed: number;
  nNoRouteAsRecorded: number;
};

/** Which of the two findings a benchmark-gap row is. They must never be added together. */
export type UucPhcGapFinding = "criterion_d" | "fic_only";

export type UucPhcBenchmarkGap = {
  provinceCode: string;
  provinceName: string;
  /** Listed barangays in the province in total. */
  nListedProvince: number;
  /** Barangays the finding applies to — not always the province's whole list. */
  nAffected: number;
  /** What is wrong with the benchmarks, in the view's own words. */
  kind: string;
  /** The value that identifies the finding: the top benchmark, or the FIC benchmark itself. */
  witnessValue: number | null;
  finding: UucPhcGapFinding;
};

/** One geography where the published figure and ours disagree. */
export type UucPhcPublishedDelta = {
  geoCode: string;
  geoLevel: GeoLevel;
  geoName: string;
  /** The label exactly as the source prints it — "TOTAL" for the national row. */
  sourceLabel: string;
  nPublished: number;
  nListed: number;
  /** `nListed - nPublished`. Never zero: only differing geographies are stored. */
  delta: number;
  sourcePage: number;
  /** The date the published document speaks as of. Any quote of `nPublished` travels with it. */
  sourceAsOf: string | null;
};

export type TotalsRow = {
  n_listed: number;
  n_barangays_capped: number;
  n_values_capped: number;
  n_barangays_multi_capped: number;
  n_score_disagreement: number;
  n_score_understated: number;
  n_no_route_if_recomputed: number;
  n_no_route_as_recorded: number;
};

/** Pure row → totals mapping. Exported for unit tests. */
export function toQualityTotals(row: TotalsRow): UucPhcQualityTotals {
  return {
    nListed: row.n_listed,
    nBarangaysCapped: row.n_barangays_capped,
    nValuesCapped: row.n_values_capped,
    nBarangaysMultiCapped: row.n_barangays_multi_capped,
    nScoreDisagreement: row.n_score_disagreement,
    nScoreUnderstated: row.n_score_understated,
    nNoRouteIfRecomputed: row.n_no_route_if_recomputed,
    nNoRouteAsRecorded: row.n_no_route_as_recorded,
  };
}

/**
 * The national data-quality totals. Null on a read failure — which the page renders as
 * "unavailable" rather than as a clean bill of health, since an empty data-quality page reads as
 * "nothing wrong".
 */
export const getUucPhcQualityTotals = cache(async (): Promise<UucPhcQualityTotals | null> => {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ref_uuc_phc_quality")
    .select(
      "n_listed, n_barangays_capped, n_values_capped, n_barangays_multi_capped, n_score_disagreement, n_score_understated, n_no_route_if_recomputed, n_no_route_as_recorded",
    )
    .maybeSingle();

  if (error || !data) return null;
  return toQualityTotals(data as TotalsRow);
});

/**
 * The provinces whose benchmarks carry a finding, largest first within each finding.
 *
 * Province names are joined in memory from `dim_geo` rather than by a PostgREST embed: the view has
 * no declared foreign key for the planner to follow, and seven rows do not justify one.
 */
export const getUucPhcBenchmarkGaps = cache(async (): Promise<UucPhcBenchmarkGap[]> => {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ref_uuc_phc_benchmark_gaps")
    .select("province_code, n_listed_province, kind, n_affected, witness_value, finding");

  if (error || !data || data.length === 0) return [];

  const codes = [...new Set(data.map((row) => row.province_code))].filter(
    (code): code is string => code !== null,
  );
  const { data: geos } = await supabase
    .from("dim_geo")
    .select("geo_code, geo_name")
    .in("geo_code", codes);
  const nameByCode = new Map((geos ?? []).map((g) => [g.geo_code, g.geo_name]));

  // A view cannot declare `not null`, so every column arrives typed as nullable however
  // unconditionally the view's own SQL produces it. The five below are structural — a row missing
  // any of them names no province, or no count for one — and this page's rule is that a figure is
  // computed or it is not shown. So such a row is dropped rather than defaulted: a 0 here would
  // read as "no barangays affected", which is the opposite of "we could not tell". The migration's
  // assertions mean this filter is expected to drop nothing; it exists so that if it ever does,
  // the page loses a row instead of gaining a wrong one. `witness_value` is genuinely nullable and
  // is passed through.
  return data
    .flatMap((row) => {
      if (
        row.province_code === null ||
        row.n_listed_province === null ||
        row.n_affected === null ||
        row.kind === null ||
        row.finding === null
      ) {
        return [];
      }
      return [
        {
          provinceCode: row.province_code,
          provinceName: nameByCode.get(row.province_code) ?? row.province_code,
          nListedProvince: row.n_listed_province,
          nAffected: row.n_affected,
          kind: row.kind,
          witnessValue: row.witness_value,
          finding: row.finding as UucPhcGapFinding,
        },
      ];
    })
    .sort((a, b) => b.nAffected - a.nAffected);
});

/**
 * The geographies where the cue cards and this dashboard disagree, national row first.
 *
 * **`null` and `[]` mean opposite things here, and the distinction is the whole return type.**
 * `ref_uuc_phc_published_delta` stores only discrepancies, so no rows is a real and good outcome —
 * the two sources agree everywhere — and since the final-list alignment that is the standing state.
 * A failed read produces no rows too. Collapsing both to `[]` would let the page print "reconciled"
 * when it had in fact failed to check, which is the one thing a data-quality page must never do. So
 * a failure returns `null` and agreement returns an empty array, and the caller renders them
 * differently.
 */
export const getUucPhcPublishedDeltas = cache(async (): Promise<UucPhcPublishedDelta[] | null> => {
  const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
  if (datasetId === null) return null;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ref_uuc_phc_published_delta")
    .select(
      "geo_code, geo_level, source_label, n_published, n_listed, delta, source_page, source_as_of",
    )
    .eq("dataset_id", datasetId);

  if (error || !data) return null;
  if (data.length === 0) return [];

  const codes = [...new Set(data.map((row) => row.geo_code))];
  const { data: geos } = await supabase
    .from("dim_geo")
    .select("geo_code, geo_name")
    .in("geo_code", codes);
  const nameByCode = new Map((geos ?? []).map((g) => [g.geo_code, g.geo_name]));

  return (
    data
      .map((row) => ({
        geoCode: row.geo_code,
        geoLevel: row.geo_level,
        geoName: nameByCode.get(row.geo_code) ?? row.geo_code,
        sourceLabel: row.source_label,
        nPublished: row.n_published,
        nListed: row.n_listed,
        delta: row.delta,
        sourcePage: row.source_page,
        sourceAsOf: row.source_as_of,
      }))
      // National first, then regions by the size of the gap — the national row is the headline the
      // rest explains.
      .sort((a, b) => {
        if (a.geoLevel !== b.geoLevel) return a.geoLevel === "national" ? -1 : 1;
        return Math.abs(b.delta) - Math.abs(a.delta);
      })
  );
});
