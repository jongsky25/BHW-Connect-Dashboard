import "server-only";

import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";

/**
 * PSA census population (E4.2). `agg_population` is long-format (one row per source × geo ×
 * census year); the 2024 POPCEN count is the preferred per-capita denominator across the app,
 * with StepZero's self-reported population as the per-geo fallback where census data is absent
 * (LGUs with no BHW records, or before the census load has run). Callers do the COALESCE.
 */
export async function getCensusPopulation2024(geoCode: string): Promise<number | null> {
  const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.popcen2024);
  if (datasetId === null) return null;
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_population")
    .select("population")
    .eq("dataset_id", datasetId)
    .eq("census_year", 2024)
    .eq("geo_code", geoCode)
    .maybeSingle();
  return data?.population ?? null;
}
