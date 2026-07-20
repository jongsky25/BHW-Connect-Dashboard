import { GlossaryTerm } from "@/components/glossary/glossary-term";
import { formatCount } from "@/lib/format";

/**
 * Explains the two-denominator relationship that otherwise confuses every
 * first-time reader (home-search review P1.10): the headline "Total BHWs" is the
 * DOH StepZero quick-count, while every per-person figure describes the smaller
 * individually-validated subset. Promoted from a tiny footnote into a labelled
 * funnel so the relationship is visible, not buried, and the key terms are
 * wrapped in glossary tooltips. Falls back to a one-line sentence when StepZero
 * data isn't available for the geo.
 */
export function DenominatorExplainer({
  totalBhw,
  registeredUniverse,
  validatedProfiles,
  coveragePct,
}: {
  totalBhw: number | null;
  registeredUniverse: number | null;
  validatedProfiles: number | null;
  coveragePct: number | null;
}) {
  const steps = [
    {
      key: "total",
      value: totalBhw,
      label: <GlossaryTerm slug="total_bhw">Total BHWs</GlossaryTerm>,
      note: "Everyone counted in the DOH StepZero quick-count (registered, accredited, and non-registered).",
    },
    {
      key: "registered",
      value: registeredUniverse,
      label: <GlossaryTerm slug="registered_bhw">Registered</GlossaryTerm>,
      note: "Registered (incl. accredited) BHWs — the base eligible for individual profiling.",
    },
    {
      key: "profiled",
      value: validatedProfiles,
      label: <GlossaryTerm slug="validated_profile">Validated profiles</GlossaryTerm>,
      note: "Individually profiled and validated — the denominator for every per-person figure below.",
    },
  ];

  // Everything scales against the widest stage (the total) so the funnel reads
  // as a shrinking subset.
  const scaleMax = totalBhw ?? registeredUniverse ?? validatedProfiles ?? 0;

  if (scaleMax === 0) {
    return (
      <p className="text-center text-xs text-muted">
        Every per-person figure below describes the individually validated profiles.
      </p>
    );
  }

  return (
    <section
      aria-label="How BHWs are counted"
      className="rounded-lg border border-border bg-surface/40 p-4 sm:p-5"
    >
      <h2 className="text-sm font-semibold tracking-tight">Three ways BHWs are counted here</h2>
      <p className="mt-1 text-xs text-muted">
        The headline total is the quick-count; the per-person figures below use the smaller
        validated subset. This is why two &ldquo;how many BHWs&rdquo; numbers can differ.
      </p>

      <dl className="mt-3 space-y-2.5">
        {steps.map((step) => {
          const width = step.value === null ? 0 : Math.min(100, (step.value / scaleMax) * 100);
          return (
            <div key={step.key} className="grid grid-cols-[8.5rem_1fr] items-center gap-3">
              <dt className="text-xs">
                {step.label}
                {step.key === "profiled" && coveragePct !== null && (
                  <span className="text-muted"> ({coveragePct}%)</span>
                )}
              </dt>
              <dd>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-full bg-surface" aria-hidden="true">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums">
                    {formatCount(step.value)}
                  </span>
                </div>
                <p className="mt-0.5 text-[0.7rem] leading-snug text-muted">{step.note}</p>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
