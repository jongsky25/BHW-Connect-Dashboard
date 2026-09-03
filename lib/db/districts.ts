import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";
import { getChildGeos } from "./geo";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";

/**
 * The `/districts` (D2.1) match-quality badge. Only two of the plan's three named states
 * (`all_exact`, `has_overrides`) read directly off `match_method`; `has_unresolved` is set only
 * where a gap is unambiguously this district's own (a lone district missing a member of its own
 * province/HUC) — see the `district_index` DB function for why a shared province/city gap can't be
 * attributed to one sibling district. `resolved` covers everything else: rows placed by a rule
 * (whole-province expansion, an independent city, a PSGC code, a barangay roster) rather than a
 * plain name match, with no override and no known gap. `no_members` is a district with zero live
 * rows — not seen as of D1.6a, named rather than silently read as clean if it ever occurs.
 */
export type DistrictMatchQuality =
  | "all_exact"
  | "has_overrides"
  | "has_unresolved"
  | "resolved"
  | "no_members";

export type DistrictIndexRow = {
  districtCode: string;
  districtName: string;
  ordinal: number | null;
  isLone: boolean;
  regionCode: string | null;
  regionName: string | null;
  memberCount: number;
  bhwTotal: number;
  population: number | null;
  matchQuality: DistrictMatchQuality;
};

/**
 * The full `/districts` index (D2.1): all public districts, each with its member LGU count, BHW
 * total (summed from `agg_bhw_counts` over the district's own live members), PSA population, and
 * match-quality badge — computed in one round trip by the `district_index` DB function rather than
 * joining `geo_district_map` (3,513 rows) against `agg_bhw_counts` (~41k rows) here.
 *
 * Region names come from `dim_geo` rather than `dim_legislative_district.region_code` alone — that
 * column is a bare code (e.g. `'03'`), a convenience for filtering, not a display name.
 */
export const getDistrictIndex = cache(async (): Promise<DistrictIndexRow[]> => {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const [{ data, error }, regions] = await Promise.all([
    supabase.rpc("district_index", { p_dataset_id: datasetId }),
    getChildGeos(NATIONAL_GEO_CODE, "national"),
  ]);

  if (error || !data) return [];

  const regionNameByCode = new Map(regions.map((r) => [r.geoCode, r.geoName]));

  return data.map((row) => ({
    districtCode: row.district_code,
    districtName: row.district_name,
    ordinal: row.ordinal,
    isLone: row.is_lone,
    regionCode: row.region_code,
    regionName: row.region_code ? (regionNameByCode.get(row.region_code) ?? null) : null,
    memberCount: row.member_count,
    bhwTotal: row.bhw_total,
    population: row.population,
    matchQuality: row.match_quality as DistrictMatchQuality,
  }));
});
