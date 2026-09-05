import "server-only";
import { createSupabaseServiceClient } from "./service-client";

/**
 * Moving one dataset's `last_updated_at` forward — the write half of the version string every
 * cache in this repo already reads (docs/LEGISLATIVE_DISTRICTS_PLAN.md §5 D2.6;
 * docs/UUC_PHC_2025_PLAN.md §9 U8).
 *
 * Until now `dim_dataset.last_updated_at` only ever moved when a migration re-seeded the row, which
 * was true enough while every dataset arrived as a bulk load. A public correction is the first
 * change to a dataset that originates *inside the running site*, so it is the first one with
 * nothing to bump the timestamp on its behalf.
 *
 * **Why the service client.** `dim_dataset` is public-read with no write policy — an anon or
 * authenticated write fails silently as zero rows matched, which is the worst available failure for
 * a cache key. The write is service-role, so every caller must itself be `server-only`.
 *
 * **Scoped to one slug, deliberately.** The whole value of a per-dataset version is that a
 * correction to the district mapping expires answers about the district mapping and nothing else.
 * A helper that bumped "the dataset" without naming which one would put that back.
 */

/** Bumps `last_updated_at` to now for one `dim_dataset` row. Returns an error string on failure —
 *  including the case nobody would otherwise notice: a slug that matches no row. */
export async function bumpDatasetVersion(slug: string): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("dim_dataset")
      .update({ last_updated_at: new Date().toISOString() })
      .eq("slug", slug)
      .select("dataset_id");
    if (error) return error.message;
    // An update matching nothing is not an error to PostgREST. It is here: it means the dataset
    // this change belongs to was never registered, so nothing is versioning it.
    if (!data || data.length === 0) return `No dim_dataset row for slug '${slug}'`;
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "the dataset version bump did not complete";
  }
}
