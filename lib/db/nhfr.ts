import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";
import { getChildGeos } from "./geo";
import type { GeoLevel } from "@/lib/filters/schema";

/**
 * Health facilities (NHFR) — the DOH National Health Facility Registry, September 2026 snapshot,
 * read per geo.
 *
 * This dataset is an *inventory of places*, not a measurement and not a membership list. Every
 * figure is a count of facilities, so there is no denominator to divide by except where the
 * question is explicitly about coverage — "how many of this area's barangays have any facility at
 * all" — which is the one share this module derives.
 *
 * **A zero is data, not a gap.** `agg_nhfr_counts` carries a row for every geo, so an area with
 * no facilities reads "0 facilities" rather than "no data". For this dataset that distinction is
 * the whole point: an area with nothing is the finding, not a missing row.
 *
 * **Licensing status is not a compliance verdict.** 28,247 of the 44,799 facilities have no
 * licensing status in the source, overwhelmingly Barangay Health Stations, which are not a
 * licensed facility type. A blank means *not stated*, never "unlicensed", and nothing here
 * derives a "% licensed" figure — the denominator that would need is not knowable from this
 * export. See `licensingLabel()`.
 *
 * **Sulu is filed where its code says, not where its name does.** The source names all 177 Sulu
 * facilities under Region IX while its codes straddle two vintages; the load resolves both onto
 * `dim_geo`'s BARMM placement, so these rollups report Sulu under BARMM. The section's
 * methodology page says so.
 */
export type NhfrCounts = {
  geoCode: string;
  geoLevel: GeoLevel;
  nFacilities: number;
  nGovernment: number;
  nPrivate: number;
  nBarangayHealthStation: number;
  nRuralHealthUnit: number;
  nHospital: number;
  nBirthingHome: number;
  totalBedCapacity: number;
  /** Barangays in this area with at least one facility. */
  nBarangaysWithFacility: number;
  /** Barangays in this area in total, from dim_geo — the coverage denominator. */
  nBarangays: number;
  /** `nBarangaysWithFacility` as a rounded % of `nBarangays`, or null when there is no denominator. */
  coveragePct: number | null;
  /** Coverage as a share of the bar (0..1). 0 when the denominator is 0. */
  coverageFraction: number;
};

/** One child unit (e.g. a region's provinces) with its counts, for the breakdown. */
export type NhfrChild = NhfrCounts & { geoName: string };

/** One facility-type row of an area's breakdown. */
export type NhfrTypeCount = {
  facilityType: string;
  nFacilities: number;
  nGovernment: number;
  nPrivate: number;
};

/** One facility, as the city/municipality page lists them. */
export type NhfrFacility = {
  facilityCode: string;
  facilityName: string;
  facilityType: string;
  ownershipMajor: string;
  ownershipSub: string | null;
  barangayName: string | null;
  bedCapacity: number;
  licensingStatus: string | null;
};

/**
 * Section name this dataset presents under. The deck chrome and section header default to
 * "BHW Connect"; this is a different dataset with its own header and title template, so it says
 * so rather than borrowing the census's name (UUC_PHC_BRAND_LABEL's precedent).
 */
export const NHFR_BRAND_LABEL = "Health facilities";

/** The snapshot this section publishes, in the one place every surface reads it from. */
export const NHFR_SNAPSHOT_LABEL = "NHFR, September 2026";

/**
 * The caption line, in the Person/Place/Time form the rest of the site uses.
 *
 * The N is the *area's* facility count, not the national 44,799: a page about Mayoyao is about
 * Mayoyao's facilities, and quoting the national figure over a town's would state a number none
 * of the figures on screen support.
 */
export function nhfrCaption(counts: NhfrCounts | null, areaLabel: string): string {
  const n = counts ? counts.nFacilities.toLocaleString() : "—";
  return `N = ${n} health facilities · ${areaLabel} · ${NHFR_SNAPSHOT_LABEL}`;
}

/**
 * Route this area's facilities live at. National is the section landing page; every other level
 * is the per-area route. There is no barangay route: `/facilities/barangay/*` 404s by design,
 * because the city/municipality page already names every facility and the barangay it is in.
 */
export function nhfrAreaHref(geoLevel: GeoLevel, geoCode: string): string {
  return geoLevel === "national" ? "/facilities" : `/facilities/${geoLevel}/${geoCode}`;
}

