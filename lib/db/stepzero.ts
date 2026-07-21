import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";
import { getBhwCounts } from "./indicators";
import { getCensusPopulation2024 } from "./population";
import type { GeoLevel } from "@/lib/filters/schema";

/**
 * StepZero quick-count aggregate for one geo — the DOH barangay headcount that
 * defines the *total universe* of BHWs (registered + registered & accredited +
 * non-registered), rolled up to every geo level. This is a different, coarser
 * measure than the per-person `agg_bhw_counts`: see docs/DECISIONS.md for why
 * the two are kept separate (self-reported tally vs. verified per-person flag).
 */
export type StepzeroCounts = {
  geoCode: string;
  geoLevel: GeoLevel;
  nRegistered: number | null;
  nRegisteredAccredited: number | null;
  nNonRegistered: number | null;
  nTotalBhw: number | null;
  /** Registered + registered & accredited — the profiling-eligible base
   * (non-registered BHWs are never individually profiled). */
  registeredUniverse: number | null;
  /** LGU/quick-count-reported accreditation as a share of the whole BHW universe
   * (n_registered_accredited ÷ n_total_bhw). A different measure from the
   * per-person `agg_bhw_counts.pct_accredited` — see `getBhwOverview` (E2.1). */
  pctRegisteredAccredited: number | null;
  population: number | null;
  households: number | null;
};

export async function getStepzeroCounts(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<StepzeroCounts | null> {
  const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.stepzero);
  if (datasetId === null) return null;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_bhw_stepzero_counts")
    .select(
      "geo_code, geo_level, n_registered, n_registered_accredited, n_non_registered, n_total_bhw, pct_registered_accredited, population, households",
    )
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .maybeSingle();

  if (error || !data) return null;

  const registeredUniverse =
    data.n_registered === null && data.n_registered_accredited === null
      ? null
      : (data.n_registered ?? 0) + (data.n_registered_accredited ?? 0);

  return {
    geoCode: data.geo_code,
    geoLevel: data.geo_level,
    nRegistered: data.n_registered,
    nRegisteredAccredited: data.n_registered_accredited,
    nNonRegistered: data.n_non_registered,
    nTotalBhw: data.n_total_bhw,
    registeredUniverse,
    pctRegisteredAccredited: data.pct_registered_accredited,
    population: data.population,
    households: data.households,
  };
}

/**
 * The single figure the UI reads for "how many BHWs are here, and how many are
 * individually profiled". Combines the StepZero universe with the per-person
 * `agg_bhw_counts` (validated profiles):
 *
 *  - `totalBhw`            — StepZero total (registered + accredited + non-registered)
 *  - `registeredUniverse`  — StepZero registered + accredited (profiling-eligible base)
 *  - `nonRegistered`       — StepZero non-registered segment
 *  - `validatedProfiles`   — count of individually-profiled BHWs (agg_bhw_counts.n_total)
 *  - `profilingCoveragePct`— validatedProfiles / registeredUniverse, rounded; null when the
 *                            base is missing/zero. `coverageExceedsBase` flags drift
 *                            (profiled > base) so callers can cap the headline at 100%
 *                            while still showing the raw ratio in technical details.
 *
 * When StepZero has no row for this geo (e.g. the ~2,689 newer/renumbered PSGC
 * barangays absent from `dim_geo`, or any area with no quick-count), the total
 * fields are null and callers fall back to showing `validatedProfiles` alone.
 */
export type BhwOverview = {
  geoCode: string;
  geoLevel: GeoLevel;
  totalBhw: number | null;
  registeredUniverse: number | null;
  /** StepZero's "registered" bucket alone (excludes registered & accredited). */
  nRegistered: number | null;
  /** StepZero's "registered & accredited" bucket alone. */
  nRegisteredAccredited: number | null;
  nonRegistered: number | null;
  validatedProfiles: number | null;
  profilingCoveragePct: number | null;
  coverageExceedsBase: boolean;
  hasStepzero: boolean;
  /** StepZero's per-barangay population figure, rolled up like everything else in
   * `agg_bhw_stepzero_counts`. Null wherever StepZero has no row for this geo. */
  population: number | null;
  households: number | null;
  /** Households per BHW — households divided by Total BHWs (the StepZero
   * universe). BHWs in the Philippines are assigned to households, so this
   * ratio (not a per-capita rate) is the operative workload measure. Built from
   * StepZero's own households column, which covers every geo level. Null when
   * either input is missing or zero. */
  householdsPerBhw: number | null;
  /** LGU/quick-count-reported accreditation share of the whole BHW universe
   * (E2.1). Surfaced alongside — never averaged with — the verified per-person
   * `pctAccredited`, as a data-quality triangulation. Null without StepZero. */
  pctRegisteredAccredited: number | null;
  /** Total BHWs per 1,000 residents (E2.1); population is StepZero
   * self-reported. Null when either input is missing or zero. */
  bhwPer1000: number | null;
};

