import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";
import { getBhwCounts } from "./indicators";
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
      "geo_code, geo_level, n_registered, n_registered_accredited, n_non_registered, n_total_bhw, population, households",
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
  nonRegistered: number | null;
  validatedProfiles: number | null;
  profilingCoveragePct: number | null;
  coverageExceedsBase: boolean;
  hasStepzero: boolean;
};

/** Coverage percentage for display: capped at 100 when profiled counts exceed
 * the StepZero registered base (two independently-collected datasets can drift
 * at a fine grain). The raw, uncapped ratio stays in `profilingCoveragePct`. */
export function coverageForDisplay(
  o: Pick<BhwOverview, "profilingCoveragePct" | "coverageExceedsBase">,
): number | null {
  if (o.profilingCoveragePct === null) return null;
  return o.coverageExceedsBase ? 100 : o.profilingCoveragePct;
}

export async function getBhwOverview(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<BhwOverview> {
  const [stepzero, counts] = await Promise.all([
    getStepzeroCounts(geoCode, geoLevel),
    getBhwCounts(geoCode, geoLevel),
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

  return {
    geoCode,
    geoLevel,
    totalBhw: stepzero?.nTotalBhw ?? null,
    registeredUniverse: base,
    nonRegistered: stepzero?.nNonRegistered ?? null,
    validatedProfiles,
    profilingCoveragePct,
    coverageExceedsBase,
    hasStepzero: stepzero !== null,
  };
}
