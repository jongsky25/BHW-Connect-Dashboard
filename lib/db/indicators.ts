import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getActiveDatasetId, getDatasetIdBySlug } from "./dataset";
import { getChildGeos } from "./geo";
import type { DemographicDimension, GeoLevel } from "@/lib/filters/schema";

export type BhwCounts = {
  geoCode: string;
  geoLevel: GeoLevel;
  nTotal: number | null;
  nAccredited: number | null;
  pctAccredited: number | null;
  avgActiveYears: number | null;
  anyHonorariumPct: number | null;
  /** Wilson 95% interval (percentage points) around pctAccredited (E2.2). */
  ciLow: number | null;
  ciHigh: number | null;
};

/**
 * Core BHW count/accreditation indicators for one geo. Pure and parameterized
 * by (geoCode, geoLevel) — this is the same function the Phase 2 AI tool layer
 * (`getIndicatorByGeo`) will call, so numbers shown to users and to the model
 * are guaranteed identical.
 */
export async function getBhwCounts(geoCode: string, geoLevel: GeoLevel): Promise<BhwCounts | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_bhw_counts")
    .select(
      "geo_code, geo_level, n_total, n_accredited, pct_accredited, avg_active_years, any_honorarium_pct, ci_low, ci_high",
    )
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .maybeSingle();

  if (error || !data) return null;

  return {
    geoCode: data.geo_code,
    geoLevel: data.geo_level,
    nTotal: data.n_total,
    nAccredited: data.n_accredited,
    pctAccredited: data.pct_accredited,
    avgActiveYears: data.avg_active_years,
    anyHonorariumPct: data.any_honorarium_pct,
    ciLow: data.ci_low,
    ciHigh: data.ci_high,
  };
}

export type GeoSummary = {
  geoCode: string;
  geoLevel: GeoLevel;
  geoName: string;
  nTotal: number | null;
  pctAccredited: number | null;
  topTrainingGap: string | null;
  anyHonorariumPct: number | null;
};

/** One denormalized profile row per geo — backs place pages and geo search. */
export async function getGeoSummary(geoCode: string): Promise<GeoSummary | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_geo_summary")
    .select(
      "geo_code, geo_level, geo_name, n_total, pct_accredited, top_training_gap, any_honorarium_pct",
    )
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .maybeSingle();

  if (error || !data) return null;

  return {
    geoCode: data.geo_code,
    geoLevel: data.geo_level,
    geoName: data.geo_name,
    nTotal: data.n_total,
    pctAccredited: data.pct_accredited,
    topTrainingGap: data.top_training_gap,
    anyHonorariumPct: data.any_honorarium_pct,
  };
}

export type DemographicRow = {
  dimension: string;
  category: string;
  n: number | null;
  pct: number | null;
  isSuppressed: boolean;
  rollupGeoCode: string | null;
  rollupGeoLevel: GeoLevel | null;
  rollupGeoName: string | null;
};

/**
 * Demographic breakdown rows for one geo, across one or more dimensions.
 * Suppressed cells (n<5 at barangay level, per BUILD_PLAN.md §4.1) keep their
 * `is_suppressed`/rollup pointer intact rather than being filtered out, so
 * the UI can render the "suppressed to protect privacy" state instead of a
 * silently missing bar.
 */
export async function getDemographics(
  geoCode: string,
  geoLevel: GeoLevel,
  dimensions: DemographicDimension[],
): Promise<DemographicRow[]> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null || dimensions.length === 0) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_demographics")
    .select(
      "dimension, category, n, pct, is_suppressed, rollup_geo_code, rollup_geo_level, rollup:dim_geo!agg_demographics_rollup_geo_code_fkey(geo_name)",
    )
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .in("dimension", dimensions);

  if (error || !data) return [];

  return data.map((row) => ({
    dimension: row.dimension,
    category: row.category,
    n: row.n,
    pct: row.pct,
    isSuppressed: row.is_suppressed,
    rollupGeoCode: row.rollup_geo_code,
    rollupGeoLevel: row.rollup_geo_level,
    rollupGeoName: (row.rollup as { geo_name: string } | null)?.geo_name ?? null,
  }));
}