/** BHWs per 1,000 residents, one decimal. Null without both inputs positive. */
export function bhwPer1000(totalBhw: number | null, population: number | null): number | null {
  if (totalBhw === null || population === null || totalBhw <= 0 || population <= 0) return null;
  return Math.round((1000 * totalBhw) / population * 10) / 10;
}

/** Coverage percentage for display: capped at 100 when profiled counts exceed
 * the StepZero registered base (two independently-collected datasets can drift
 * at a fine grain). The raw, uncapped ratio stays in `profilingCoveragePct`. */
export function coverageForDisplay(
  o: Pick<BhwOverview, "profilingCoveragePct" | "coverageExceedsBase">,
): number | null {
  if (o.profilingCoveragePct === null) return null;
  return o.coverageExceedsBase ? 100 : o.profilingCoveragePct;
}

/** Households served per BHW, rounded. Null without both inputs positive
 * (nothing sane to divide by). */
export function householdsPerBhw(
  households: number | null,
  totalBhw: number | null,
): number | null {
  if (households === null || totalBhw === null || households <= 0 || totalBhw <= 0) return null;
  return Math.round(households / totalBhw);
}

export async function getBhwOverview(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<BhwOverview> {
  const [stepzero, counts, censusPop] = await Promise.all([
    getStepzeroCounts(geoCode, geoLevel),
    getBhwCounts(geoCode, geoLevel),
    getCensusPopulation2024(geoCode),
  ]);

  const validatedProfiles = counts?.nTotal ?? null;
  const base = stepzero?.registeredUniverse ?? null;

  let profilingCoveragePct: number | null = null;
  let coverageExceedsBase = false;
  if (validatedProfiles !== null && base !== null && base > 0) {
    const raw = (100 * validatedProfiles) / base;
    profilingCoveragePct = Math.round(raw);
    coverageExceedsBase = validatedProfiles > base;
  }

  // Census population (E4.2) preferred; StepZero self-reported population is the fallback.
  const population = censusPop ?? stepzero?.population ?? null;
  const households = stepzero?.households ?? null;
  const totalBhw = stepzero?.nTotalBhw ?? null;

  return {
    geoCode,
    geoLevel,
    totalBhw,
    registeredUniverse: base,
    nRegistered: stepzero?.nRegistered ?? null,
    nRegisteredAccredited: stepzero?.nRegisteredAccredited ?? null,
    nonRegistered: stepzero?.nNonRegistered ?? null,
    validatedProfiles,
    profilingCoveragePct,
    coverageExceedsBase,
    hasStepzero: stepzero !== null,
    population,
    households,
    householdsPerBhw: householdsPerBhw(households, totalBhw),
    pctRegisteredAccredited: stepzero?.pctRegisteredAccredited ?? null,
    bhwPer1000: bhwPer1000(totalBhw, population),
  };
}

export type RegionHouseholdsPerBhw = { geoCode: string; geoName: string; value: number };

/**
 * Households-per-BHW for every region, for the home tile's regional-spread
 * comparator (HOME_SEARCH_REVIEW item 9: in the national context, show the
 * distribution across regions rather than a gauge against an arbitrary or
 * unconfirmed target). Regions with no household or BHW data are omitted.
 */
export async function getRegionHouseholdsPerBhw(): Promise<RegionHouseholdsPerBhw[]> {
  const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.stepzero);
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const [{ data: counts }, { data: names }] = await Promise.all([
    supabase
      .from("agg_bhw_stepzero_counts")
      .select("geo_code, n_total_bhw, households")
      .eq("dataset_id", datasetId)
      .eq("geo_level", "region"),
    supabase.from("dim_geo").select("geo_code, geo_name").eq("geo_level", "region"),
  ]);
  if (!counts) return [];

  const nameByCode = new Map((names ?? []).map((row) => [row.geo_code, row.geo_name]));
  return counts
    .map((row) => ({
      geoCode: row.geo_code,
      geoName: nameByCode.get(row.geo_code) ?? row.geo_code,
      value: householdsPerBhw(row.households, row.n_total_bhw),
    }))
    .filter((r): r is RegionHouseholdsPerBhw => r.value !== null)
    .sort((a, b) => a.value - b.value);
}
