import { formatCount } from "@/lib/format";
import type { ProfilingStatus } from "@/lib/db/profiling-status";

/**
 * Where the work actually sits *right now*. The Encode → Validate → Certify funnel is cumulative
 * (each step counts everyone who has passed it), which hides the bottleneck: a record counts as
 * "Encoded" whether it is a fresh draft or stuck in rework. This breaks the same population into
 * mutually-exclusive current states so the pile-up is visible — the raw pipeline buckets are
 * already collected on `ProfilingStatus`, they were just never surfaced. A server component.
 *
 * Segments are ordered finish-line → start (certified first) and sum to the denominator, so the
 * bar reads as a share of all BHWs to profile. `back_to_encoder` (rework) is called out in the
 * warning color — it is the quality signal buried in the funnel.
 */
export function BottleneckBars({ status }: { status: ProfilingStatus }) {
  const notEncoded = Math.max(0, status.totalBhw - status.encode.count);
  const segments = [
    { key: "certified", label: "Certified", value: status.nApproved, color: "var(--seq-6)" },
    {
      key: "awaiting-cert",
      label: "Validated, awaiting certification",
      value: status.nValidated,
      color: "var(--seq-4)",
    },
    {
      key: "rework",
      label: "Sent back for rework",
      value: status.nBackToEncoder,
      color: "var(--warning)",
    },
    {
      key: "awaiting-val",
      label: "Awaiting validation",
      value: status.nForValidation,
      color: "var(--seq-2)",
    },
    { key: "drafted", label: "Drafted, not yet submitted", value: status.nDrafted, color: "var(--seq-1)" },
    { key: "not-encoded", label: "Not yet encoded", value: notEncoded, color: "var(--surface)" },
  ].filter((s) => s.value > 0);

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  const ariaLabel = segments.map((s) => `${s.label} ${formatCount(s.value)}`).join(", ");

  return (
    <section aria-label="Where records sit now">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Where records sit now</h2>
        <span className="text-xs text-muted">Current status of every BHW to profile</span>
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
