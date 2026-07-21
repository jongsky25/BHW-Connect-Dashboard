import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";
import type { GeoLevel } from "@/lib/filters/schema";

/** E3.2 — one milestone-cohort count for a geo. */
export type CohortRow = {
  kind: "registered" | "accredited" | "first_active";
  cohortYear: number;
  n: number;
};

/**
 * Year-cohort "waves" for one geo (E3.2): how many of today's profiled BHWs
 * were registered / accredited / first became active in each year. `agg_cohorts`
 * is built at national/region/province/citymun (barangay skipped, same disk cut
 * as `agg_training`), so barangay callers get an empty array and the UI falls
 * back to the citymun ancestor. Only non-zero cells exist in the table.
 */
export async function getCohorts(geoCode: string, geoLevel: GeoLevel): Promise<CohortRow[]> {
  if (geoLevel === "barangay") return [];
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_cohorts")
    .select("kind, cohort_year, n")
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .order("cohort_year", { ascending: true });

  if (error || !data) return [];
  return data.map((r) => ({
    kind: r.kind as CohortRow["kind"],
    cohortYear: r.cohort_year,
    n: r.n,
  }));
}

/** E3.4 — the caseload distribution for one geo. */
export type WorkloadRow = {
  nBhw: number;
  p10: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  mean: number | null;
  busiestDecileShare: number | null;
  isSuppressed: boolean;
};

/**
 * Assigned-household workload distribution for one geo (E3.4). Built at
 * national/region/province/citymun (barangay skipped — the UI falls back to the
 * citymun ancestor). Distribution columns are null + `isSuppressed` for geos with
 * fewer than 5 BHWs reporting a household count.
 */
export async function getWorkload(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<WorkloadRow | null> {
  if (geoLevel === "barangay") return null;
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_workload")
    .select("n_bhw, p10, p25, median, p75, p90, mean, busiest_decile_share, is_suppressed")
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .maybeSingle();

  if (error || !data) return null;
  return {
    nBhw: data.n_bhw,
    p10: data.p10,
    p25: data.p25,
    median: data.median,
    p75: data.p75,
    p90: data.p90,
    mean: data.mean,
    busiestDecileShare: data.busiest_decile_share,
    isSuppressed: data.is_suppressed,
  };
}

/** E3.5 — honorarium inequality among receiving BHWs for one geo. */
export type HonorariumInequalityRow = {
  nReceiving: number;
  gini: number | null;
  p10Amount: number | null;
  p90Amount: number | null;
  p90p10Ratio: number | null;
  isSuppressed: boolean;
};

/**
 * Honorarium inequality (Gini + p90:p10) among receiving BHWs for one geo
 * (E3.5). Built at national/region/province/citymun (barangay skipped — the UI
 * falls back to the citymun ancestor). Null + `isSuppressed` for geos with fewer
 * than 5 receiving BHWs.
 */
export async function getHonorariumInequality(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<HonorariumInequalityRow | null> {
  if (geoLevel === "barangay") return null;
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_honorarium_inequality")
    .select("n_receiving, gini, p10_amount, p90_amount, p90_p10_ratio, is_suppressed")
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .maybeSingle();

  if (error || !data) return null;
  return {
    nReceiving: data.n_receiving,
    gini: data.gini,
    p10Amount: data.p10_amount,
    p90Amount: data.p90_amount,
    p90p10Ratio: data.p90_p10_ratio,
    isSuppressed: data.is_suppressed,
  };
}

/** Increment 2 — one banded cell of the honorarium sufficiency figure. */
export type HonorariumSufficiencyBand = {
  bandOrder: number;
  bandLabel: string;
  n: number | null;
  pct: number | null;
  isSuppressed: boolean;
};

export type HonorariumSufficiencyRow = {
  nTotal: number;
  medianCumulativeMonthly: number | null;
  pctBelowSufficiency: number | null;
  bands: HonorariumSufficiencyBand[];
  isSuppressed: boolean;
};

/**
 * Cumulative per-BHW honorarium, banded, among ALL profiled BHWs (not just
 * recipients — contrast `getHonorariumInequality`, which is receiving-BHWs
 * only). Built at national/region/province/citymun (barangay skipped — the
 * UI falls back to the citymun ancestor). `isSuppressed` is true when the
 * geo has fewer than 5 total profiled BHWs (median/pct nulled, every band
 * row suppressed); individual band cells with 0 < n < 5 are separately
 * nulled + flagged even when the geo overall is not suppressed.
 */
export async function getHonorariumSufficiency(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<HonorariumSufficiencyRow | null> {
  if (geoLevel === "barangay") return null;
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_honorarium_cumulative")
    .select(
      "band_order, band_label, n, pct, n_total, median_cumulative_monthly, pct_below_sufficiency, is_suppressed",
    )
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .order("band_order", { ascending: true });

  if (error || !data || data.length === 0) return null;
  const [first] = data;
  return {
    nTotal: first.n_total,
    medianCumulativeMonthly: first.median_cumulative_monthly,
    pctBelowSufficiency: first.pct_below_sufficiency,
    isSuppressed: data.every((r) => r.is_suppressed),
    bands: data.map((r) => ({
      bandOrder: r.band_order,
      bandLabel: r.band_label,
      n: r.n,
      pct: r.pct,
      isSuppressed: r.is_suppressed,
    })),
  };
}

/** E3.7 — one income-class row of national indicator summaries. */
export type IncomeClassRow = {
  incomeClass: number;
  nBhw: number;
  nCitymun: number | null;
  pctAccredited: number | null;
  anyHonorariumPct: number | null;
  medianHonorariumAmount: number | null;
};

/**
 * National-scope indicator summaries by LGU income class (E3.7), used only at the
 * national view. Income classes come from `dim_geo.income_class`, refreshed by E4.3
 * to the DOF DO 074-2024 (RA 11964) 5-class reclassification; a handful of LGUs the
 * source leaves unclassified retain a prior class, so a small 6th-class row may appear.
 */
export async function getIncomeClassEquity(): Promise<IncomeClassRow[]> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_by_income_class")
    .select("income_class, n_bhw, n_citymun, pct_accredited, any_honorarium_pct, median_honorarium_amount")
    .eq("dataset_id", datasetId)
    .order("income_class", { ascending: true });

  if (error || !data) return [];
  return data.map((r) => ({
    incomeClass: r.income_class,
    nBhw: r.n_bhw,
    nCitymun: r.n_citymun,
    pctAccredited: r.pct_accredited,
    anyHonorariumPct: r.any_honorarium_pct,
    medianHonorariumAmount: r.median_honorarium_amount,
  }));
}
