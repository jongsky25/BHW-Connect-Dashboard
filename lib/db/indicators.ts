import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";
import type { DemographicDimension, GeoLevel } from "@/lib/filters/schema";

export type BhwCounts = {
  geoCode: string;
  geoLevel: GeoLevel;
  nTotal: number | null;
  nAccredited: number | null;
  pctAccredited: number | null;
  avgActiveYears: number | null;
  anyHonorariumPct: number | null;
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
    .select("geo_code, geo_level, n_total, n_accredited, pct_accredited, avg_active_years, any_honorarium_pct")
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
    .select("geo_code, geo_level, geo_name, n_total, pct_accredited, top_training_gap, any_honorarium_pct")
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

export type TrainingRow = {
  topicSlug: string;
  topicLabel: string | null;
  nTrained: number | null;
  nTotal: number | null;
  coveragePct: number | null;
};

/**
 * Training-topic coverage for one geo. `agg_training` is only built at
 * national/region/province/citymun (increment 0.5 — barangay-level per-topic
 * granularity wasn't needed and blew the free-tier disk budget), so barangay
 * callers get an empty array and the UI falls back to the citymun ancestor.
 */
export async function getTrainingCoverage(geoCode: string, geoLevel: GeoLevel): Promise<TrainingRow[]> {
  if (geoLevel === "barangay") return [];

  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_training")
    .select("topic_slug, topic_label, n_trained, n_total, coverage_pct")
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
  }));
}

export type HonorariumRow = {
  payerLevel: string;
  nReceiving: number | null;
  pctReceiving: number | null;
  avgMonthlyAmount: number | null;
  modalFrequency: string | null;
};

/** Honorarium receipt broken down by which administrative level pays it. */
export async function getHonorarium(geoCode: string, geoLevel: GeoLevel): Promise<HonorariumRow[]> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_honorarium")
    .select("payer_level, n_receiving, pct_receiving, avg_monthly_amount, modal_frequency")
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
  }));
}
