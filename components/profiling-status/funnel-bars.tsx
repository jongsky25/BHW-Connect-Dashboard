import { formatCount } from "@/lib/format";
import type { ProfilingStage, ProfilingStatus } from "@/lib/db/profiling-status";

/**
 * The headline profiling picture: the four mutually-exclusive stages every BHW to profile sits in
 * — Encoded, Validated, Attested, and Not yet encoded — as one stacked bar that always fills to
 * 100%. Unlike a cumulative funnel (where a record counts toward every step it has passed, so the
 * shares overlap and never add up), these stages partition the population, so the counts and
 * percentages sum to the whole. A server component — the same visual on the landing and per-area
 * profiling-status pages.
 */
const STAGES = [
  { key: "encoded", label: "Encoded", color: "var(--seq-3)" },
  { key: "validated", label: "Validated", color: "var(--seq-5)" },
  { key: "attested", label: "Attested", color: "var(--seq-6)" },
  { key: "notEncoded", label: "Not yet encoded", color: "var(--surface)" },
] as const;

function pctLabel(pct: number | null): string {
  return pct === null ? "—" : `${pct}%`;
}

export function FunnelBars({ status }: { status: ProfilingStatus }) {
  const segments = STAGES.map((s) => ({ ...s, stage: status[s.key] as ProfilingStage })).filter(
    (s) => s.stage.count > 0,
  );
  if (segments.length === 0) return null;

  const ariaLabel = segments
    .map((s) => `${s.label} ${formatCount(s.stage.count)}, ${pctLabel(s.stage.pct)}`)
    .join("; ");

  return (
    <section aria-label="Profiling status">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Profiling status</h2>
        <span className="text-xs text-muted">Every BHW to profile · adds up to 100%</span>
      </div>

      <div
        role="img"
        aria-label={ariaLabel}
        className="mt-2 flex h-4 w-full overflow-hidden rounded-full border border-border bg-surface"
      >
        {segments.map((s) => (
          <span
            key={s.key}
            title={`${s.label}: ${formatCount(s.stage.count)} · ${pctLabel(s.stage.pct)}`}
            style={{ width: `${s.stage.fraction * 100}%`, backgroundColor: s.color }}
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
            <dd className="tabular-nums font-medium">
              {formatCount(s.stage.count)} <span aria-hidden="true">·</span> {pctLabel(s.stage.pct)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
