import "server-only";
import { cache } from "react";
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
 *
 * Pinned to `slug = DATASET_SLUGS.profiled` (`bhw-2025`), not "whichever row is
 * `status='active'`". The slug is unique, so no other dim_dataset row can ever
 * win this lookup — a reference/provenance dataset accidentally registered as
 * `active` (E4.3 did exactly this: see #44) can no longer hijack the active
 * dataset and scope every figure to a dataset_id with zero aggregate rows.
 * `status='active'` is retained as a guard so the primary dataset can still be
 * intentionally retired (returns null → graceful degrade) rather than as the
 * selector. Swapping the v1 primary to a future dataset is a deliberate edit
 * here, by design.
 *
 * Wrapped in React's per-request `cache()` — nearly every query helper calls
 * this for the dataset_id FK, so a page composing many figures (home, place,
 * insights grid) would otherwise re-run the identical lookup dozens of times
 * per render.
 */
export const getActiveDataset = cache(async (): Promise<DatasetInfo | null> => {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("dim_dataset")
      .select("dataset_id, slug, name, source_name, license, as_of_date, last_updated_at")
      .eq("slug", DATASET_SLUGS.profiled)
      .eq("status", "active")
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
});

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
  /** PSA 2024 Census of Population — the preferred per-capita denominator (E4.2),
   * with StepZero's self-reported population as the fallback until it is loaded. */
  popcen2024: "psa-popcen-2024",
  /** 2026 encoding-status snapshot — how far individual profiling has progressed
   * (Encode → Validate → Certify). Read only by slug; kept separate from the 2025
   * datasets (see lib/db/profiling-status.ts). */
  profilingStatus: "bhw-profiling-status-2026",
} as const;

/**
 * Resolve a dataset_id by slug regardless of `status`. Used to reach the
 * StepZero companion dataset (`bhw-stepzero-2026`), which is intentionally not
 * `status = 'active'` so `getActiveDatasetId()` keeps returning only the
 * per-person `bhw-2025` dataset. Returns null on any read failure.
 * Per-request `cache()`d for the same reason as `getActiveDataset`.
 */
export const getDatasetIdBySlug = cache(async (slug: string): Promise<number | null> => {
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
});
