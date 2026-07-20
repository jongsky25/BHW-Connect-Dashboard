import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";
import { NATIONAL_GEO_CODE, type GeoLevel } from "@/lib/filters/schema";

export type CompletenessRow = { fieldName: string; nMissing: number | null; pctMissing: number | null };

/**
 * Field-level missingness for one geo — backs /data-quality (national) and the
 * place-page completeness card, presented as findings rather than apologies
 * (§7 1.9). Computed at national/region/province/citymun; barangay has no rows
 * (same disk-budget cut as agg_training), so callers fall back to the citymun.
 * Missingness here means NULL in the source — fields whose source uses an
 * explicit "unknown" category (e.g. blood type) count those rows as present.
 */
export async function getDataCompleteness(
  geoCode: string = NATIONAL_GEO_CODE,
  geoLevel: GeoLevel = "national",
): Promise<CompletenessRow[]> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_data_completeness")
    .select("field_name, n_missing, pct_missing")
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .order("pct_missing", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    fieldName: row.field_name,
    nMissing: row.n_missing,
    pctMissing: row.pct_missing,
  }));
}