/** Educational-attainment categories counted as "high school graduate or higher" —
 * High School Graduate and everything above it (Vocational Degree is post-secondary,
 * so it counts). Shared by the home page's education KPI tile and the insights grid
 * so both report the same national figure from one definition. */
export const HS_GRAD_AND_ABOVE = new Set([
  "High School Graduate",
  "Vocational Degree",
  "College Level",
  "College Graduate",
  "Masteral Degree",
]);

/** Sums the pct of every non-suppressed row at or above "High school graduate",
 * rounded. Null when there's no usable education data at all. */
export function hsGradOrAbovePct(rows: DemographicRow[]): number | null {
  const relevant = rows.filter(
    (r) => !r.isSuppressed && HS_GRAD_AND_ABOVE.has(r.category) && r.pct !== null,
  );
  if (relevant.length === 0) return null;
  return Math.round(relevant.reduce((sum, r) => sum + (r.pct as number), 0));
}

export type TrainingRow = {
  topicSlug: string;
  topicLabel: string | null;
  nTrained: number | null;
  nTotal: number | null;
  coveragePct: number | null;
  /** Median of the last-trained year across trained BHWs (E2.1) — a recency
   * signal orthogonal to coverage. Null when unrecorded. */
  medianTrainingYear: number | null;
  /** Wilson 95% interval (percentage points) around coveragePct (E2.2). */
  ciLow: number | null;
  ciHigh: number | null;
};

/**
 * Training-topic coverage for one geo. `agg_training` is only built at
 * national/region/province/citymun (increment 0.5 — barangay-level per-topic
 * granularity wasn't needed and blew the free-tier disk budget), so barangay
 * callers get an empty array and the UI falls back to the citymun ancestor.
 */
export async function getTrainingCoverage(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<TrainingRow[]> {
  if (geoLevel === "barangay") return [];

  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_training")
    .select(
      "topic_slug, topic_label, n_trained, n_total, coverage_pct, median_training_year, ci_low, ci_high",
    )
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .order("coverage_pct", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
    topicSlug: row.topic_slug,
    topicLabel: row.topic_label,
    nTrained: row.n_trained,
    nTotal: row.n_total,
    coveragePct: row.coverage_pct,
    medianTrainingYear: row.median_training_year,
    ciLow: row.ci_low,
    ciHigh: row.ci_high,
  }));
}

export type CertificationRow = {
  certType: string;
  n: number | null;
  pct: number | null;
};

/**
 * Certification/training coverage for one geo — BHW Reference Manual training,
 * TESDA BHS NC2 training, and TESDA BHS NC II certification. Unlike
 * `agg_training`, `agg_certification` is built at all 5 geo levels including
 * barangay (see ingestion/build_aggregates.sql), so no barangay fallback needed.
 */
export async function getCertification(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<CertificationRow[]> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_certification")
    .select("cert_type, n, pct")
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel);

  if (error || !data) return [];

  return data.map((row) => ({
    certType: row.cert_type,
    n: row.n,
    pct: row.pct,
  }));
}

export type HonorariumRow = {
  payerLevel: string;
  nReceiving: number | null;
  pctReceiving: number | null;
  avgMonthlyAmount: number | null;
  modalFrequency: string | null;
  minAmount: number | null;
  p25Amount: number | null;
  medianAmount: number | null;
  p75Amount: number | null;
  maxAmount: number | null;
  isSuppressed: boolean;
  /** Wilson 95% interval (percentage points) around pctReceiving (E2.2). */
  ciLow: number | null;
  ciHigh: number | null;
};

/** Honorarium receipt broken down by which administrative level pays it. */
export async function getHonorarium(geoCode: string, geoLevel: GeoLevel): Promise<HonorariumRow[]> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_honorarium")
    .select(
      "payer_level, n_receiving, pct_receiving, avg_monthly_amount, modal_frequency, min_amount, p25_amount, median_amount, p75_amount, max_amount, is_suppressed, ci_low, ci_high",
    )
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel);

  if (error || !data) return [];

  return data.map((row) => ({
    payerLevel: row.payer_level,
    nReceiving: row.n_receiving,
    pctReceiving: row.pct_receiving,
    avgMonthlyAmount: row.avg_monthly_amount,
    modalFrequency: row.modal_frequency,
    minAmount: row.min_amount,
    p25Amount: row.p25_amount,
    medianAmount: row.median_amount,
    p75Amount: row.p75_amount,
    maxAmount: row.max_amount,
    isSuppressed: row.is_suppressed,
    ciLow: row.ci_low,
    ciHigh: row.ci_high,
  }));
}

