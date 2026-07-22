import { formatCount } from "@/lib/format";
import type { ProfilingStatusChild } from "@/lib/db/profiling-status";

/**
 * A small caption of coverage and data-quality signals for the child areas the page loaded: how
 * many are reporting, how many have certified no one yet, and how many have encoded *more* records
 * than their headcount denominator. That last case is the known >100% artefact — the encoding
 * snapshot and the headcount are two independently collected figures — surfaced here honestly
 * rather than silently hidden by `pctCapped`. A server component; renders nothing without children.
 */
export function CoverageFlags({ items }: { items: ProfilingStatusChild[] }) {
  if (items.length === 0) return null;

  const reporting = items.length;
  const zeroCertified = items.filter((c) => c.certify.count === 0).length;
  const overshoot = items.filter((c) => c.totalBhw > 0 && c.encode.count > c.totalBhw);

  return (
    <section aria-label="Coverage and data quality" className="text-xs text-muted">
      <p>
        <span className="font-medium text-foreground">{formatCount(reporting)}</span> area
        {reporting === 1 ? "" : "s"} reporting
        {zeroCertified > 0 && (
          <>
            {" · "}
            <span className="font-medium text-foreground">{formatCount(zeroCertified)}</span> with no
            certifications yet
          </>
        )}
        .
      </p>
      {overshoot.length > 0 && (
        <p className="mt-1">
          Encoded records exceed the headcount in {overshoot.map((c) => c.geoName).join(", ")} — the
          encoding snapshot and the headcount are collected separately, so progress there is shown
          capped at 100%.
        </p>
      )}
    </section>
  );
}
