import "server-only";
import { createSupabaseServerClient } from "./supabase";

export type DatasetInfo = {
  slug: string;
  name: string;
  sourceName: string;
  license: string;
  asOfDate: string;
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
      .select("slug, name, source_name, license, as_of_date, last_updated_at")
      .eq("status", "active")
      .order("last_updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    return {
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