/**
 * How a licensing status renders. The source's blank is the common case and it is not a verdict,
 * so it never renders as "unlicensed" — it renders as what it is.
 */
export function licensingLabel(status: string | null): string {
  if (status === "With License") return "Licensed";
  if (status === "Without License") return "No current licence recorded";
  return "Licence status not stated";
}

/**
 * The cross-dataset context chip's sentence for `/place/*` and `/explore`, or null when there is
 * nothing to say (uucContextSentence's precedent).
 *
 * **The sentence names its own universe.** The pages this appears on are about *BHW profiles*;
 * this is a count of *facilities*. A sentence can say "facilities" out loud beside its own
 * denominator, which is what a shared map legend and colour ramp cannot do — the reason this is
 * a chip rather than a map layer.
 *
 * **A zero renders, and says so plainly**, because `agg_nhfr_counts` carries a row for every geo:
 * a chip that vanished at zero would be indistinguishable from one that failed to load, and "no
 * facilities here" is precisely the finding worth surfacing.
 */
export function nhfrContextSentence(counts: NhfrCounts | null): string | null {
  if (!counts) return null;
  if (counts.nFacilities === 0) {
    return `No health facilities are on the DOH registry for this area (${NHFR_SNAPSHOT_LABEL})`;
  }
  const facilities =
    counts.nFacilities === 1 ? "1 health facility is" : `${counts.nFacilities.toLocaleString()} health facilities are`;
  if (counts.nBarangays <= 0) {
    return `${facilities} on the DOH registry for this area (${NHFR_SNAPSHOT_LABEL})`;
  }
  return (
    `${facilities} on the DOH registry here, across ` +
    `${counts.nBarangaysWithFacility.toLocaleString()} of this area's ` +
    `${counts.nBarangays.toLocaleString()} barangays (${NHFR_SNAPSHOT_LABEL})`
  );
}

export type Row = {
  geo_code: string;
  geo_level: GeoLevel;
  n_facilities: number;
  n_government: number;
  n_private: number;
  n_barangay_health_station: number;
  n_rural_health_unit: number;
  n_hospital: number;
  n_birthing_home: number;
  total_bed_capacity: number;
  n_barangays_with_facility: number;
  n_barangays: number;
};

// One literal, not a concatenation: the Supabase client infers the row type from this string, and
// a concatenated expression widens to `string` and takes the typing with it.
const SELECT_COLS =
  "geo_code, geo_level, n_facilities, n_government, n_private, n_barangay_health_station, n_rural_health_unit, n_hospital, n_birthing_home, total_bed_capacity, n_barangays_with_facility, n_barangays" as const;

/** Pure count-row → derived-share mapping. Exported for unit tests. */
export function toNhfrCounts(row: Row): NhfrCounts {
  const total = row.n_barangays;
  const covered = row.n_barangays_with_facility;
  return {
    geoCode: row.geo_code,
    geoLevel: row.geo_level,
    nFacilities: row.n_facilities,
    nGovernment: row.n_government,
    nPrivate: row.n_private,
    nBarangayHealthStation: row.n_barangay_health_station,
    nRuralHealthUnit: row.n_rural_health_unit,
    nHospital: row.n_hospital,
    nBirthingHome: row.n_birthing_home,
    totalBedCapacity: row.total_bed_capacity,
    nBarangaysWithFacility: covered,
    nBarangays: total,
    coveragePct: total <= 0 ? null : Math.round((100 * covered) / total),
    // Clamped: coverage above 1 is impossible by construction, but a bar that can overflow its
    // track is worth making impossible too (toUucPhcCounts's precedent).
    coverageFraction: total <= 0 ? 0 : Math.min(1, covered / total),
  };
}

/**
 * Facility counts for one geo. Null when the dataset or the row is missing — a read failure, not
 * an area with no facilities, which is a real row reading 0. Per-request `cache()`d.
 */
export const getNhfrCounts = cache(
  async (geoCode: string, geoLevel: GeoLevel): Promise<NhfrCounts | null> => {
    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.nhfr);
    if (datasetId === null) return null;

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_nhfr_counts")
      .select(SELECT_COLS)
      .eq("dataset_id", datasetId)
      .eq("geo_code", geoCode)
      .eq("geo_level", geoLevel)
      .maybeSingle();

    if (error || !data) return null;
    return toNhfrCounts(data);
  },
);

