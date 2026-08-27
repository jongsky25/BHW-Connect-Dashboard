import "server-only";
import { createSupabaseServerClient } from "./supabase";
import type { GeoLevel } from "@/lib/filters/schema";

/** Ancestor locality names for a geo, used to disambiguate same-named places
 * in search results (e.g. one of the many "Poblacion" barangays). Any level may
 * be absent — a region has no parents, a province has only a region. */
export type GeoParentChain = {
  region?: string;
  province?: string;
  citymun?: string;
};

export type GeoSearchResult = {
  geoCode: string;
  geoLevel: GeoLevel;
  geoName: string;
  nTotal: number | null;
  parentChain: GeoParentChain;
};

/**
 * "Find my barangay" search: full-text match over `agg_geo_summary.search_text`
 * (handles a region's common name, e.g. "CALABARZON", and multi-word queries)
 * combined with pg_trgm word-similarity fuzzy matching over `dim_geo.geo_name`
 * (handles a misspelled place name) via the `search_geo` DB function — see
 * supabase/migrations/20260719140000_search_geo_function.sql for the ranking
 * rationale. Blank/whitespace-only queries return no results rather than
 * querying every row.
 */
export async function searchGeo(query: string, limit = 8): Promise<GeoSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("search_geo", {
    search_query: trimmed,
    result_limit: limit,
  });

  if (error || !data) return [];

  return data.map((row) => ({
    geoCode: row.geo_code,
    geoLevel: row.geo_level,
    geoName: row.geo_name,
    nTotal: row.n_total,
    // `parent_chain` is `Json`, which admits null and any other JSON shape — the column is a
    // jsonb the aggregate builds, not a typed record — so anything that is not a plain object is
    // treated as "no parents known" and the UI degrades to bare place names.
    //
    // That degraded rendering was the *only* rendering until 2026-08-27: the P0.1 migration that
    // adds this column had been committed for six weeks with its version missing from the live
    // migration history, so `search_geo` returned five columns and every result carried an empty
    // chain. Nothing caught it because this guard made it look deliberate. Applying that migration
    // is what turned this branch back into a fallback.
    parentChain:
      row.parent_chain && typeof row.parent_chain === "object" && !Array.isArray(row.parent_chain)
        ? (row.parent_chain as GeoParentChain)
        : {},
  }));
}