export type ChildIndicatorRow = {
  geoCode: string;
  geoName: string;
  /** Validated-profile count (`agg_geo_summary.n_total`) — the small-N basis. */
  nTotal: number | null;
  pctAccredited: number | null;
  anyHonorariumPct: number | null;
  avgActiveYears: number | null;
  /** Households ÷ total BHWs (StepZero universe). Higher = heavier load. */
  householdsPerBhw: number | null;
  /** Validated profiles ÷ StepZero registered universe, capped at 100 — matches
   * the place-page / summary-strip "profile coverage" figure. */
  coveragePct: number | null;
  /** Total BHWs per 1,000 residents (E2.1). Population is StepZero self-reported.
   * Higher = denser BHW coverage. */
  bhwPer1000: number | null;
};

/**
 * All base map indicators for a set of geos — backs the map + ranked-list
 * comparison figure and its indicator switcher (E1.1). Merges three aggregates
 * by geo_code in one round-trip each:
 *  - `agg_geo_summary` — pct_accredited, any_honorarium_pct, n_total (profiled);
 *  - `agg_bhw_counts` — avg_active_years;
 *  - `agg_bhw_stepzero_counts` (the StepZero companion dataset) — registered/
 *    accredited universe + households + total BHWs, from which households-per-BHW
 *    and profile coverage % are derived exactly as `lib/db/stepzero.ts` does.
 *
 * `n_total` rides along so the map/list can flag small-N children whose rate is
 * unstable (E0.5, `MIN_LEADER_N`). Children per parent stay well under the
 * PostgREST 1,000-row cap for every level this figure renders (national→region
 * ≈18, region→province ≤~15, province→citymun ≤~50 — national→citymun's 1,639
 * is never rendered here), so a single `.in()` per table suffices.
 */
export async function getChildIndicators(geoCodes: string[]): Promise<ChildIndicatorRow[]> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null || geoCodes.length === 0) return [];

  const supabase = createSupabaseServerClient();
  const stepzeroId = await getDatasetIdBySlug(DATASET_SLUGS.stepzero);

  const [summaryRes, countsRes, stepzeroRes] = await Promise.all([
    supabase
      .from("agg_geo_summary")
      .select("geo_code, geo_name, pct_accredited, any_honorarium_pct, n_total")
      .eq("dataset_id", datasetId)
      .in("geo_code", geoCodes),
    supabase
      .from("agg_bhw_counts")
      .select("geo_code, avg_active_years")
      .eq("dataset_id", datasetId)
      .in("geo_code", geoCodes),
    stepzeroId === null
      ? Promise.resolve({ data: null })
      : supabase
          .from("agg_bhw_stepzero_counts")
          .select(
            "geo_code, n_registered, n_registered_accredited, n_total_bhw, households, population",
          )
          .eq("dataset_id", stepzeroId)
          .in("geo_code", geoCodes),
  ]);

  if (summaryRes.error || !summaryRes.data) return [];

  const avgByCode = new Map(
    (countsRes.data ?? []).map((row) => [row.geo_code, row.avg_active_years]),
  );
  const stepzeroByCode = new Map((stepzeroRes.data ?? []).map((row) => [row.geo_code, row]));

  return summaryRes.data.map((row) => {
    const sz = stepzeroByCode.get(row.geo_code);
    const households = sz?.households ?? null;
    const totalBhw = sz?.n_total_bhw ?? null;
    const population = sz?.population ?? null;
    const householdsPerBhw =
      households !== null && totalBhw !== null && households > 0 && totalBhw > 0
        ? Math.round(households / totalBhw)
        : null;
    const bhwPer1000 =
      totalBhw !== null && population !== null && totalBhw > 0 && population > 0
        ? Math.round((1000 * totalBhw) / population * 10) / 10
        : null;

    const registeredUniverse =
      sz == null || (sz.n_registered === null && sz.n_registered_accredited === null)
        ? null
        : (sz.n_registered ?? 0) + (sz.n_registered_accredited ?? 0);
    const validated = row.n_total;
    const coveragePct =
      validated !== null && registeredUniverse !== null && registeredUniverse > 0
        ? Math.min(100, Math.round((100 * validated) / registeredUniverse))
        : null;

    return {
      geoCode: row.geo_code,
      geoName: row.geo_name,
      nTotal: row.n_total,
      pctAccredited: row.pct_accredited,
      anyHonorariumPct: row.any_honorarium_pct,
      avgActiveYears: avgByCode.get(row.geo_code) ?? null,
      householdsPerBhw,
      coveragePct,
      bhwPer1000,
    };
  });
}

