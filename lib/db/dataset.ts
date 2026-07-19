import "server-only";
import { createSupabaseServerClient } from "./supabase";

export type DatasetInfo = {
  datasetId: number;
  slug: string;
  name: string;
  sourceName: string | null;
  license: string | null;
  asOfDate: string | null;
  lastUpdatedAt: string;
};

/**
 * The single active dataset for v1 (`bhw-2025`). Returns null on any read
 * failure so callers (footer, etc.) can degrade gracefully rather than crash
 * a page that doesn't otherwise depend on the database.
 */
export async function getActiveDataset(): Promise<DatasetInfo | null> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("dim_dataset")
      .select("dataset_id, slug, name, source_name, license, as_of_date, last_updated_at")
      .eq("status", "active")
      .order("last_updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    return {
      datasetId: data.dataset_id,
      slug: data.slug,
      name: data.name,
      sourceName: data.source_name,
      license: data.license,
      asOfDate: data.as_of_date,
      lastUpdatedAt: data.last_updated_at,
    };
  } catch {
    return null;
  }
}

/** Convenience accessor for query functions that only need the numeric FK. */
export async function getActiveDatasetId(): Promise<number | null> {
  const dataset = await getActiveDataset();
  return dataset?.datasetId ?? null;
}

/** Canonical dataset slugs. The per-person "validated profile" dataset drives
 * every individual-level figure; the StepZero quick-count is the aggregate
 * BHW universe used only as the total/denominator. */
export const DATASET_SLUGS = {
  profiled: "bhw-2025",
  stepzero: "bhw-stepzero-2026",
} as const;

/**
 * Resolve a dataset_id by slug regardless of `status`. Used to reach the
 * StepZero companion dataset (`bhw-stepzero-2026`), which is intentionally not
 * `status = 'active'` so `getActiveDatasetId()` keeps returning only the
 * per-person `bhw-2025` dataset. Returns null on any read failure.
 */
export async function getDatasetIdBySlug(slug: string): Promise<number | null> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("dim_dataset")
      .select("dataset_id")
      .eq("slug", slug)
      .maybeSingle();

    if (error || !data) return null;
    return data.dataset_id;
  } catch {
    return null;
  }
}
