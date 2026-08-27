import { formatCount } from "@/lib/format";
import type { UucPhcBin, UucPhcIndicatorDist } from "@/lib/db/uuc-phc-indicator-dist";

/**
 * One indicator's distribution across an area's listed barangays (plan U9).
 *
 * **This chart exists because a mean would have been wrong and silence was too strict.** U3
 * published no indicator aggregates: 1,584 values were bounded during cleaning, and a † marker that
 * travels with one rendered value cannot survive an average. But the rule was *mark the value,
 * never average it* — and a histogram does not average anything. Every value stays at its own
 * position, and the bounded ones pile up in the top bin, where the hatched segment below draws them
 * as the artefact they are. That pile-up is the single most important thing this dataset has to say
 * about itself, and a mean is precisely the rendering that hides it.
 *
 * A server component: static bars over numbers already fetched, no client JavaScript, and the bin
 * counts are in the markup rather than in a canvas, so they are readable and quotable.
 */

/** One decimal at most, and no trailing ".0" — matching `BarangayDetail`'s rule, and for the same
 * reason: the source's precision runs from whole numbers to three decimals, and printing all of it
 * would imply an accuracy it does not have. */
function num(n: number | null): string {
  if (n === null) return "—";
  return (Math.round(n * 10) / 10).toLocaleString();
}

/** A bin's own range, in the indicator's units — "90–100%" or "900–1,000". */
function binRange(bin: UucPhcBin, unit: string): string {
  const suffix = unit === "%" ? "%" : "";
  return `${formatCount(bin.lo)}–${formatCount(bin.hi)}${suffix}`;
}

/** The hatch that marks bounded values, as one shared style so the bar and its legend swatch
 * cannot drift apart. Stripes rather than a second colour: a different colour reads as a different
 * *category* of barangay, and these are the same barangays with an unusable number. */
const CAPPED_HATCH = {
  backgroundImage:
    "repeating-linear-gradient(45deg, var(--accent) 0 3px, var(--background) 3px 6px)",
} as const;

