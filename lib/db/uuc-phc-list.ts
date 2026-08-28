import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";
import type { GeoLevel } from "@/lib/filters/schema";

/**
 * UUC for PHC 2025 — the list as rows, scoped to an area (plan U11).
 *
 * The read layer behind the CSV/XLSX download. It reads `ref_uuc_phc_list`, which joins the
 * *record* (`fact_uuc_phc_barangay`) to the *evidence* (`fact_uuc_phc_indicators`) and resolves the
 * geography, so one query answers "every listed barangay under this area, with everything recorded
 * about it". See `supabase/migrations/20260827180000_ref_uuc_phc_list.sql` for why that join is a
 * relation rather than something assembled here.
 *
 * **This module is the one place indicator values leave the section in bulk, and it is allowed to
 * because of one column.** U3's rule is *mark the value, never average it*: a bounded value is a
 * ceiling the source overshot, and 886 Water and 456 FIC readings now sit at exactly 100 with only
 * `capped_indicators` to separate them from genuine full coverage. U4 kept the values off the PNG
 * because a picture has nowhere to put that marker. A spreadsheet does — `capped_indicators` is a
 * column here, and nothing in this path averages anything.
 */

/** One listed barangay, exactly as `ref_uuc_phc_list` yields it. Snake_case on purpose: the
 * download is a faithful dump of that relation, so the column names a reader sees in the file are
 * the ones they can look up in the column dictionary. */
export type UucPhcListRow = {
  geo_code: string;
  geo_name: string;
  citymun_code: string | null;
  citymun_name: string | null;
  province_code: string | null;
  province_name: string | null;
  region_code: string | null;
  region_name: string | null;
  source_geo_code: string;
  source_region: string | null;
  source_province: string | null;
  source_citymun: string | null;
  source_barangay: string | null;
  route_ip: boolean;
  route_conflict: boolean;
  route_four_ps: boolean;
  route_health: boolean;
  health_evaluable: boolean;
  health_indicators: number | null;
  physical_factor: number | null;
  ip_pop: number | null;
  armed_conf: number | null;
  idp: number | null;
  four_ps: number | null;
  elcac_brgy: boolean | null;
  capped_indicators: string[];
  imr: number | null;
  ufmr: number | null;
  abr: number | null;
  fic: number | null;
  pre_natal: number | null;
  sba: number | null;
  water: number | null;
  imr_prov_ref: number | null;
  ufmr_prov_ref: number | null;
  abr_prov_ref: number | null;
  fic_prov_ref: number | null;
  pre_natal_prov_ref: number | null;
  sba_prov_ref: number | null;
  water_prov_ref: number | null;
};

const SELECT_COLS =
  "geo_code, geo_name, citymun_code, citymun_name, province_code, province_name, region_code, region_name, source_geo_code, source_region, source_province, source_citymun, source_barangay, route_ip, route_conflict, route_four_ps, route_health, health_evaluable, health_indicators, physical_factor, ip_pop, armed_conf, idp, four_ps, elcac_brgy, capped_indicators, imr, ufmr, abr, fic, pre_natal, sba, water, imr_prov_ref, ufmr_prov_ref, abr_prov_ref, fic_prov_ref, pre_natal_prov_ref, sba_prov_ref, water_prov_ref" as const;

/** PostgREST caps a response at 1,000 rows, and a national export is 5,987 — so this path pages
 * where every other read in the section does not. The page size is the server's cap rather than a
 * smaller one: fewer round trips, and a partial page is how the loop knows it has reached the end. */
const PAGE_SIZE = 1000;

/** The column each geo level filters on. `dim_geo`'s denormalized ancestors are already on the
 * view, so scoping to a region is one predicate rather than a list of its barangays. National is
 * unfiltered, and `barangay` has no entry at all: `/uuc-phc/barangay/*` 404s across the section,
 * and a one-row export would be the same non-answer a barangay page would have been. */
const SCOPE_COLUMN: Partial<Record<GeoLevel, "region_code" | "province_code" | "citymun_code">> = {
  region: "region_code",
  province: "province_code",
  citymun: "citymun_code",
};

/** Whether this level can be exported at all. Exported so the route can answer 400 rather than
 * emit an empty file for a level the section does not publish. */
export function isExportableLevel(geoLevel: GeoLevel): boolean {
  return geoLevel === "national" || geoLevel in SCOPE_COLUMN;
}

/**
 * Every listed barangay under `geoCode`, ordered by PSGC — a stable order that also groups a file
 * by province and city, which is the order somebody reading it down the page wants.
 *
 * Returns **null on any read failure**, never a short array. The caller compares the length against
 * `agg_uuc_phc_counts.n_listed` and refuses to emit when they disagree, on the fact loader's own
 * discipline: a silently short file is worse than a failed one when 5,987 is the headline figure,
 * and unlike a page, a spreadsheet leaves the building with no way to notice later that it was
 * missing a province. An area with nothing listed returns `[]`, which is a real answer.
 */
export const getUucPhcListRows = cache(
  async (geoCode: string, geoLevel: GeoLevel): Promise<UucPhcListRow[] | null> => {
    if (!isExportableLevel(geoLevel)) return null;

    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
    if (datasetId === null) return null;

    const supabase = createSupabaseServerClient();
    const scopeColumn = SCOPE_COLUMN[geoLevel];
    const rows: UucPhcListRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
      let query = supabase
        .from("ref_uuc_phc_list")
        .select(SELECT_COLS)
        .eq("dataset_id", datasetId)
        .order("geo_code", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (scopeColumn) query = query.eq(scopeColumn, geoCode);

      const { data, error } = await query;
      if (error || !data) return null;

      rows.push(...(data as UucPhcListRow[]));
      // A short page is the last page. Reading one more empty page to learn the same thing costs a
      // round trip on every export, including the 5,987-row one.
      if (data.length < PAGE_SIZE) break;
    }

    return rows;
  },
);
