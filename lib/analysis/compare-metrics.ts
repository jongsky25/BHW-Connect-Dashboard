/**
 * Head-to-head metric set for the Compare page's summary strip. Client-safe (no
 * `server-only` import) and built on the same `MAP_BASE_INDICATOR_META` the
 * Explore switcher reads, so labels, suffixes, and denominators stay identical
 * across pages — a value never renders under a different name on Compare than
 * it does on Explore.
 */
import { MAP_BASE_INDICATOR_META } from "@/lib/analysis/map-indicators";
import type { MapBaseIndicator } from "@/lib/filters/schema";
import type { ValueFormatKind } from "@/lib/format";
import type { GlossaryTermSlug } from "@/lib/glossary/terms";

export type CompareMetricDef = {
  key: MapBaseIndicator;
  label: string;
  /** Value suffix ("%" or "") — same string every other figure appends. */
  suffix: string;
  format: ValueFormatKind;
  /** Optional unit shown after BenchmarkBars values, e.g. "yrs". */
  unitSuffix?: string;
  glossarySlug?: GlossaryTermSlug;
  /** Lead-in for the per-metric leader line, e.g. "Highest: Cebu (82%)".
   * Deliberately not "best" — a heavier household load or denser coverage is a
   * fact about the place, not a ranking of merit. */
  leaderLabel: string;
};

const METRIC_EXTRAS: Array<Omit<CompareMetricDef, "label" | "suffix">> = [
  { key: "pct_accredited", format: "percent", glossarySlug: "accredited", leaderLabel: "Highest" },
  { key: "any_honorarium_pct", format: "percent", glossarySlug: "honorarium", leaderLabel: "Highest" },
  {
    key: "avg_active_years",
    format: "count",
    unitSuffix: "yrs",
    glossarySlug: "active_years",
    leaderLabel: "Longest-serving",
  },
  {
    key: "households_per_bhw",
    format: "count",
    unitSuffix: "hh/BHW",
    glossarySlug: "households_per_bhw",
    leaderLabel: "Heaviest load",
  },
  {
    key: "bhw_per_1000",
    format: "count",
    glossarySlug: "bhw_per_1000",
    leaderLabel: "Densest coverage",
  },
  {
    key: "coverage_pct",
    format: "percent",
    glossarySlug: "profiling_coverage",
    leaderLabel: "Highest",
  },
];

export const COMPARE_METRICS: CompareMetricDef[] = METRIC_EXTRAS.map((extra) => ({
  ...extra,
  label: MAP_BASE_INDICATOR_META[extra.key].label,
  suffix: MAP_BASE_INDICATOR_META[extra.key].suffix,
}));

/** One value per compared place, keyed by base indicator. */
export type CompareMetricValues = Record<MapBaseIndicator, number | null>;

/**
 * Index of the strict maximum among non-null values, or null when there's no
 * honest single leader: fewer than two places carry a value (nothing to lead),
 * or the top value is tied (naming either place would be arbitrary).
 */
export function leaderIndex(values: Array<number | null>): number | null {
  const usable = values
    .map((value, index) => ({ value, index }))
    .filter((v): v is { value: number; index: number } => v.value !== null);
  if (usable.length < 2) return null;

  const max = Math.max(...usable.map((v) => v.value));
  const atMax = usable.filter((v) => v.value === max);
  return atMax.length === 1 ? atMax[0].index : null;
}
