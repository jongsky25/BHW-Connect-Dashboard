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
 * The five raw pipeline buckets are the mutually-exclusive current status of each *record*:
 *   drafted → for_validation → (back_to_encoder ⟲) → validated → approved
 * From them — and the headcount denominator — we derive four mutually-exclusive stages that
 * partition every BHW to be profiled, so they always sum to 100% of `totalBhw`:
 *   - Encoded    = drafted + for_validation + back_to_encoder (in the pipeline, awaiting validation)
 *   - Validated  = validated                                  (validated, awaiting attestation)
 *   - Attested   = approved                                   (the finish line)
 *   - NotEncoded = totalBhw − (Encoded + Validated + Attested)(not yet entered the pipeline)
 * so Encoded + Validated + Attested + NotEncoded = totalBhw. `totalBhw` = registered + accredited +
 * unregistered (the 2026 denominator, since every BHW is to be profiled this year).
 *
 * These stages are deliberately *not* cumulative: each BHW is counted in exactly one, which is why
 * the four shares add up to the whole. "Attested" was formerly labelled "Certified".
 */
export type ProfilingStage = {
  /** BHWs whose current stage is this one (mutually exclusive across the four stages). */
  count: number;
  /** `count` as a % of `totalBhw`, rounded, or null when the denominator is 0/unknown. The four
   * stages' percentages sum to ~100 (exactly, give or take integer rounding). */
  pct: number | null;
  /** `count` as a share of the stacked bar (0..1). Normalized against the larger of the headcount
   * and the in-pipeline total, so the four stages fill the bar exactly once even when an encoding
   * snapshot overshoots the headcount (two independently-collected figures). */
  fraction: number;
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
  /** Four mutually-exclusive stages that partition `totalBhw` (encoded + validated + attested +
   * notEncoded = totalBhw). */
  encoded: ProfilingStage;
  validated: ProfilingStage;
  attested: ProfilingStage;
  notEncoded: ProfilingStage;
  /** Finish-line gap: every BHW not yet attested (`totalBhw − attested`, floored at 0), with its
   * % of the denominator. The headline "still to attest" number. */
  toAttest: { count: number; pct: number | null };
};

/** One child unit (e.g. a province's cities) with its stage counts, for the breakdown. */
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

/** `count` as a rounded % of `total`, or null when the denominator is 0/unknown. */
function roundPct(count: number, total: number): number | null {
  return total <= 0 ? null : Math.round((100 * count) / total);
}

/** Pure count-row → four-stage mapping. Exported for unit tests. */
export function toProfilingStatus(row: Row): ProfilingStatus {
  const total = row.n_total_bhw;
  const encodedN = row.n_drafted + row.n_for_validation + row.n_back_to_encoder;
  const validatedN = row.n_validated;
  const attestedN = row.n_approved;
  const inPipeline = encodedN + validatedN + attestedN;
  const notEncodedN = Math.max(0, total - inPipeline);
  // Bar widths are normalized against whichever is larger — the headcount or the pipeline — so an
  // overshooting snapshot (pipeline > headcount) still fills the bar exactly once instead of
  // overflowing. The `pct` labels stay against the headcount, reported honestly even when > 100.
  const barBase = Math.max(total, inPipeline);
  const stage = (count: number): ProfilingStage => ({
    count,
    pct: roundPct(count, total),
    fraction: barBase > 0 ? count / barBase : 0,
  });
  const toAttestN = Math.max(0, total - attestedN);
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
    encoded: stage(encodedN),
    validated: stage(validatedN),
    attested: stage(attestedN),
    notEncoded: stage(notEncodedN),
    toAttest: {
      count: toAttestN,
      pct: total <= 0 ? null : Math.min(100, Math.round((100 * toAttestN) / total)),
    },
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
