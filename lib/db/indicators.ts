import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";
import type { GeoLevel } from "@/lib/filters/schema";

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
