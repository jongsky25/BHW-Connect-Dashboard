import "server-only";

import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";

/**
 * PSA census population (E4.2). `agg_population` is long-format (one row per source × geo ×
 * census year). StepZero's own self-reported population is the preferred per-capita denominator
 * across the app (owner decision, 2026-09-06 — see docs/DECISIONS.md): it is the BHW program's
 * own count, gathered on the same barangay roster as the BHW figures it divides, where the PSA
 * census is a general-population count matched in afterward by name and carries its own ~1-2%
 * national shortfall (docs/POPULATION_RECONCILIATION.md). This function's result is used only
 * where StepZero has no population row for a geo at all. Callers do the COALESCE.
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
