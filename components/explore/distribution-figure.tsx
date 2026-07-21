import { FigureCard } from "@/components/narrative/figure-card";
import { MIN_LEADER_N } from "@/lib/analysis/thresholds";
import { formatIndicatorValue, type MapIndicatorMeta } from "@/lib/analysis/map-indicators";
import type { ChildIndicator } from "@/components/explore/geo-comparison-figure";

/** Linear-interpolated quantile over an ascending-sorted array. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Distribution ("spread among children") view for the active map indicator
 * (E1.3). A pure server-rendered dot-strip — no client JS, keeping the page's
 * chart/map budget lazy — in the same honest-comparator idiom as the home
 * `DotStrip` (a spread of real observed values, not a gauge against an invented
 * target). Each child geo is a dot positioned by its value; the interquartile
 * range is shaded, the median marked, and the parent geo's own value called out
 * so a reader can see whether their province's rate is typical or an outlier.
 *
 * Reuses exactly the data the map figure already fetched (`items`) — no new
 * query. Small-N children (`nTotal < MIN_LEADER_N`) render as hollow dots,
 * consistent with the map's E0.5 signaling.
 */
export function DistributionFigure({
  items,
  parentValue,
  parentName,
  childLevelLabel,
  childLevelLabelPlural,
  meta,
  caption,
}: {
  items: ChildIndicator[];
  /** The parent geo's own value for this indicator (matches the summary strip). */
  parentValue: number | null;
  parentName: string;
  childLevelLabel: string;
  childLevelLabelPlural: string;
  meta: MapIndicatorMeta;
  caption: string;
}) {
  const suffix = meta.suffix;
  const fmt = (v: number) => formatIndicatorValue(v, suffix);
  const childLabel = childLevelLabel.toLowerCase();
  const childPlural = childLevelLabelPlural.toLowerCase();

  const withData = items.filter((c): c is ChildIndicator & { value: number } => c.value !== null);
  const values = withData.map((c) => c.value).sort((a, b) => a - b);

  const title = `Spread of ${meta.label.toLowerCase()} across ${childPlural}`;

  if (withData.length === 0) {
    return (
      <FigureCard
        title={title}
        caption={caption}
        headline={`No ${childLabel} has data for this indicator yet.`}
        technicalDetails={<p>Every {childLabel} here is missing a value for this indicator.</p>}
      >
        <p className="text-sm text-muted">No data available.</p>
      </FigureCard>
    );
  }

  const p25 = quantile(values, 0.25);
  const median = quantile(values, 0.5);
  const p75 = quantile(values, 0.75);
  const iqr = p75 - p25;

  // Tukey outlier among the children (only when there's a real spread to be
  // unusual against): the child furthest beyond the 1.5·IQR fences.
  let outlier: (ChildIndicator & { value: number }) | null = null;
  if (iqr > 0 && withData.length >= 4) {
    const lowFence = p25 - 1.5 * iqr;
    const highFence = p75 + 1.5 * iqr;
    let bestDist = 0;
    for (const c of withData) {
      const dist = c.value > highFence ? c.value - highFence : c.value < lowFence ? lowFence - c.value : 0;
      if (dist > bestDist) {
        bestDist = dist;
        outlier = c;
      }
    }
  }

  // Domain spans the observed children and the parent marker, lightly padded so
  // the extreme dots aren't clipped at the track edges.
  const lo = Math.min(values[0], parentValue ?? values[0]);
  const hi = Math.max(values[values.length - 1], parentValue ?? values[values.length - 1]);
  const span = hi - lo;
  const pad = span > 0 ? span * 0.06 : Math.max(1, Math.abs(hi) * 0.06);
  const domainLo = lo - pad;
  const domainHi = hi + pad;
  const pct = (v: number) => {
    const d = domainHi - domainLo;
    return d > 0 ? ((v - domainLo) / d) * 100 : 50;
  };

  const hasSmallN = withData.some((c) => c.nTotal !== null && c.nTotal < MIN_LEADER_N);

  const headline =
    withData.length < 2
      ? `Only one ${childLabel} (${withData[0].geoName}) has data for this indicator.`
      : outlier
        ? `Most ${childPlural} fall between ${fmt(p25)} and ${fmt(p75)}; ${outlier.geoName} stands out at ${fmt(outlier.value)}.`
        : `Most ${childPlural} fall between ${fmt(p25)} and ${fmt(p75)}.`;

  const ariaLabel =
    `Distribution of ${meta.label.toLowerCase()} across ${withData.length} ${childPlural}: ` +
    `lowest ${fmt(values[0])}, 25th percentile ${fmt(p25)}, median ${fmt(median)}, ` +
    `75th percentile ${fmt(p75)}, highest ${fmt(values[values.length - 1])}` +
    (parentValue !== null ? `. ${parentName} overall is ${fmt(parentValue)}.` : ".");

  return (
    <FigureCard
      title={title}
      caption={caption}
      headline={headline}
      technicalDetails={
        <p>
          Across {withData.length} {withData.length === 1 ? childLabel : childPlural}: lowest{" "}
          {fmt(values[0])}, median {fmt(median)}, highest {fmt(values[values.length - 1])} (middle
          half {fmt(p25)}–{fmt(p75)}).
          {parentValue !== null ? ` ${parentName} overall: ${fmt(parentValue)}.` : ""} Hollow dots
          mark {childPlural} with fewer than {MIN_LEADER_N} profiled BHWs, whose value is unstable.
        </p>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="img" aria-label={ariaLabel}>
          <div className="relative h-12">
            {/* Interquartile band (middle half of the children). */}
            {withData.length >= 2 && (
              <div
                className="absolute top-1/2 h-7 -translate-y-1/2 rounded-sm"
                style={{
                  left: `${pct(p25)}%`,
                  width: `${Math.max(0, pct(p75) - pct(p25))}%`,
                  backgroundColor: "var(--seq-2)",
                }}
                aria-hidden="true"
              />
            )}
            {/* Baseline. */}
            <div className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
            {/* Median tick. */}
            {withData.length >= 2 && (
              <div
                className="absolute top-1/2 h-7 w-px -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pct(median)}%`, backgroundColor: "var(--seq-5)" }}
                aria-hidden="true"
              />
            )}
            {/* Child dots. */}
            {withData.map((c) => {
              const smallN = c.nTotal !== null && c.nTotal < MIN_LEADER_N;
              return (
                <span
                  key={c.geoCode}
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                  style={{
                    left: `${pct(c.value)}%`,
                    backgroundColor: smallN ? "transparent" : "var(--seq-4)",
                    borderColor: smallN ? "var(--muted)" : "var(--seq-5)",
                    opacity: smallN ? 0.7 : 0.75,
                  }}
                  aria-hidden="true"
                />
              );
            })}
            {/* Parent marker. */}
            {parentValue !== null && (
              <div
                className="absolute top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${pct(parentValue)}%`, backgroundColor: "var(--accent)" }}
                aria-hidden="true"
              />
            )}
          </div>
          <div
            className="mt-1 flex justify-between text-[0.65rem] text-muted"
            aria-hidden="true"
          >
            <span>{fmt(values[0])}</span>
            <span>{fmt(values[values.length - 1])}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {parentValue !== null && (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-0.5 rounded-full"
                style={{ backgroundColor: "var(--accent)" }}
              />
              {parentName} overall: {fmt(parentValue)}
            </span>
          )}
          {hasSmallN && (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full border border-muted"
              />
              Fewer than {MIN_LEADER_N} profiled
            </span>
          )}
        </div>
      </div>
    </FigureCard>
  );
}
