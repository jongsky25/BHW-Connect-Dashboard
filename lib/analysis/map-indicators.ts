/**
 * Presentation metadata for the Explore map indicator switcher (E1.1). Kept in a
 * client-safe module (no `server-only` import) so both the server page (caption/
 * value resolution) and the client figure (switcher, headline, legend) read the
 * same labels, units, and denominators. Every field here is a plain string so it
 * crosses the server → client component boundary; formatting is a pure function.
 */
import {
  DEFAULT_MAP_INDICATOR,
  MAP_BASE_INDICATORS,
  mapIndicatorTopicSlug,
  type MapBaseIndicator,
  type MapIndicator,
} from "@/lib/filters/schema";

export type MapIndicatorMeta = {
  /** Switcher option + headline label ("% accredited"). */
  label: string;
  /** Headline noun phrase: "{Top child} has the highest {phrase}, at {value}". */
  headlinePhrase: string;
  /** Ranked-list chart x-axis label. */
  axisLabel: string;
  /** Suffix appended to formatted values ("%" or ""). */
  suffix: string;
  /** Denominator clause appended to the figure caption. */
  denominator: string;
};

/** Sentinel option value for "Training coverage" in the indicator `<select>`. */
export const TRAINING_OPTION = "training" as const;

export const MAP_BASE_INDICATOR_META: Record<MapBaseIndicator, MapIndicatorMeta> = {
  pct_accredited: {
    label: "% accredited",
    headlinePhrase: "accreditation rate",
    axisLabel: "% accredited",
    suffix: "%",
    denominator: "share of validated profiles that are accredited",
  },
  any_honorarium_pct: {
    label: "Any-honorarium %",
    headlinePhrase: "share receiving any honorarium",
    axisLabel: "% receiving any honorarium",
    suffix: "%",
    denominator: "share of validated profiles receiving any honorarium",
  },
  households_per_bhw: {
    label: "Households per BHW",
    headlinePhrase: "household load per BHW",
    axisLabel: "Households per BHW",
    suffix: "",
    denominator: "households ÷ total BHWs, from the StepZero quick-count",
  },
  avg_active_years: {
    label: "Avg years of service",
    headlinePhrase: "average years of service",
    axisLabel: "Avg years of service",
    suffix: "",
    denominator: "mean recorded active-service years across validated profiles",
  },
  coverage_pct: {
    label: "Profile coverage %",
    headlinePhrase: "profile coverage",
    axisLabel: "% of registered profiled",
    suffix: "%",
    denominator: "validated profiles as a share of the StepZero registered universe",
  },
};

/** Ordered base-indicator options for the switcher. */
export const MAP_BASE_INDICATOR_OPTIONS: Array<{ value: MapBaseIndicator; label: string }> =
  MAP_BASE_INDICATORS.map((value) => ({ value, label: MAP_BASE_INDICATOR_META[value].label }));

/** Presentation metadata for a training-coverage indicator on a given topic. */
export function trainingIndicatorMeta(topicLabel: string): MapIndicatorMeta {
  return {
    label: `Training: ${topicLabel}`,
    headlinePhrase: `training coverage in ${topicLabel}`,
    axisLabel: "% trained",
    suffix: "%",
    denominator: `share of validated profiles trained in ${topicLabel}`,
  };
}

/**
 * Resolve presentation metadata for any indicator. For a `training:` indicator,
 * `topicLabel` supplies the human topic name (fall back to the slug if unknown).
 */
export function metaForIndicator(
  indicator: MapIndicator,
  topicLabel?: string | null,
): MapIndicatorMeta {
  const slug = mapIndicatorTopicSlug(indicator);
  if (slug !== null) return trainingIndicatorMeta(topicLabel ?? slug);
  const base = (MAP_BASE_INDICATOR_META as Record<string, MapIndicatorMeta>)[indicator];
  return base ?? MAP_BASE_INDICATOR_META[DEFAULT_MAP_INDICATOR];
}

/**
 * Format one indicator value for display: integers as-is (thousands-separated),
 * non-integers to one decimal. Deliberately identical to the map tooltip
 * (`choropleth-map.tsx` `formatValue`) and legend (`map-legend.tsx` `formatEdge`)
 * so every rendering of the same value — map, legend, headline, mini-card,
 * distribution marker, and the summary strip (which imports this) — shows the
 * same number at the same precision.
 */
export function formatIndicatorValue(value: number, suffix: string): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString()}${suffix}`;
}
