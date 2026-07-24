import { formatCount } from "@/lib/format";
import type { ProfilingStatusChild } from "@/lib/db/profiling-status";

/**
 * A small caption of coverage and data-quality signals for the child areas the page loaded: how
 * many are reporting, how many have attested no one yet, and how many have encoded *more* records
 * than their headcount denominator. That last case is the known >100% artefact — the encoding
 * snapshot and the headcount are two independently collected figures — surfaced here honestly
 * rather than silently hidden. A server component; renders nothing without children.
 */
export function CoverageFlags({ items }: { items: ProfilingStatusChild[] }) {
  if (items.length === 0) return null;

  const reporting = items.length;
  const zeroAttested = items.filter((c) => c.attested.count === 0).length;
  const inPipeline = (c: ProfilingStatusChild) =>
    c.nDrafted + c.nForValidation + c.nBackToEncoder + c.nValidated + c.nApproved;
  const overshoot = items.filter((c) => c.totalBhw > 0 && inPipeline(c) > c.totalBhw);

  return (
    <section aria-label="Coverage and data quality" className="text-xs text-muted">
      <p>
        <span className="font-medium text-foreground">{formatCount(reporting)}</span> area
        {reporting === 1 ? "" : "s"} reporting
        {zeroAttested > 0 && (
          <>
            {" · "}
            <span className="font-medium text-foreground">{formatCount(zeroAttested)}</span> with
            none attested yet
          </>
        )}
        .
      </p>
      {overshoot.length > 0 && (
        <p className="mt-1">
          Encoded records exceed the headcount in {overshoot.map((c) => c.geoName).join(", ")} — the
          encoding snapshot and the headcount are collected separately, so the stage shares there can
          add up to more than 100%.
        </p>
      )}
    </section>
  );
}
