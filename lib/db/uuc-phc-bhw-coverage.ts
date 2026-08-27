import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";
import { getChildGeos } from "./geo";
import type { GeoLevel } from "@/lib/filters/schema";

/**
 * BHW coverage split by UUC for PHC membership (plan §9 U12b), read per geo from
 * `agg_bhw_by_uuc_status`.
 *
 * **This surface is a consistency check, not a discovery, and every type here is shaped by that.**
 * DOH AO No. 2020-0023's physical factor is distance to a health facility, so UUC membership is
 * defined partly on health-system access. A coverage gap between listed and unlisted barangays is
 * therefore partly definitional — and publishing it as a finding would be circular *in either
 * direction*. What the page asks instead is whether BHW coverage is consistent with what the list
 * already implies, and what it reports is the **exception**: an area where the direction reverses.
 *
 * **Every ratio is derived here, none is stored.** The aggregate carries counts only, on the same
 * rule as the UUC section's share and the profiling-status stage totals: one definition, one place.
 * Which also means the compositional check below is computed from the same two numbers the
 * headline is, and cannot drift away from it.
 */

/** One side of the split — the area's listed barangays, or all its other barangays. */
export type UucBhwSide = {
  /** Barangays on this side of the split. */
  nBarangays: number;
  /** Barangays on this side carrying a StepZero row — the base every figure below is built on. */
  nWithData: number;
  /** Barangays on this side reporting no BHW at all. A real zero, never suppressed. */
  nNoBhw: number;
  /** StepZero's whole BHW universe on this side. */
  nBhw: number;
  households: number;
  /** Individually-profiled BHWs, and the base they are profiled out of. Context, not an
   * indicator — see `profilingCoveragePct`. */
  nProfiled: number;
  registeredUniverse: number;
  /**
   * Households per BHW: the site's operative workload measure, since BHWs are assigned to
   * households rather than to a population (`lib/db/stepzero.ts`). Null when this side has no
   * BHWs — a division that would read as "infinite workload" where the honest answer is "none
   * here to carry it", which `nNoBhw` says instead.
   */
  householdsPerBhw: number | null;
  /**
   * BHWs per barangay, and households per barangay. **These two are what stop the headline being
   * misread.** Listed barangays are smaller than others, so most of any households-per-BHW
   * difference between the sides is barangay size rather than BHW deployment. Putting all three
   * on the page is the difference between a comparison and a claim.
   */
  bhwPerBarangay: number | null;
  householdsPerBarangay: number | null;
  /**
   * Profiled BHWs as a share of the profiling-eligible base — computed exactly as
   * `getBhwOverview`'s `profilingCoveragePct` is, off `registeredUniverse`, so the two surfaces
   * cannot drift. This is on the page to *justify* the choice of StepZero over the per-person
   * census: where the two sides differ here, a split of profiled figures would have measured
   * profiling progress and called it BHW supply.
   */
  profilingCoveragePct: number | null;
};

/** Why a comparison cannot be drawn, or that it can. Exhaustive by construction. */
export type UucBhwComparison =
  /** Both sides have at least the §4.1 threshold of barangays behind them. */
  | { kind: "comparable"; listed: UucBhwSide; other: UucBhwSide }
  /** Nothing on the list here (NCR). A real zero, not missing data and not a suppression. */
  | { kind: "nothing-listed"; other: UucBhwSide | null }
  /** Every barangay here is listed (MAYOYAO, 27 of 27). There is no other group to compare with. */
  | { kind: "all-listed"; listed: UucBhwSide | null }
  /** One side has 1–4 barangays. Rendering it as a group statistic is what the rule prevents. */
  | { kind: "suppressed"; suppressedSide: "listed" | "other" };

export type UucBhwCoverage = {
  geoCode: string;
  geoLevel: GeoLevel;
  comparison: UucBhwComparison;
  /**
   * BHWs and households in the area's own published StepZero row that reach neither side, because
   * StepZero carries them above barangay grain only. 16 and 6,061 nationally, in three regions.
   * Published rather than absorbed: listed + other + unallocated is the area total exactly.
   */
  unallocatedNBhw: number;
  unallocatedHouseholds: number;
};

export type UucBhwCoverageChild = UucBhwCoverage & { geoName: string };

export type Row = {
  geo_code: string;
  geo_level: GeoLevel;
  n_barangays_listed: number;
  n_barangays_other: number;
  n_listed_with_data: number;
  n_other_with_data: number;
  n_listed_no_bhw: number;
  n_other_no_bhw: number;
  listed_n_bhw: number | null;
  other_n_bhw: number | null;
  listed_households: number | null;
  other_households: number | null;
  listed_registered_universe: number | null;
  other_registered_universe: number | null;
  listed_n_profiled: number | null;
  other_n_profiled: number | null;
  unallocated_n_bhw: number;
  unallocated_households: number;
  listed_is_suppressed: boolean;
  other_is_suppressed: boolean;
};

