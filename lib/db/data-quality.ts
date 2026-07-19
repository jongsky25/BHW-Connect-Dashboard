import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";

export type CompletenessRow = { fieldName: string; nMissing: number | null; pctMissing: number | null };

/** Field-level missingness — backs /data-quality, presented as findings rather than apologies (§7 1.9). */
export async function getDataCompleteness(): Promise<CompletenessRow[]> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_data_completeness")
    .select("field_name, n_missing, pct_missing")
    .eq("dataset_id", datasetId)
    .order("pct_missing", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    fieldName: row.field_name,
    nMissing: row.n_missing,
    pctMissing: row.pct_missing,
  }));
}
