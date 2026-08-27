import "server-only";
import { createSupabaseServerClient } from "./supabase";
import type { GeoLevel } from "@/lib/filters/schema";
import type { Database, Json } from "./database.types";

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
 * One `search_geo` row, plus `parent_chain` as an *optional* column. Optional rather than required
 * because the live function does not return it — see the comment inside `searchGeo` below.
 */
type SearchGeoRow = Database["public"]["Functions"]["search_geo"]["Returns"][number] & {
  parent_chain?: Json | null;
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

  // `search_geo`'s rows, widened by the one optional column below. The migration that adds it
  // (`20260720130000_search_geo_parent_chain.sql`) is committed but has never been applied to the
  // live project — `supabase gen types` reads the live function, so the generated Returns type has
  // five columns where the repo's migration declares six. Rather than assert a column the live
  // database does not return, this reads it as optional: today every row omits it and the mapping
  // below falls through to "no parents known"; the day the migration is applied, the same code
  // starts rendering the chain with no edit. See the U12a entry in docs/DECISIONS.md.
  const rows: SearchGeoRow[] = data;

  return rows.map((row) => ({
    geoCode: row.geo_code,
    geoLevel: row.geo_level,
    geoName: row.geo_name,
    nTotal: row.n_total,
    // parent_chain is absent until the P0.1 migration is applied; treat a
    // missing/non-object value as "no parents known" so the UI degrades cleanly.
    parentChain:
      row.parent_chain && typeof row.parent_chain === "object" && !Array.isArray(row.parent_chain)
        ? (row.parent_chain as GeoParentChain)
        : {},
  }));
}
