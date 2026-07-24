import { formatCount } from "@/lib/format";
import type { ProfilingStatus } from "@/lib/db/profiling-status";

/**
 * A drill-down of the headline "Encoded" stage — the records that have been encoded but have not
 * yet passed validation. The four-stage bar above collapses these into one segment; here we split
 * that segment into the states work actually sits in, so a pile-up is visible: drafted (not yet
 * submitted), awaiting validation, or sent back to the encoder for rework. `back_to_encoder` is
 * called out in the warning color — it is the quality signal buried in the "Encoded" bucket.
 *
 * Segments here sum to the Encoded stage's count (not the whole denominator); the four top-level
 * stages already partition all BHWs on the bar above. A server component. Renders nothing when no
 * records are in the encoding stage.
 */
export function BottleneckBars({ status }: { status: ProfilingStatus }) {
  const segments = [
    {
      key: "awaiting-val",
      label: "Awaiting validation",
      value: status.nForValidation,
      color: "var(--seq-2)",
    },
    {
      key: "rework",
      label: "Sent back for rework",
      value: status.nBackToEncoder,
      color: "var(--warning)",
    },
    {
      key: "drafted",
      label: "Drafted, not yet submitted",
      value: status.nDrafted,
      color: "var(--seq-1)",
    },
  ].filter((s) => s.value > 0);

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  const ariaLabel = segments.map((s) => `${s.label} ${formatCount(s.value)}`).join(", ");

  return (
    <section aria-label="Where encoded records sit now">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Where encoded records sit</h2>
        <span className="text-xs text-muted">
          Breakdown of the {formatCount(total)} encoded, not yet validated
        </span>
      </div>

      <div
        role="img"
        aria-label={ariaLabel}
        className="mt-2 flex h-4 w-full overflow-hidden rounded-full border border-border bg-surface"
      >
        {segments.map((s) => (
          <span
            key={s.key}
            title={`${s.label}: ${formatCount(s.value)}`}
            style={{ width: `${(100 * s.value) / total}%`, backgroundColor: s.color }}
          />
        ))}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm border border-border"
              style={{ backgroundColor: s.color }}
            />
            <dt className="flex-1 text-muted">{s.label}</dt>
            <dd className="tabular-nums font-medium">{formatCount(s.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
