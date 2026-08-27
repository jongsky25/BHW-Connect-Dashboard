import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";
import { getChildGeos } from "./geo";
import type { GeoLevel } from "@/lib/filters/schema";

/**
 * UUC for PHC 2025 — the 2025 list of Unserved and Underserved Communities for Primary Health
 * Care (DC No. 2025-0549; criteria per DOH AO No. 2020-0023), read per geo.
 *
 * This dataset is a *membership list*, not a measurement: a barangay is either on it or not. So
 * every figure here is one count against one denominator — `nListed` barangays out of `nBarangays`
 * in the area — and the share is derived here rather than stored, keeping the definition in one
 * place (the same discipline as `profiling-status.ts`'s stage totals).
 *
 * **The denominator is `dim_geo`'s barangay count**, i.e. every barangay in the area. The source
 * workbook also assessed 9,395 barangays it did not list, but those are not loaded (see
 * `docs/UUC_PHC_2025_PLAN.md` U1) and are not the universe anyway: the question a reader has is
 * "how many of this town's barangays are unserved or underserved", and the town's barangay count
 * comes from `dim_geo`.
 *
 * **A zero is data, not a gap.** `agg_uuc_phc_counts` carries a row for every geo, so an area with
 * no listed barangays reads "0 of 42" rather than "no data" — a distinction the profiling-status
 * card had to message around because its source is loaded region by region. This one is national
 * and complete in a single publication.
 */
export type UucPhcCounts = {
  geoCode: string;
  geoLevel: GeoLevel;
  /** Barangays in this area on the 2025 UUC for PHC list. */
  nListed: number;
  /** Barangays in this area in total, from dim_geo — the share's denominator. */
  nBarangays: number;
  /** `nListed` as a rounded % of `nBarangays`, or null when the denominator is 0/unknown. */
  sharePct: number | null;
  /** `nListed` as a share of the bar (0..1). 0 when the denominator is 0. */
  fraction: number;
};

/** One child unit (e.g. a province's cities) with its counts, for the breakdown. */
export type UucPhcChild = UucPhcCounts & { geoName: string };

/** One barangay of a city/municipality, flagged with whether it is on the list. */
export type UucPhcBarangay = {
  geoCode: string;
  geoName: string;
  listed: boolean;
};

/**
 * Section name this dataset presents under (plan U6). The deck chrome defaults to "BHW Connect";
 * this section is a different dataset with its own header, footer and title template, so it says
 * so rather than borrowing the census's name.
 */
export const UUC_PHC_BRAND_LABEL = "UUC for PHC";

/**
 * The deck's caption line, in the Person/Place/Time form the rest of the site uses.
 *
 * The N is the *area's* listed count, not the national 5,991: a deck presented on Mayoyao is about
 * Mayoyao's 27 barangays, and quoting the national figure over a city's slides would state a
 * number none of the figures on screen support. At national the two coincide, which is the case
 * the plan's example shows.
 */
export function uucDeckCaption(counts: UucPhcCounts | null, areaLabel: string): string {
  const n = counts ? counts.nListed.toLocaleString() : "—";
  return `N = ${n} listed barangays · ${areaLabel} · 2025 list (DC No. 2025-0549)`;
}

/**
 * Route this area's UUC for PHC coverage lives at. National is the section landing page
 * (`/uuc-phc`) — where the drill-down starts — and every other level is the per-area route.
 * There is no barangay route: `/uuc-phc/barangay/*` 404s by design, because a barangay page would
 * be one yes/no the city/municipality page already renders.
 */
export function uucPhcAreaHref(geoLevel: GeoLevel, geoCode: string): string {
  return geoLevel === "national" ? "/uuc-phc" : `/uuc-phc/${geoLevel}/${geoCode}`;
}

/**
 * The cross-dataset context chip's sentence (plan §9 U12a), or null when there is nothing to say.
 * Pure, and here rather than in the component on `uucDeckCaption`'s precedent — this section keeps
 * its copy rules next to the counts they read.
 *
 * **The sentence names its own universe in its own words.** The pages this appears on
 * (`/explore`, `/place/*`) are about *BHW profiles*; this is a count of *barangays*. That is the
 * denominator switch §9 U12 refuses to put behind the map's indicator switcher, where one legend
 * and one colour ramp would span two universes with nothing telling a reader they had changed. A
 * sentence can do what a colour ramp cannot: say "barangays" out loud, beside its own denominator.
 * That is the whole reason this is a chip and not a map layer.
 *
 * **"this area's", not the area name.** Both host pages already carry the place name in their
 * heading directly above, and the generic phrasing keeps one string for every level — the
 * alternative needs a possessive, which "Philippines" and "Cebu Province" do not share.
 *
 * **A zero renders, and says so positively.** `agg_uuc_phc_counts` carries a row for every geo, so
 * NCR is a real 0 of 1,675 rather than an absence. A chip that vanished at zero would be
 * indistinguishable from one that failed to load, and a reader could not tell "none listed here"
 * from "we did not look".
 */
