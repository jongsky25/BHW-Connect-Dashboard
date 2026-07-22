import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";
import { getChildGeos } from "./geo";
import type { GeoLevel } from "@/lib/filters/schema";

/**
 * 2026 BHW Connect Profiling Status — how far the individual-profiling encoding has
 * progressed for one geo, rolled up to every level. This is the 2026 encoding-workflow
 * snapshot (dataset `bhw-profiling-status-2026`), deliberately kept apart from the 2025
 * datasets (the per-person `agg_bhw_counts` and the StepZero headcount baseline).
 *
 * The five pipeline buckets are the mutually-exclusive current status of each record:
 *   drafted → for_validation → (back_to_encoder ⟲) → validated → approved
 * From them we derive a cumulative Encode → Validate → Certify funnel, each measured
 * against `totalBhw` (registered + accredited + unregistered — the 2026 denominator, since
 * every BHW is to be profiled this year):
 *   - Encoded   = all five buckets (every record that has entered the pipeline)
 *   - Validated = validated + approved (records that have passed validation)
 *   - Certified = approved
 * so Encoded ≥ Validated ≥ Certified.
 */
export type ProfilingStatusStep = {
  /** Records that have reached (or passed) this step. */
  count: number;
  /** `count` as a % of `totalBhw`, rounded, or null when the denominator is 0/unknown. */
  pct: number | null;
  /** `pct` capped at 100 for display; the raw ratio can exceed 100 when the encoding
   * snapshot drifts above the headcount denominator (two independently-collected figures). */
  pctCapped: number | null;
  /** How many BHWs still have to reach this step to hit the goal — `total - count`, floored
   * at 0 (an overshooting snapshot has nothing left to do, not a negative gap). */
  remaining: number;
  /** `remaining` as a % of `totalBhw` (100 - `pctCapped`), or null when the denominator is
   * 0/unknown. The "how far to go" complement of `pctCapped`. */
  pctToGo: number | null;
};

export type ProfilingStatus = {
  geoCode: string;
  geoLevel: GeoLevel;
  /** Denominator — every BHW to be profiled (registered + accredited + unregistered). */
  totalBhw: number;
  nRegistered: number;
  nAccredited: number;
  nUnregistered: number;
  /** Raw pipeline buckets. */
  nDrafted: number;
  nForValidation: number;
  nBackToEncoder: number;
  nValidated: number;
  nApproved: number;
  /** Cumulative funnel steps. */
  encode: ProfilingStatusStep;
  validate: ProfilingStatusStep;
  certify: ProfilingStatusStep;
};

/** One child unit (e.g. a province's cities) with its funnel counts, for the breakdown. */
export type ProfilingStatusChild = ProfilingStatus & { geoName: string };

export type Row = {
  geo_code: string;
  geo_level: GeoLevel;
  n_registered: number;
  n_accredited: number;
  n_unregistered: number;
  n_total_bhw: number;
  n_drafted: number;
  n_for_validation: number;
  n_back_to_encoder: number;
  n_validated: number;
  n_approved: number;
};

const SELECT_COLS =
  "geo_code, geo_level, n_registered, n_accredited, n_unregistered, n_total_bhw, n_drafted, n_for_validation, n_back_to_encoder, n_validated, n_approved" as const;

/** A funnel step from a reached-count and the denominator. Exported for unit tests. */
export function step(count: number, total: number): ProfilingStatusStep {
  const remaining = Math.max(0, total - count);
  if (total <= 0) {
    return { count, pct: null, pctCapped: null, remaining, pctToGo: null };
  }
  const pct = Math.round((100 * count) / total);
  const pctCapped = Math.min(100, pct);
  return { count, pct, pctCapped, remaining, pctToGo: 100 - pctCapped };
}

/** Pure count-row → funnel mapping. Exported for unit tests. */
export function toProfilingStatus(row: Row): ProfilingStatus {
  const total = row.n_total_bhw;
  const encoded =
    row.n_drafted +
    row.n_for_validation +
    row.n_back_to_encoder +
    row.n_validated +
    row.n_approved;
  const validated = row.n_validated + row.n_approved;
  const certified = row.n_approved;
  return {
    geoCode: row.geo_code,
    geoLevel: row.geo_level,
    totalBhw: total,
    nRegistered: row.n_registered,
    nAccredited: row.n_accredited,
    nUnregistered: row.n_unregistered,
    nDrafted: row.n_drafted,
    nForValidation: row.n_for_validation,
    nBackToEncoder: row.n_back_to_encoder,
    nValidated: row.n_validated,
    nApproved: row.n_approved,
    encode: step(encoded, total),
    validate: step(validated, total),
    certify: step(certified, total),
  };
}

/**
 * Profiling status for one geo. Null when the dataset or the row is missing (e.g. a region
 * whose encoding sheet hasn't been loaded yet). Per-request `cache()`d, like `getStepzeroCounts`.
 */
export const getProfilingStatus = cache(
  async (geoCode: string, geoLevel: GeoLevel): Promise<ProfilingStatus | null> => {
    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.profilingStatus);
    if (datasetId === null) return null;

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_bhw_profiling_status")
      .select(SELECT_COLS)
      .eq("dataset_id", datasetId)
      .eq("geo_code", geoCode)
      .eq("geo_level", geoLevel)
      .maybeSingle();

    if (error || !data) return null;
    return toProfilingStatus(data);
  },
);

/**
 * The child units of `parentCode` one geo level down, each with its funnel counts, for the
 * breakdown table (a region → its provinces, a province → its cities). Ordered by name.
 * Children with no profiling-status row are omitted. Mirrors `getRegionHouseholdsPerBhw`:
 * one `.in()` query for the counts, joined in memory to `dim_geo` names via `getChildGeos`.
 */
export const getProfilingStatusChildren = cache(
  async (parentCode: string, parentLevel: GeoLevel): Promise<ProfilingStatusChild[]> => {
    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.profilingStatus);
    if (datasetId === null) return [];

    const children = await getChildGeos(parentCode, parentLevel);
    if (children.length === 0) return [];

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_bhw_profiling_status")
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
        ...toProfilingStatus(row),
        geoName: nameByCode.get(row.geo_code) ?? row.geo_code,
      }))
      .sort(
        (a, b) =>
          (orderByCode.get(a.geoCode) ?? 0) - (orderByCode.get(b.geoCode) ?? 0),
      );
  },
);

/**
 * Region + province `{ geoLevel, geoCode }` that actually have a profiling-status row — for
 * `generateStaticParams` (pre-render only geos with data) and the sitemap. City/municipality
 * pages are left to ISR. Returns [] on any read failure.
 */
export async function getProfilingStatusStaticParams(): Promise<
  { geoLevel: GeoLevel; geoCode: string }[]
> {
  const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.profilingStatus);
  if (datasetId === null) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agg_bhw_profiling_status")
    .select("geo_code, geo_level")
    .eq("dataset_id", datasetId)
    .in("geo_level", ["region", "province"]);

  if (error || !data) return [];
  return data.map((row) => ({ geoLevel: row.geo_level, geoCode: row.geo_code }));
}