// One literal, not a concatenation: PostgREST's generated types parse the select list at compile
// time and can only do so from a single string literal. A `+`-joined string types every row as an
// error object, which is how this was found.
const SELECT_COLS =
  "geo_code, geo_level, n_barangays_listed, n_barangays_other, n_listed_with_data, n_other_with_data, n_listed_no_bhw, n_other_no_bhw, listed_n_bhw, other_n_bhw, listed_households, other_households, listed_registered_universe, other_registered_universe, listed_n_profiled, other_n_profiled, unallocated_n_bhw, unallocated_households, listed_is_suppressed, other_is_suppressed" as const;

/** One decimal place, the precision `householdsPerBhw` is rendered at across the site. */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((10 * numerator) / denominator) / 10;
}

function toSide(input: {
  nBarangays: number;
  nWithData: number;
  nNoBhw: number;
  nBhw: number | null;
  households: number | null;
  registeredUniverse: number | null;
  nProfiled: number | null;
}): UucBhwSide | null {
  // A suppressed side arrives with its measures nulled. There is nothing to build, and building a
  // side of zeroes would put "0 households per BHW" where the answer is "withheld".
  if (
    input.nBhw === null ||
    input.households === null ||
    input.registeredUniverse === null ||
    input.nProfiled === null
  ) {
    return null;
  }
  return {
    nBarangays: input.nBarangays,
    nWithData: input.nWithData,
    nNoBhw: input.nNoBhw,
    nBhw: input.nBhw,
    households: input.households,
    nProfiled: input.nProfiled,
    registeredUniverse: input.registeredUniverse,
    householdsPerBhw: ratio(input.households, input.nBhw),
    bhwPerBarangay: ratio(input.nBhw, input.nWithData),
    householdsPerBarangay: ratio(input.households, input.nWithData),
    // One decimal, unlike the whole-percent coverage figure elsewhere on the site. This row exists
    // to show a *difference* between the two sides, and nationally that difference is 96.9 against
    // 97.5 — at whole percent both read "97%" and the row says nothing at all.
    profilingCoveragePct:
      input.registeredUniverse > 0
        ? Math.round((1000 * input.nProfiled) / input.registeredUniverse) / 10
        : null,
  };
}

/**
 * Pure row → comparison mapping. Exported for unit tests.
 *
 * The order of the cases matters and is the design: an area with nothing listed and an area whose
 * listed side is suppressed must never collapse into one state, because "none of this area's
 * barangays are on the list" and "too few to show" are opposite messages. A zero is checked first
 * for exactly that reason, and the migration asserts that a zero side is never marked suppressed.
 */
export function toUucBhwCoverage(row: Row): UucBhwCoverage {
  const listed = toSide({
    nBarangays: row.n_barangays_listed,
    nWithData: row.n_listed_with_data,
    nNoBhw: row.n_listed_no_bhw,
    nBhw: row.listed_n_bhw,
    households: row.listed_households,
    registeredUniverse: row.listed_registered_universe,
    nProfiled: row.listed_n_profiled,
  });
  const other = toSide({
    nBarangays: row.n_barangays_other,
    nWithData: row.n_other_with_data,
    nNoBhw: row.n_other_no_bhw,
    nBhw: row.other_n_bhw,
    households: row.other_households,
    registeredUniverse: row.other_registered_universe,
    nProfiled: row.other_n_profiled,
  });

  const base = {
    geoCode: row.geo_code,
    geoLevel: row.geo_level,
    unallocatedNBhw: row.unallocated_n_bhw,
    unallocatedHouseholds: row.unallocated_households,
  };

  if (row.n_barangays_listed === 0)
    return { ...base, comparison: { kind: "nothing-listed", other } };
  if (row.n_barangays_other === 0) return { ...base, comparison: { kind: "all-listed", listed } };
  if (row.listed_is_suppressed) {
    return { ...base, comparison: { kind: "suppressed", suppressedSide: "listed" } };
  }
  if (row.other_is_suppressed) {
    return { ...base, comparison: { kind: "suppressed", suppressedSide: "other" } };
  }
  // Both sides are present and above the threshold. `toSide` can only have returned null for a
  // suppressed side, which the two branches above have already taken, so this is total — but it is
  // checked rather than asserted, because a silently half-drawn comparison is the failure mode.
  if (!listed || !other)
    return { ...base, comparison: { kind: "suppressed", suppressedSide: "listed" } };
  return { ...base, comparison: { kind: "comparable", listed, other } };
}

