import { FigureCard } from "@/components/narrative/figure-card";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import { FigureBenchmark, type FigureBenchmarkProps } from "@/components/narrative/figure-benchmark";
import { formatIndicatorValue } from "@/lib/analysis/map-indicators";

/**
 * Accreditation, triangulated across the two datasets (E2.1 / review R8.2).
 * `agg_bhw_stepzero_counts.pct_registered_accredited` — the LGU quick-count's
 * own accreditation share of the *whole* BHW universe — was computed but never
 * shown; here it sits beside the verified per-person rate
 * (`agg_bhw_counts.pct_accredited`, among validated profiles). They use
 * different sources and denominators, so the figure presents them side by side
 * and never averages them — a gap between the two is a data-quality signal, not
 * an error. Renders only when the quick-count figure exists for this geo.
 */
export function AccreditationSourcesFigure({
  lguReported,
  verified,
  verifiedCi,
  caption,
  benchmark,
}: {
  lguReported: number | null;
  verified: number | null;
  /** Wilson 95% interval (percentage points) around the verified rate (E2.2). */
  verifiedCi?: { low: number | null; high: number | null } | null;
  caption: string;
  benchmark?: FigureBenchmarkProps;
}) {
  if (lguReported === null) return null;

  const ciText =
    verifiedCi && verifiedCi.low !== null && verifiedCi.high !== null
      ? `${formatIndicatorValue(verifiedCi.low, "%")}–${formatIndicatorValue(verifiedCi.high, "%")}`
      : null;

  const gap =
    verified !== null ? Math.round(Math.abs(verified - lguReported) * 10) / 10 : null;

  const headline =
    verified === null
      ? `The quick-count reports ${formatIndicatorValue(lguReported, "%")} of all BHWs here as accredited.`
      : gap !== null && gap >= 5
        ? `The two sources disagree by about ${formatIndicatorValue(gap, "")} points — worth a closer look.`
        : `The two sources roughly agree on accreditation here.`;

  return (
    <FigureCard
      title="Accreditation: two sources"
      caption={caption}
      headline={headline}
      technicalDetails={
        <p>
          Two independently collected measures, shown side by side and never averaged.{" "}
          <GlossaryTerm slug="lgu_reported_accreditation">LGU-reported accreditation</GlossaryTerm>{" "}
          is the StepZero quick-count&apos;s accredited share of the whole BHW universe; the verified
          rate counts only <GlossaryTerm slug="accredited">accredited</GlossaryTerm> individually
          validated profiles. A gap between them reflects the two sources&apos; different coverage,
          not an error — see{" "}
          <a href="/data-quality" className="underline hover:text-accent">
            data quality
          </a>
          .
        </p>
      }
      benchmark={benchmark ? <FigureBenchmark {...benchmark} /> : undefined}
    >
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-surface/40 p-3">
          <dt className="text-xs text-muted">Quick-count (all BHWs)</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight">
            {formatIndicatorValue(lguReported, "%")}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface/40 p-3">
          <dt className="text-xs text-muted">Verified (validated profiles)</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight">
            {verified !== null ? formatIndicatorValue(verified, "%") : "—"}
          </dd>
          {ciText && (
            <dd className="mt-0.5 text-xs text-muted">
              95% <GlossaryTerm slug="confidence_interval">CI</GlossaryTerm> {ciText}
            </dd>
          )}
        </div>
      </dl>
    </FigureCard>
  );
}
