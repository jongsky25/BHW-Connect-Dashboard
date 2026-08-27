import type { IndicatorReading, UucPhcBarangayDetail } from "@/lib/db/uuc-phc-indicators";

/** One decimal at most, and no trailing ".0" — the source's precision varies from whole numbers
 * to three decimals, and rendering all of it would imply accuracy it does not have. */
function num(n: number | null): string {
  if (n === null) return "—";
  return (Math.round(n * 10) / 10).toLocaleString();
}

function ComparisonNote({ reading }: { reading: IndicatorReading }) {
  if (reading.benchmarkPlaceholder) {
    // The province's whole benchmark set is a placeholder — every value 1, or 0, or a fraction.
    // The figure is a number and would compare, which is exactly why it must not be drawn as a
    // verdict: criterion (d) is not evaluable for this barangay at all, and the criteria page has
    // already excluded it from route (d)'s denominator on the same rule.
    return <span className="text-muted">no usable provincial figure</span>;
  }
  if (reading.benchmarkUnusable) {
    // The province's figure is above this indicator's own maximum, so no barangay could match it.
    // Saying "worse than province" here would be an artefact of the source, not a finding.
    return (
      <span className="text-muted">
        not comparable — province reads {num(reading.provincialRef)}
      </span>
    );
  }
  if (reading.worseThanProvince === null) {
    return <span className="text-muted">no provincial figure</span>;
  }
  if (reading.worseThanProvince) {
    return (
      <span className="font-medium text-foreground">
        worse than province ({num(reading.provincialRef)})
      </span>
    );
  }
  return <span className="text-muted">province {num(reading.provincialRef)}</span>;
}

/**
 * One listed barangay: why it qualified, and the values behind it.
 *
 * Collapsed by default via a native `<details>` — a town can have dozens of listed barangays, and
 * seven indicators each would bury the list itself. No client JavaScript is involved.
 *
 * **Capped values are marked wherever they appear.** A bounded value is a ceiling the source
 * overshot, not a measurement, and 886 Water and 456 FIC values now read as exactly 100% because
 * of it. Marking them is what makes these columns publishable at all.
 */
export function BarangayDetail({ detail }: { detail: UucPhcBarangayDetail }) {
  const metFactors = detail.factors.filter((f) => f.met);

  return (
    <details className="group border-b border-border last:border-0">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm hover:text-accent">
        <span className="font-medium">{detail.geoName}</span>
        <span className="text-muted">
          {detail.physicalFactor === null
            ? "on the list"
            : `${num(detail.physicalFactor)}% of puroks over an hour from care`}
        </span>
        {metFactors.map((f) => (
          <span
            key={f.key}
            className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent"
          >
            {f.label}
          </span>
        ))}
        {detail.elcac && (
          <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
            Conflict-affected area
          </span>
        )}
      </summary>

      <div className="pb-5 pl-1">
        {/* Qualifying factors — the socio-economic test, with the measured value against its
            threshold so a reader can see how close a barangay is either way. */}
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
          Socio-economic factors
        </h4>
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {detail.factors.map((f) => (
            <div key={f.key} className="flex items-baseline gap-2">
              <dt className="text-muted">{f.label}</dt>
              <dd className="tabular-nums">
                <span className={f.met ? "font-semibold" : ""}>{num(f.value)}%</span>{" "}
                <span className="text-xs text-muted">of {f.threshold}% needed</span>
              </dd>
            </div>
          ))}
        </dl>

        <h4 className="mt-5 text-xs font-medium uppercase tracking-wide text-muted">
          Health indicators
        </h4>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Indicator
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                  Barangay
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Against its province
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.health.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-3">
                    {r.label} <span className="text-xs text-muted">({r.unit})</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {num(r.value)}
                    {r.capped && (
                      <>
                        <span aria-hidden="true" className="text-muted">
                          †
                        </span>
                        <span className="sr-only"> (bounded during cleaning)</span>
                      </>
                    )}
                  </td>
                  <td className="py-1.5 text-xs">
                    <ComparisonNote reading={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {detail.benchmarksPlaceholder && (
          <p className="mt-3 text-xs text-muted">
            None of the seven comparisons is drawn here: this barangay&rsquo;s province supplied
            benchmarks that cannot support them — every value a placeholder, a zero, or a fraction
            where a percentage was wanted. Its place on the list is not in doubt; the socio-economic
            test passes on any one of four routes.
          </p>
        )}

        {detail.cappedCount > 0 && (
          <p className="mt-3 text-xs text-muted">
            † {detail.cappedCount} value{detail.cappedCount === 1 ? " was" : "s were"} recorded
            above the maximum this indicator can take and{" "}
            {detail.cappedCount === 1 ? "was" : "were"} bounded to it. The true figure is not known
            — read a marked value as a ceiling, not a measurement.
          </p>
        )}
      </div>
    </details>
  );
}