/**
 * Which way the comparison points, or null when it cannot be drawn.
 *
 * `"thinner"` means the listed barangays carry **more** households per BHW than the rest of the
 * area — worse coverage where the list says the community is unserved. Nationally the answer is
 * the other way round, and in 76 of the 81 comparable provinces too, which is why `"thinner"` is
 * the reportable case: it is the one the definitional overlap does *not* already explain.
 *
 * `"even"` is a real answer, not a rounding artefact — the two sides carry the same load to within
 * the tenth of a household the site publishes.
 */
export function coverageDirection(
  comparison: UucBhwComparison,
): "thinner" | "thicker" | "even" | null {
  if (comparison.kind !== "comparable") return null;
  const l = comparison.listed.householdsPerBhw;
  const o = comparison.other.householdsPerBhw;
  if (l === null || o === null) return null;
  if (l > o) return "thinner";
  if (l < o) return "thicker";
  return "even";
}

/**
 * How much of the households-per-BHW difference is barangay size rather than BHW deployment.
 *
 * The number the page needs is not the gap but its *explanation*. If listed barangays hold half as
 * many households each and carry the same number of BHWs each, then households per BHW is halved
 * with nothing about BHW deployment having changed at all. This returns the two per-barangay
 * ratios beside each other so the page can say so from computed figures rather than in prose.
 *
 * Null when either side has no per-barangay figure to compare.
 */
export function sizeExplanation(comparison: UucBhwComparison): {
  householdsPerBarangayRatio: number;
  bhwPerBarangayRatio: number;
} | null {
  if (comparison.kind !== "comparable") return null;
  const { listed, other } = comparison;
  if (
    listed.householdsPerBarangay === null ||
    other.householdsPerBarangay === null ||
    listed.bhwPerBarangay === null ||
    other.bhwPerBarangay === null ||
    other.householdsPerBarangay <= 0 ||
    other.bhwPerBarangay <= 0
  ) {
    return null;
  }
  return {
    // Listed as a multiple of other. Below 1 means listed barangays are the smaller ones.
    householdsPerBarangayRatio:
      Math.round((100 * listed.householdsPerBarangay) / other.householdsPerBarangay) / 100,
    bhwPerBarangayRatio: Math.round((100 * listed.bhwPerBarangay) / other.bhwPerBarangay) / 100,
  };
}

/**
 * The split for one geo. Null when the dataset or the row is missing — a read failure, which the
 * page renders as "unavailable" rather than as "no difference here". Per-request `cache()`d.
 */
export const getUucBhwCoverage = cache(
  async (geoCode: string, geoLevel: GeoLevel): Promise<UucBhwCoverage | null> => {
    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
    if (datasetId === null) return null;

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_bhw_by_uuc_status")
      .select(SELECT_COLS)
      .eq("dataset_id", datasetId)
      .eq("geo_code", geoCode)
      .eq("geo_level", geoLevel)
      .maybeSingle();

    if (error || !data) return null;
    return toUucBhwCoverage(data);
  },
);

/**
 * The child units of `parentCode` one level down, each with its own comparison — the breakdown
 * that turns the exception into something findable. Ordered by name, joined in memory to
 * `dim_geo`, mirroring `getUucPhcChildren`.
 *
 * City/municipality parents return []: the aggregate stops at citymun, and a barangay is entirely
 * listed or entirely not, so there is no split one level below.
 */
export const getUucBhwCoverageChildren = cache(
  async (parentCode: string, parentLevel: GeoLevel): Promise<UucBhwCoverageChild[]> => {
    if (parentLevel === "citymun" || parentLevel === "barangay") return [];

    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
    if (datasetId === null) return [];

    const children = await getChildGeos(parentCode, parentLevel);
    if (children.length === 0) return [];

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_bhw_by_uuc_status")
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
        ...toUucBhwCoverage(row),
        geoName: nameByCode.get(row.geo_code) ?? row.geo_code,
      }))
      .sort((a, b) => (orderByCode.get(a.geoCode) ?? 0) - (orderByCode.get(b.geoCode) ?? 0));
  },
);

/**
 * Region + province params for `generateStaticParams`, on `getUucPhcStaticParams`' precedent —
 * city/municipality pages are left to ISR. Returns [] on any read failure.
 */
export async function getUucBhwCoverageStaticParams(): Promise<
  { geoLevel: GeoLevel; geoCode: string }[]
> {
  const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_bhw_by_uuc_status")
    .select("geo_code, geo_level")
    .eq("dataset_id", datasetId)
    .in("geo_level", ["region", "province"]);

  if (error || !data) return [];
  return data.map((row) => ({ geoLevel: row.geo_level, geoCode: row.geo_code }));
}