export function uucContextSentence(counts: UucPhcCounts | null): string | null {
  // Null is a read failure *or* a level the aggregate does not cover — it stops at citymun, so a
  // barangay geo has no row. Neither is a statement about the area, so the chip makes none.
  if (!counts) return null;
  // No denominator, no sentence: "0 of 0 barangays" asserts nothing, and no real area has none.
  if (counts.nBarangays <= 0) return null;

  const suffix = `of this area's ${counts.nBarangays.toLocaleString()} barangays`;
  if (counts.nListed === 0) return `None ${suffix} are on the 2025 UUC for PHC list`;
  if (counts.nListed === 1) return `1 ${suffix} is on the 2025 UUC for PHC list`;
  return `${counts.nListed.toLocaleString()} ${suffix} are on the 2025 UUC for PHC list`;
}

export type Row = {
  geo_code: string;
  geo_level: GeoLevel;
  n_listed: number;
  n_barangays: number;
};

const SELECT_COLS = "geo_code, geo_level, n_listed, n_barangays" as const;

/** Pure count-row → derived-share mapping. Exported for unit tests. */
export function toUucPhcCounts(row: Row): UucPhcCounts {
  const total = row.n_barangays;
  const listed = row.n_listed;
  return {
    geoCode: row.geo_code,
    geoLevel: row.geo_level,
    nListed: listed,
    nBarangays: total,
    sharePct: total <= 0 ? null : Math.round((100 * listed) / total),
    // Clamped: a share above 1 is impossible by construction (a listed barangay is one of the
    // area's barangays), but a bar that can overflow its track is worth making impossible too.
    fraction: total <= 0 ? 0 : Math.min(1, listed / total),
  };
}

/**
 * UUC for PHC counts for one geo. Null when the dataset or the row is missing — a read failure,
 * not an area with none listed, which is a real row reading 0. Per-request `cache()`d.
 */
export const getUucPhcCounts = cache(
  async (geoCode: string, geoLevel: GeoLevel): Promise<UucPhcCounts | null> => {
    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
    if (datasetId === null) return null;

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_uuc_phc_counts")
      .select(SELECT_COLS)
      .eq("dataset_id", datasetId)
      .eq("geo_code", geoCode)
      .eq("geo_level", geoLevel)
      .maybeSingle();

    if (error || !data) return null;
    return toUucPhcCounts(data);
  },
);

/**
 * The child units of `parentCode` one level down, each with its counts, for the breakdown table
 * (a region → its provinces, a province → its cities). Ordered by name, mirroring
 * `getProfilingStatusChildren`: one `.in()` query, joined in memory to `dim_geo` names.
 *
 * City/municipality parents are handled by `getUucPhcBarangays` instead — the aggregate stops at
 * citymun, since barangay rows would only restate the fact table.
 */
export const getUucPhcChildren = cache(
  async (parentCode: string, parentLevel: GeoLevel): Promise<UucPhcChild[]> => {
    if (parentLevel === "citymun" || parentLevel === "barangay") return [];

    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
    if (datasetId === null) return [];

    const children = await getChildGeos(parentCode, parentLevel);
    if (children.length === 0) return [];

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_uuc_phc_counts")
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
        ...toUucPhcCounts(row),
        geoName: nameByCode.get(row.geo_code) ?? row.geo_code,
      }))
      .sort((a, b) => (orderByCode.get(a.geoCode) ?? 0) - (orderByCode.get(b.geoCode) ?? 0));
  },
);

/**
 * Every barangay of a city/municipality, flagged with whether it is on the list — the leaf of the
 * drill-down, and the one place the fact table is read directly. Naming the barangays that are
 * *not* listed alongside those that are is the point: at this level the reader is looking at their
 * own town, and "which ones" is the actionable question. Ordered by name.
 */
export const getUucPhcBarangays = cache(async (citymunCode: string): Promise<UucPhcBarangay[]> => {
  const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
  if (datasetId === null) return [];

  const barangays = await getChildGeos(citymunCode, "citymun");
  if (barangays.length === 0) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fact_uuc_phc_barangay")
    .select("geo_code")
    .eq("dataset_id", datasetId)
    .in(
      "geo_code",
      barangays.map((b) => b.geoCode),
    );

  if (error || !data) return [];

  const listed = new Set(data.map((row) => row.geo_code));
  return barangays.map((b) => ({
    geoCode: b.geoCode,
    geoName: b.geoName,
    listed: listed.has(b.geoCode),
  }));
});

/**
 * Region + province `{ geoLevel, geoCode }` for `generateStaticParams` and the sitemap —
 * city/municipality pages are left to ISR, as on the profiling-status section. Every region and
 * province has a row (including those with none listed), so this is the full set.
 * Returns [] on any read failure.
 */
export async function getUucPhcStaticParams(): Promise<{ geoLevel: GeoLevel; geoCode: string }[]> {
  const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_uuc_phc_counts")
    .select("geo_code, geo_level")
    .eq("dataset_id", datasetId)
    .in("geo_level", ["region", "province"]);

  if (error || !data) return [];
  return data.map((row) => ({ geoLevel: row.geo_level, geoCode: row.geo_code }));
}
