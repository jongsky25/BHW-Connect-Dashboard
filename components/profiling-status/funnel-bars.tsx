import { formatCount } from "@/lib/format";
import type { ProfilingStatus } from "@/lib/db/profiling-status";

const STEPS = [
  { key: "encode", label: "Encode", color: "var(--seq-3)" },
  { key: "validate", label: "Validate", color: "var(--seq-5)" },
  { key: "certify", label: "Certify", color: "var(--seq-6)" },
] as const;

function pctLabel(pct: number | null): string {
  return pct === null ? "—" : `${pct}%`;
}

/**
 * The Encode → Validate → Certify funnel as three labelled progress bars (count + % of the
 * total-BHW denominator). A server component — the same visual on the landing and per-area
 * profiling-status pages.
 */
export function FunnelBars({ status }: { status: ProfilingStatus }) {
  return (
    <div className="flex flex-col gap-3">
      {STEPS.map((s) => {
        const step = status[s.key];
        return (
          <div key={s.key}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="text-muted">
                {formatCount(step.count)} <span aria-hidden="true">·</span> {pctLabel(step.pct)}{" "}
                <span aria-hidden="true">·</span>{" "}
                <span className="text-muted/80">{formatCount(step.remaining)} to go</span>
              </span>
            </div>
            <div
              className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-surface"
              role="img"
              aria-label={`${s.label}: ${formatCount(step.count)} (${pctLabel(step.pct)} of total), ${formatCount(step.remaining)} to go`}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${step.pctCapped ?? 0}%`, backgroundColor: s.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
