"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ChildSummaryRow } from "@/lib/db/indicators";
import { formatCount, formatPct } from "@/lib/format";

type SortKey = "geoName" | "nTotal" | "pctAccredited" | "anyHonorariumPct";
type SortDir = "asc" | "desc";

/** Numeric sort with nulls always pushed to the bottom regardless of direction. */
function compareNullableNumber(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

/**
 * "Places within" drill-down table (home-search review P1.7): the direct
 * children of a geo with their headline indicators, sortable and linking down a
 * level. This is the top-down navigation path the dashboard otherwise lacked —
 * both the way a technical reader scans for outliers and a browse route for
 * users who can't spell a place name. Data comes from `agg_geo_summary` via
 * getChildSummaries; no new aggregation.
 */
export function ChildrenTable({
  rows,
  childLevelLabel,
  showTrainingGap,
}: {
  rows: ChildSummaryRow[];
  /** Plural label for the child level, e.g. "Provinces", "Cities / municipalities". */
  childLevelLabel: string;
  /** Training gap is only computed above barangay level — hide the column otherwise. */
  showTrainingGap: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("nTotal");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortKey === "geoName") {
        return sortDir === "asc"
          ? a.geoName.localeCompare(b.geoName)
          : b.geoName.localeCompare(a.geoName);
      }
      return compareNullableNumber(a[sortKey], b[sortKey], sortDir);
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Names read best A→Z; counts/percentages best high→low.
      setSortDir(key === "geoName" ? "asc" : "desc");
    }
  }

  if (rows.length === 0) return null;

  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" =>
    key === sortKey ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  const sortArrow = (key: SortKey) => (key === sortKey ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  // A plain render helper (not a nested component) — keeps the sort closures in
  // scope without tripping react-hooks/static-components.
  const headerButton = (label: string, key: SortKey, numeric = false) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className={`flex items-center gap-0.5 font-medium hover:text-accent ${numeric ? "ml-auto" : ""}`}
    >
      {label}
      <span aria-hidden="true">{sortArrow(key)}</span>
    </button>
  );

  return (
    <section className="rounded-lg border border-border bg-background p-4 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">{childLevelLabel} within</h2>
      <p className="text-xs text-muted">
        {rows.length} {childLevelLabel.toLowerCase()} · tap a column to sort · tap a name to open it
      </p>

      <div className="mt-4 max-h-[32rem] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3" aria-sort={ariaSort("geoName")}>
                {headerButton("Name", "geoName")}
              </th>
              <th scope="col" className="py-2 pl-3 text-right" aria-sort={ariaSort("nTotal")}>
                {headerButton("BHWs profiled", "nTotal", true)}
              </th>
              <th
                scope="col"
                className="py-2 pl-3 text-right"
                aria-sort={ariaSort("pctAccredited")}
              >
                {headerButton("% accredited", "pctAccredited", true)}
              </th>
              <th
                scope="col"
                className="py-2 pl-3 text-right"
                aria-sort={ariaSort("anyHonorariumPct")}
              >
                {headerButton("% w/ honorarium", "anyHonorariumPct", true)}
              </th>
              {showTrainingGap && (
                <th scope="col" className="py-2 pl-3 text-left font-medium">
                  Top training gap
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.geoCode} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-3">
                  <Link
                    href={`/place/${row.geoLevel}/${row.geoCode}`}
                    className="font-medium hover:text-accent hover:underline"
                  >
                    {row.geoName}
                  </Link>
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">{formatCount(row.nTotal)}</td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {formatPct(row.pctAccredited)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {formatPct(row.anyHonorariumPct)}
                </td>
                {showTrainingGap && (
                  <td className="py-2 pl-3 text-left text-muted">{row.topTrainingGap ?? "—"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