export type ChildTrainingRow = { coveragePct: number | null; nTotal: number | null };

/**
 * Per-topic training coverage for a set of child geos (E1.1) — fetched only when
 * a `training:<topic>` map indicator is active. `agg_training` exists at
 * national/region/province/citymun (not barangay), which covers every child
 * level the map renders. Returns a map keyed by geo_code; absent children map to
 * no entry (rendered grey), never 0.
 */
export async function getChildTrainingCoverage(
  geoCodes: string[],
  topicSlug: string,
): Promise<Map<string, ChildTrainingRow>> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null || geoCodes.length === 0) return new Map();

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_training")
    .select("geo_code, coverage_pct, n_total")
    .eq("dataset_id", datasetId)
    .eq("topic_slug", topicSlug)
    .in("geo_code", geoCodes);

  if (error || !data) return new Map();

  return new Map(
    data.map((row) => [row.geo_code, { coveragePct: row.coverage_pct, nTotal: row.n_total }]),
  );
}

export type ChildSummaryRow = {
  geoCode: string;
  geoLevel: GeoLevel;
  geoName: string;
  nTotal: number | null;
  pctAccredited: number | null;
  topTrainingGap: string | null;
  anyHonorariumPct: number | null;
};

/**
 * Summary indicators for every direct child of a geo (regions of the country,
 * provinces of a region, cities of a province, barangays of a city), for the
 * "Places within" drill-down table on place pages. Joins the child geo list
 * (`dim_geo`, via getChildGeos) to their precomputed `agg_geo_summary` rows.
 * Children with no summary row are still returned (with null indicators) so the
 * table reflects the full administrative structure, not just places with data.
 * Barangay children of a single city stay well under the platform's 1,000-row
 * request cap, so a single `.in()` query suffices (no pagination needed).
 */
export async function getChildSummaries(
  parentCode: string,
  parentLevel: GeoLevel,
): Promise<ChildSummaryRow[]> {
  const children = await getChildGeos(parentCode, parentLevel);
  if (children.length === 0) return [];

  const datasetId = await getActiveDatasetId();
  const emptyRow = (c: (typeof children)[number]): ChildSummaryRow => ({
    geoCode: c.geoCode,
    geoLevel: c.geoLevel,
    geoName: c.geoName,
    nTotal: null,
    pctAccredited: null,
    topTrainingGap: null,
    anyHonorariumPct: null,
  });
  if (datasetId === null) return children.map(emptyRow);

  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_geo_summary")
    .select("geo_code, n_total, pct_accredited, top_training_gap, any_honorarium_pct")
    .eq("dataset_id", datasetId)
    .in(
      "geo_code",
      children.map((c) => c.geoCode),
    );

  const byCode = new Map((data ?? []).map((row) => [row.geo_code, row]));
  return children.map((c) => {
    const s = byCode.get(c.geoCode);
    return {
      geoCode: c.geoCode,
      geoLevel: c.geoLevel,
      geoName: c.geoName,
      nTotal: s?.n_total ?? null,
      pctAccredited: s?.pct_accredited ?? null,
      topTrainingGap: s?.top_training_gap ?? null,
      anyHonorariumPct: s?.any_honorarium_pct ?? null,
    };
  });
}