/**
 * The child units of `parentCode` one level down, each with its counts, for the breakdown table.
 * Ordered as `getChildGeos` orders them (by name), joined in memory rather than by a nested
 * select — one `.in()` query, mirroring `getUucPhcChildren`.
 *
 * City/municipality parents return [] : their leaf is the facility list, not another rollup.
 */
export const getNhfrChildren = cache(
  async (parentCode: string, parentLevel: GeoLevel): Promise<NhfrChild[]> => {
    if (parentLevel === "citymun" || parentLevel === "barangay") return [];

    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.nhfr);
    if (datasetId === null) return [];

    const children = await getChildGeos(parentCode, parentLevel);
    if (children.length === 0) return [];

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_nhfr_counts")
      .select(SELECT_COLS)
      .eq("dataset_id", datasetId)
      .in(
        "geo_code",
        children.map((c) => c.geoCode),
      );

    if (error || !data) return [];

    const nameByCode = new Map(children.map((c) => [c.geoCode, c.geoName]));
    const orderByCode = new Map(children.map((c, i) => [c.geoCode, i]));
    return data
      .map((row) => ({
        ...toNhfrCounts(row),
        geoName: nameByCode.get(row.geo_code) ?? row.geo_code,
      }))
      .sort((a, b) => (orderByCode.get(a.geoCode) ?? 0) - (orderByCode.get(b.geoCode) ?? 0));
  },
);

/**
 * The facility-type breakdown for one area, most common first.
 *
 * `agg_nhfr_by_type` is sparse — a row exists only where the count is non-zero — so an empty
 * array means "no facilities here", which `getNhfrCounts` states as an explicit 0. The two are
 * read together on every page that renders this.
 */
export const getNhfrTypes = cache(
  async (geoCode: string, geoLevel: GeoLevel): Promise<NhfrTypeCount[]> => {
    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.nhfr);
    if (datasetId === null) return [];

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_nhfr_by_type")
      .select("facility_type, n_facilities, n_government, n_private")
      .eq("dataset_id", datasetId)
      .eq("geo_code", geoCode)
      .eq("geo_level", geoLevel)
      .order("n_facilities", { ascending: false });

    if (error || !data) return [];
    return data.map((row) => ({
      facilityType: row.facility_type,
      nFacilities: row.n_facilities,
      nGovernment: row.n_government,
      nPrivate: row.n_private,
    }));
  },
);

/**
 * Every facility in a city/municipality — the leaf of the drill-down, and the one place the fact
 * table is read directly. Ordered by facility name.
 *
 * Bounded by `LIST_LIMIT` because PostgREST caps a response at 1,000 rows by default and the
 * largest city/municipality carries several hundred: taking the cap silently would truncate the
 * list with no sign on the page, which is the failure D3.3 had to fix on the district export.
 * The caller renders the count from `agg_nhfr_counts` alongside, so a truncated list is visible
 * as a shortfall rather than a quiet omission.
 */
const LIST_LIMIT = 1000;

export const getNhfrFacilities = cache(async (citymunCode: string): Promise<NhfrFacility[]> => {
  const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.nhfr);
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fact_nhfr_facility")
    .select(
      "facility_code, facility_name, facility_type, ownership_major, ownership_sub, source_barangay_name, bed_capacity, licensing_status",
    )
    .eq("dataset_id", datasetId)
    .eq("geo_code", citymunCode)
    .order("facility_name", { ascending: true })
    .limit(LIST_LIMIT);

  if (error || !data) return [];
  return data.map((row) => ({
    facilityCode: row.facility_code,
    facilityName: row.facility_name,
    facilityType: row.facility_type,
    ownershipMajor: row.ownership_major,
    ownershipSub: row.ownership_sub,
    barangayName: row.source_barangay_name,
    bedCapacity: row.bed_capacity,
    licensingStatus: row.licensing_status,
  }));
});

/**
 * Region + province `{ geoLevel, geoCode }` for `generateStaticParams` and the sitemap —
 * city/municipality pages are left to ISR, as on the other sections. Every region and province
 * has a row (including those with no facilities), so this is the full set. [] on read failure.
 */
export async function getNhfrStaticParams(): Promise<{ geoLevel: GeoLevel; geoCode: string }[]> {
  const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.nhfr);
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_nhfr_counts")
    .select("geo_code, geo_level")
    .eq("dataset_id", datasetId)
    .in("geo_level", ["region", "province"]);

  if (error || !data) return [];
  return data.map((row) => ({ geoLevel: row.geo_level, geoCode: row.geo_code }));
}
