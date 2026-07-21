import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { getDatasetIdBySlug } from "./dataset";

/** PSA Small Area Estimates dataset slug + the headline vintage the UI reads (E4.4).
 * The single release carries 2018/2021/2023 back-estimates; the Relationships axis
 * and insight use the latest (2023). */
export const POVERTY_SAE_SLUG = "psa-sae-poverty-2023";
export const POVERTY_SAE_YEAR = 2023;
export const POVERTY_SAE_SOURCE_LABEL =
  "Poverty incidence: PSA Small Area Estimates 2023 · city/municipality";

export type PovertyPoint = {
  /** % of population below the poverty threshold (SAE point estimate). */
  incidence: number;
  /** 90% confidence interval, as published. */
  ciLow: number | null;
  ciHigh: number | null;
};

/**
 * Poverty incidence per city/municipality for the given codes, keyed by geo_code
 * (E4.4). agg_poverty is city/municipality grain only — a rate that is not rolled
 * up — so this returns rows only for citymun children (a province view); at other
 * levels the map is empty and callers simply get an empty map. Missing children
 * (HUCs, which the "noHUC" source excludes) are absent from the map, not zero.
 */
export async function getChildPoverty(
  geoCodes: string[],
  year: number = POVERTY_SAE_YEAR,
): Promise<Map<string, PovertyPoint>> {
  const out = new Map<string, PovertyPoint>();
  if (geoCodes.length === 0) return out;
  const datasetId = await getDatasetIdBySlug(POVERTY_SAE_SLUG);
  if (datasetId === null) return out;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_poverty")
    .select("geo_code, poverty_incidence, ci_low, ci_high")
    .eq("dataset_id", datasetId)
    .eq("sae_year", year)
    .in("geo_code", geoCodes);

  if (error || !data) return out;
  for (const row of data) {
    if (row.poverty_incidence === null) continue;
    out.set(row.geo_code, {
      incidence: row.poverty_incidence,
      ciLow: row.ci_low,
      ciHigh: row.ci_high,
    });
  }
  return out;
}
