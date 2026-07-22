"use client";

import { useCallback, useState } from "react";
import { formatCount } from "@/lib/format";
import type {
  ProfilingStatus,
  ProfilingStatusChild,
} from "@/lib/db/profiling-status";
import type { GeoLevel } from "@/lib/filters/schema";

export type ProfilingStatusView = {
  geoCode: string;
  geoLevel: GeoLevel;
  geoName: string;
  status: ProfilingStatus;
  children: ProfilingStatusChild[];
};

const STEP_META = [
  { key: "encode", label: "Encode", color: "var(--seq-3)" },
  { key: "validate", label: "Validate", color: "var(--seq-5)" },
  { key: "certify", label: "Certify", color: "var(--seq-6)" },
] as const;

/** The geo level one step down, for labelling the breakdown ("Provinces", "Cities/municipalities"). */
const CHILD_LABEL: Partial<Record<GeoLevel, string>> = {
  national: "Regions",
  region: "Provinces",
  province: "Cities / municipalities",
};

function pctLabel(pct: number | null): string {
  return pct === null ? "—" : `${pct}%`;
}

/** One labelled progress bar for a funnel step, width = capped % of the denominator. */
function StepBar({
  label,
  color,
  count,
  pct,
  pctCapped,
}: {
  label: string;
  color: string;
  count: number;
  pct: number | null;
  pctCapped: number | null;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted">
          {formatCount(count)} <span aria-hidden="true">·</span> {pctLabel(pct)}
        </span>
      </div>
      <div
        className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-surface"
        role="img"
        aria-label={`${label}: ${formatCount(count)} (${pctLabel(pct)} of total)`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pctCapped ?? 0}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function ProfilingStatusPanel({ initial }: { initial: ProfilingStatusView }) {
  // Breadcrumb stack from national down to the current view; last item is current.
  const [stack, setStack] = useState<ProfilingStatusView[]>([initial]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = stack[stack.length - 1];

  const navigate = useCallback(
    async (geoCode: string, geoLevel: GeoLevel, depth: number | null) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/profiling-status?geoCode=${encodeURIComponent(geoCode)}&geoLevel=${geoLevel}`,
        );
        if (!res.ok) throw new Error("Area not available");
        const view = (await res.json()) as ProfilingStatusView;
        // depth === null → drill down (push); otherwise truncate to that breadcrumb.
        setStack((prev) => (depth === null ? [...prev, view] : [...prev.slice(0, depth), view]));
      } catch {
        setError("Could not load that area. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const childLabel = CHILD_LABEL[current.geoLevel];
  const downloadHref = `/api/export/profiling-status?geoLevel=${current.geoLevel}&geoCode=${encodeURIComponent(current.geoCode)}`;

  return (
    <div className="rounded-lg border border-border bg-background p-4 sm:p-6">
      {/* Breadcrumb — click an ancestor to zoom back out. */}
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted" aria-label="Area">
        {stack.map((v, i) => {
          const isCurrent = i === stack.length - 1;
          return (
            <span key={`${v.geoCode}-${i}`} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true">›</span>}
              {isCurrent ? (
                <span className="font-medium text-foreground">{v.geoName}</span>
              ) : (
                <button
                  type="button"
                  className="rounded underline decoration-dotted underline-offset-2 hover:text-accent"
                  onClick={() => navigate(v.geoCode, v.geoLevel, i + 1)}
                >
                  {v.geoName}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      {/* Denominator + funnel */}
      <div className="mt-4">
        <p className="text-sm text-muted">
          {formatCount(current.status.totalBhw)} BHWs to profile
        </p>
        <div className="mt-3 flex flex-col gap-3" aria-busy={loading}>
          {STEP_META.map((s) => {
            const step = current.status[s.key];
            return (
              <StepBar
                key={s.key}
                label={s.label}
                color={s.color}
                count={step.count}
                pct={step.pct}
                pctCapped={step.pctCapped}
              />
            );
          })}
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {/* Child-unit breakdown (also the drill-down control). */}
      {childLabel && current.children.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">{childLabel}</h4>
            <span className="text-xs text-muted">Encoded · % of total</span>
          </div>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {current.children.map((c) => {
              const drillable = c.geoLevel !== "citymun";
              const row = (
                <span className="flex w-full items-center gap-3">
                  <span className="flex-1 truncate text-left">{c.geoName}</span>
                  <span
                    className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface sm:block"
                    aria-hidden="true"
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${c.encode.pctCapped ?? 0}%`,
                        backgroundColor: "var(--seq-4)",
                      }}
                    />
                  </span>
                  <span className="w-10 text-right text-muted tabular-nums">
                    {pctLabel(c.encode.pct)}
                  </span>
                </span>
              );
              return (
                <li key={c.geoCode}>
                  {drillable ? (
                    <button
                      type="button"
                      onClick={() => navigate(c.geoCode, c.geoLevel, null)}
                      className="flex w-full items-center py-2 text-sm hover:text-accent"
                    >
                      {row}
                    </button>
                  ) : (
                    <span className="flex w-full items-center py-2 text-sm">{row}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Download the current level as a one-page PNG. */}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <p className="text-xs text-muted">Encode → Validate → Certify · 2026 profiling</p>
        <a
          href={downloadHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-accent"
        >
          Download summary (PNG)
        </a>
      </div>
    </div>
  );
}
