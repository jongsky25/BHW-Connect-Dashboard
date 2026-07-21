import type { ValueFormatKind } from "@/lib/format";
import { formatterFor } from "@/lib/format";

export type BenchmarkRow = {
  /** Short label, e.g. "This place", "Region VII", "Philippines". */
  label: string;
  value: number | null;
  /** The emphasized row — the current place on place/explore pages, or the
   * leading place in a Compare head-to-head block. */
  isPrimary?: boolean;
};

/**
 * Compact "value vs. its region and the nation" comparator (home-search review
 * P1.8/P1.9). Answers the first question a technical reader asks of any figure —
 * "versus what?" — which the place pages otherwise left unanswered. Purely
 * presentational; all values come from the same `lib/db` indicator queries run
 * at the ancestor geos, so the comparison is internally consistent with the
 * figure it sits under — e.g. this place's households-per-BHW load against its
 * region's and the nation's, rather than an arbitrary gauge scale.
 */
export function BenchmarkBars({
  rows,
  format = "count",
  unitSuffix,
  flush = false,
}: {
  rows: BenchmarkRow[];
  /** How to format each value (percent / count / peso). */
  format?: ValueFormatKind;
  /** Optional suffix appended after the formatted value, e.g. "yrs" or "/1,000". */
  unitSuffix?: string;
  /** Drop the top border/margin — for hosts (e.g. the Compare head-to-head
   * grid) that provide their own framing instead of sitting under a figure. */
  flush?: boolean;
}) {
  const usable = rows.filter((r) => r.value !== null);
  if (usable.length < 2) return null; // nothing to compare against

  const fmt = formatterFor(format);
  const formatValue = (v: number) => (unitSuffix ? `${fmt(v)} ${unitSuffix}` : fmt(v));
  // Percentages read against a fixed 0–100 scale; other units against the
  // largest value present so the bars fill the track.
  const scaleMax =
    format === "percent" ? 100 : Math.max(...usable.map((r) => r.value as number), 1);

  return (
    <dl className={flush ? "space-y-1.5" : "mt-4 space-y-1.5 border-t border-border pt-3"}>
      {rows.map((row) => {
        const pct = row.value === null ? 0 : Math.min(100, (row.value / scaleMax) * 100);
        return (
          <div
            key={row.label}
            className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 text-xs"
          >
            <dt className={`truncate ${row.isPrimary ? "font-medium" : "text-muted"}`}>
              {row.label}
            </dt>
            <div className="h-1.5 rounded-full bg-surface" aria-hidden="true">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  backgroundColor: row.isPrimary ? "var(--accent)" : "var(--seq-3)",
                }}
              />
            </div>
            <dd className={`tabular-nums ${row.isPrimary ? "font-medium" : "text-muted"}`}>
              {row.value === null ? "—" : formatValue(row.value)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