function Bars({ dist }: { dist: UucPhcIndicatorDist }) {
  const { meta, bins, refFraction, provincialRef } = dist;

  return (
    <div>
      {/* The plot. Columns tile the axis exactly — the visual gap is inner padding, not a flex
          gap — so the benchmark line's left offset is the true position of its value. */}
      <div className="relative flex h-32 items-end" role="presentation">
        {bins.map((bin) => (
          <div key={bin.index} className="flex h-full flex-1 flex-col justify-end px-[1.5px]">
            <div
              className="w-full rounded-t-sm bg-accent"
              style={{
                height: `${bin.fraction * 100}%`,
                // A bin with a handful of barangays in a distribution of thousands rounds to
                // nothing. Its count is printed either way, but a bar that vanishes reads as an
                // empty bin, which is a different statement.
                minHeight: bin.count > 0 ? "2px" : undefined,
              }}
            >
              {bin.capped > 0 && bin.count > 0 && (
                <div
                  className="w-full rounded-t-sm"
                  style={{ ...CAPPED_HATCH, height: `${(bin.capped / bin.count) * 100}%` }}
                />
              )}
            </div>
          </div>
        ))}

        {refFraction !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-foreground"
            style={{ left: `${refFraction * 100}%` }}
          >
            {/* Flipped to the left of the line once the benchmark is past three-quarters of the
                axis, which is where most coverage benchmarks sit — the label would otherwise run
                off the chart. */}
            <span
              className={`absolute -top-1 whitespace-nowrap text-[10px] font-medium text-foreground ${
                refFraction > 0.75 ? "right-1" : "left-1"
              }`}
            >
              province {num(provincialRef)}
              {meta.unit === "%" ? "%" : ""}
            </span>
          </div>
        )}
      </div>

      {/* The axis. Three labels rather than ten: the bins are equal width, so the ends and the
          midpoint fix every boundary, and ten labels at this size overlap. */}
      <div className="mt-1 flex justify-between border-t border-border pt-1 text-[10px] text-muted">
        <span>0</span>
        <span>
          {formatCount(meta.max / 2)}
          {meta.unit === "%" ? "%" : ""}
        </span>
        <span>
          {formatCount(meta.max)}
          {meta.unit === "%" ? "%" : ""}
        </span>
      </div>

      {/* The counts themselves, in the markup. Visually hidden because ten labels do not fit, but
          present for a screen reader and for anyone reading the page's source rather than its
          picture — the numbers are the finding, the bars are the summary of them. */}
      <ul className="sr-only">
        {bins.map((bin) => (
          <li key={bin.index}>
            {binRange(bin, meta.unit)}
            {bin.inclusive ? " (inclusive)" : ""}: {formatCount(bin.count)} barangay
            {bin.count === 1 ? "" : "s"}
            {bin.capped > 0
              ? `, of which ${formatCount(bin.capped)} ${
                  bin.capped === 1 ? "is a bounded value" : "are bounded values"
                }`
              : ""}
            .
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The top bin's caveat, drawn only where there is one to make. */
function CappedNote({ dist }: { dist: UucPhcIndicatorDist }) {
  const top = dist.bins[dist.bins.length - 1];
  if (!top || top.capped <= 0) return null;

  return (
    <p className="mt-3 flex items-start gap-2 rounded-md bg-surface px-3 py-2 text-xs text-muted">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
        style={CAPPED_HATCH}
      />
      <span>
        The top bar ({binRange(top, dist.meta.unit)}) holds {formatCount(top.count)} barangay
        {top.count === 1 ? "" : "s"}, and <strong>{formatCount(top.capped)}</strong>{" "}
        {top.capped === 1 ? "of them is a value" : "of them are values"} the source recorded above{" "}
        {formatCount(dist.meta.max)}
        {dist.meta.unit === "%" ? "%" : ""} and cleaning bounded to it.{" "}
        {top.capped === 1 ? "Its true figure is" : "Their true figures are"} not known. Read the
        hatched part of that bar as a ceiling the source overshot, not as{" "}
        {dist.meta.unit === "%" ? "full coverage" : "a measured rate"}.
      </span>
    </p>
  );
}

/** Where the benchmark line is not drawn, why — five different statements, and the two that are
 * data-quality findings are the reason they are not collapsed into one. */
function BenchmarkNote({ dist, areaLabel }: { dist: UucPhcIndicatorDist; areaLabel: string }) {
  if (dist.benchmark === "drawn" || dist.benchmark === "none" || dist.benchmark === "aggregate") {
    // "aggregate" is said once for the whole group by IndicatorsSection, not twelve times here.
    return null;
  }

  const why =
    dist.benchmark === "unreachable" ? (
      <>
        the province&rsquo;s own figure reads {num(dist.provincialRef)}
        {dist.meta.unit === "%" ? "%" : ""}, above the {formatCount(dist.meta.max)}
        {dist.meta.unit === "%" ? "%" : ""} ceiling every barangay value here was bounded to. No
        barangay could reach it, so every one of them would read as worse than its province by
        construction — an artefact of the cleaning, not a finding about {areaLabel}.
      </>
    ) : dist.benchmark === "placeholder" ? (
      <>
        the province supplied a benchmark set that cannot carry the comparison — placeholder values,
        zeroes, or fractions where percentages were wanted.
      </>
    ) : (
      <>the province supplied no benchmark at all.</>
    );

  return <p className="mt-2 text-xs text-muted">No provincial line: {why}</p>;
}

/** Criterion (d)'s count, and the barangays it could not be run for. A count, never a share. */
function ComparisonNote({ dist, areaLabel }: { dist: UucPhcIndicatorDist; areaLabel: string }) {
  if (dist.meta.higherIsWorse === null || dist.nListed === 0) return null;

  if (dist.nComparable === 0) {
    return (
      <p className="mt-2 text-xs text-muted">
        Criterion (d) cannot be evaluated here on this indicator for any of {areaLabel}&rsquo;s{" "}
        {formatCount(dist.nListed)} listed barangay{dist.nListed === 1 ? "" : "s"}.
      </p>
    );
  }

  return (
    <p className="mt-2 text-xs text-muted">
      <strong className="font-medium text-foreground">{formatCount(dist.nWorse)}</strong> of the{" "}
      {formatCount(dist.nComparable)} barangay{dist.nComparable === 1 ? "" : "s"} this comparison
      can be made for {dist.nWorse === 1 ? "is" : "are"} worse than{" "}
      {dist.nComparable === 1 ? "its" : "their"} province on this indicator
      {dist.nNotComparable > 0 && (
        <>
          {" "}
          — {formatCount(dist.nNotComparable)} more {dist.nNotComparable === 1 ? "is" : "are"}{" "}
          excluded, because the provincial figures behind{" "}
          {dist.nNotComparable === 1 ? "it" : "them"} cannot support the comparison
        </>
      )}
      .
    </p>
  );
}

export function IndicatorHistogram({
  dist,
  areaLabel,
}: {
  dist: UucPhcIndicatorDist;
  areaLabel: string;
}) {
  return (
    <section className="border-b border-border py-5 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-medium">
          {dist.meta.label} <span className="text-muted">({dist.meta.unit})</span>
        </h3>
        <p className="text-xs text-muted tabular-nums">
          {formatCount(dist.nListed)} listed barangay{dist.nListed === 1 ? "" : "s"}
          {dist.nMissing > 0 && <> · {formatCount(dist.nMissing)} with no value recorded</>}
        </p>
      </div>

      <div className="mt-3">
        <Bars dist={dist} />
      </div>

      <p className="mt-3 text-xs text-muted">{dist.meta.note}</p>

      <CappedNote dist={dist} />
      <BenchmarkNote dist={dist} areaLabel={areaLabel} />
      <ComparisonNote dist={dist} areaLabel={areaLabel} />
    </section>
  );
}
