import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";
import { getChildGeos, getGeoByCode } from "./geo";
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

/**
 * D2.2 — one membership row's per-row receipt: the place it names, the source page and revision it
 * came from, how it was matched, and (where a human has reviewed it) any override reason. Live and
 * superseded rows share this shape; `getDistrictDetail` below sorts them into the two.
 */
export type DistrictMemberReceipt = {
  id: number;
  geoCode: string;
  geoName: string;
  geoLevel: "citymun" | "barangay";
  matchMethod: string;
  sourceKind: string;
  sourceRef: string;
  retrievedAt: string;
  status: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  supersededBy: number | null;
};

export type DistrictGapMember = {
  geoCode: string;
  geoName: string;
  geoLevel: "citymun" | "barangay";
};

export type DistrictRepresentative = {
  fullName: string;
  party: string | null;
  asOf: string;
  sourceKind: string;
  sourceRef: string;
};

export type DistrictDetail = {
  districtCode: string;
  districtName: string;
  congressNo: number;
  ordinal: number | null;
  isLone: boolean;
  regionCode: string | null;
  regionName: string | null;
  psaPopulation: number | null;
  representative: DistrictRepresentative | null;
  /** Live membership rows — the receipt table's main content. */
  members: DistrictMemberReceipt[];
  /** Rows a correction has superseded — published rather than dropped, so the history is the
   *  audit trail the plan promises (docs/LEGISLATIVE_DISTRICTS_PLAN.md §3). Empty until D2.3 ships
   *  its first accepted correction. */
  correctionHistory: DistrictMemberReceipt[];
  /** This district's own attributable gap only — see `district_gap_members`'s migration comment for
   *  why every other kind of gap can't be pinned on one district from this data. */
  gapMembers: DistrictGapMember[];
};

function toMemberReceipt(
  row: {
    id: number;
    geo_code: string;
    // The DB check constraint on geo_district_map limits this to citymun/barangay; the generated
    // column type is the shared 5-value geo_level_enum, wider than what this table can hold.
    geo_level: "national" | "region" | "province" | "citymun" | "barangay";
    match_method: string;
    source_kind: string;
    source_ref: string;
    retrieved_at: string;
    status: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
    review_note: string | null;
    superseded_by: number | null;
  },
  geoNameByCode: Map<string, string>,
): DistrictMemberReceipt {
  return {
    id: row.id,
    geoCode: row.geo_code,
    geoName: geoNameByCode.get(row.geo_code) ?? row.geo_code,
    geoLevel: row.geo_level as "citymun" | "barangay",
    matchMethod: row.match_method,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    retrievedAt: row.retrieved_at,
    status: row.status,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    reviewNote: row.review_note,
    supersededBy: row.superseded_by,
  };
}

/**
 * The `/districts/[districtCode]` per-row receipt (D2.2): one district's full membership — live
 * rows and superseded history alike — each carrying its source page, revision id, match_method,
 * and any override reason, plus the district's own attributable gap (`district_gap_members`) and
 * its sitting representative. Returns null for an unknown or rejected district_code, which the page
 * reads as 404.
 */
export const getDistrictDetail = cache(async (districtCode: string): Promise<DistrictDetail | null> => {
  const supabase = createSupabaseServerClient();

  const [{ data: district }, { data: memberRows }, { data: repRows }, { data: gapRows }] =
    await Promise.all([
      supabase
        .from("dim_legislative_district")
        .select(
          "district_code, district_name, congress_no, ordinal, is_lone, region_code, psa_population",
        )
        .eq("district_code", districtCode)
        .maybeSingle(),
      supabase
        .from("geo_district_map")
        .select(
          "id, geo_code, geo_level, match_method, source_kind, source_ref, retrieved_at, status, reviewed_at, reviewed_by, review_note, superseded_by",
        )
        .eq("district_code", districtCode),
      supabase
        .from("district_representative")
        .select("full_name, party, as_of, source_kind, source_ref")
        .eq("district_code", districtCode)
        .is("superseded_by", null)
        .order("as_of", { ascending: false })
        .limit(1),
      supabase.rpc("district_gap_members", { p_district_code: districtCode }),
    ]);

  if (!district) return null;

  const members = memberRows ?? [];
  const geoCodes = Array.from(new Set(members.map((m) => m.geo_code)));
  const geoNameByCode = new Map<string, string>();
  if (geoCodes.length > 0) {
    const { data: geoRows } = await supabase
      .from("dim_geo")
      .select("geo_code, geo_name")
      .in("geo_code", geoCodes);
    for (const row of geoRows ?? []) geoNameByCode.set(row.geo_code, row.geo_name);
  }

  const receipts = members
    .map((row) => toMemberReceipt(row, geoNameByCode))
    .sort((a, b) => a.geoName.localeCompare(b.geoName));

  const rep = repRows?.[0];
  const region = district.region_code ? await getGeoByCode(district.region_code) : null;

  return {
    districtCode: district.district_code,
    districtName: district.district_name,
    congressNo: district.congress_no,
    ordinal: district.ordinal,
    isLone: district.is_lone,
    regionCode: district.region_code,
    regionName: region?.geoName ?? null,
    psaPopulation: district.psa_population,
    representative: rep
      ? {
          fullName: rep.full_name,
          party: rep.party,
          asOf: rep.as_of,
          sourceKind: rep.source_kind,
          sourceRef: rep.source_ref,
        }
      : null,
    members: receipts.filter((m) => m.supersededBy === null),
    correctionHistory: receipts.filter((m) => m.supersededBy !== null),
    gapMembers: (gapRows ?? []).map((row) => ({
      geoCode: row.geo_code,
      geoName: row.geo_name,
      geoLevel: row.geo_level as "citymun" | "barangay",
    })),
  };
});

export type DistrictDatasetGaps = {
  uncoveredCitymunCount: number;
  unplacedBarangayCount: number;
};

/**
 * The two dataset-wide gap counts docs/LEGISLATIVE_DISTRICTS.md reports (23 uncovered LGUs, 41
 * unplaced barangays as of the last build) — recomputed live by `district_dataset_gaps()` rather
 * than copied from that doc, so this number can't go stale the way a hardcoded one would. Shown on
 * every district page alongside that district's own attributable gap, same posture /data-quality
 * takes: published, not hidden.
 */
export const getDistrictDatasetGaps = cache(async (): Promise<DistrictDatasetGaps | null> => {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("district_dataset_gaps");
  if (error || !data || data.length === 0) return null;

  return {
    uncoveredCitymunCount: data[0].uncovered_citymun_count,
    unplacedBarangayCount: data[0].unplaced_barangay_count,
  };
});
