import { BenchmarkBars, type BenchmarkRow } from "@/components/place/benchmark";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import {
  COMPARE_METRICS,
  leaderIndex,
  type CompareMetricValues,
} from "@/lib/analysis/compare-metrics";
import { formatIndicatorValue } from "@/lib/analysis/map-indicators";
import { MIN_LEADER_N } from "@/lib/analysis/thresholds";

export type CompareSummaryPlace = {
  geoCode: string;
  geoName: string;
  /** Validated-profile count — the small-N basis (E0.5). */
  nTotal: number | null;
  values: CompareMetricValues;
};

/** Join names into an English list: "A", "A and B", "A, B, and C". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Head-to-head strip: every comparative headline metric once, with all compared
 * places on one bar track per metric and the leading place named in words —
 * answering "who leads on what?" before the reader scrolls into the per-place
 * figure columns. The same pattern as Explore's summary strip + BenchmarkBars,
 * pointed across the compared set instead of up the geo hierarchy; the muted
 * reference row keeps the national context every other page shows.
 */
export function CompareSummary({
  places,
  reference,
  caption,
}: {
  places: CompareSummaryPlace[];
  /** Muted context row (the Philippines) — null when comparing at national level. */
  reference: { label: string; values: CompareMetricValues } | null;
  caption: string;
}) {
  const blocks = COMPARE_METRICS.map((metric) => {
    const values = places.map((p) => p.values[metric.key]);
    return {
      metric,
      values,
      usable: values.filter((v) => v !== null).length,
      leader: leaderIndex(values),
    };
  });
  const shown = blocks.filter((b) => b.usable >= 2);
  const omitted = blocks.filter((b) => b.usable < 2);
  const smallN = places.filter((p) => p.nTotal !== null && p.nTotal < MIN_LEADER_N);

  if (shown.length === 0) return null;

  return (
    <section
      aria-labelledby="compare-summary-heading"
      className="rounded-lg border border-border bg-surface px-4 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="compare-summary-heading" className="text-lg font-semibold tracking-tight">
          Head to head
        </h2>
        <p className="text-xs text-muted">{caption}</p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map(({ metric, values, leader }) => (
          <div key={metric.key}>
            <p className="mb-1.5 text-xs font-medium">
              {metric.glossarySlug ? (
                <GlossaryTerm slug={metric.glossarySlug}>{metric.label}</GlossaryTerm>
              ) : (
                metric.label
              )}
            </p>
            <BenchmarkBars
              flush
              rows={[
                ...places.map(
                  (place, i): BenchmarkRow => ({
                    label: place.geoName,
                    value: values[i],
                    isPrimary: i === leader,
                  }),
                ),
                ...(reference
                  ? [{ label: reference.label, value: reference.values[metric.key] }]
                  : []),
              ]}
              format={metric.format}
              unitSuffix={metric.unitSuffix}
            />
            {leader !== null && (
              <p className="mt-1 text-xs text-muted">
                {metric.leaderLabel}:{" "}
                <span className="font-medium text-foreground">{places[leader].geoName}</span> (
                {formatIndicatorValue(values[leader] as number, metric.suffix)})
              </p>
            )}
          </div>
        ))}
      </div>

      {(smallN.length > 0 || omitted.length > 0) && (
        <div className="mt-4 space-y-1 border-t border-border pt-2 text-xs text-muted">
          {smallN.length > 0 && (
            <p>
              Small sample: {nameList(smallN.map((p) => p.geoName))}{" "}
              {smallN.length === 1 ? "has" : "have"} fewer than {MIN_LEADER_N} validated profiles,
              so {smallN.length === 1 ? "its" : "their"} rates can swing widely — read with care.
            </p>
          )}
          {omitted.length > 0 && (
            <p>
              Not enough data to compare {nameList(omitted.map((b) => b.metric.label))} across
              these places.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
