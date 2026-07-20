"use client";

import { useState, type ReactNode } from "react";
import type { BarDatum } from "@/lib/charts/bar-chart";
import { formatCount } from "@/lib/format";

type SortDir = "asc" | "desc";
type SortColumn = "count" | "percent" | "value";

/** Column-header sort toggle. `aria-sort` belongs on the `<th>` (columnheader
 * role), not this button, so the caller applies it there. */
function SortButton({
  active,
  dir,
  onClick,
  children,
}: {
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 font-medium hover:text-accent">
      {children}
      {active && <span aria-hidden="true">{dir === "desc" ? "▼" : "▲"}</span>}
    </button>
  );
}

/** Accessible, sortable table rendering of the same data a bar chart draws —
 * the chart -> table toggle body, styled like app/data-quality/page.tsx's table.
 *
 * For count/percent figures this shows `Category | No. | %`: `No.` is the raw
 * count (passed via `BarDatum.count`, or `value` itself when the figure's
 * native value already is a count) and `%` is each row's share, sorted
 * high -> low by default. For "amount" figures (e.g. peso averages that
 * aren't additive across rows) a "% of total" would misrepresent the data, so
 * those keep a single sortable value column instead. */
export function FigureTable({
  data,
  labelHeader = "Category",
  valueHeader = "Value",
  valueFormatter = (n: number) => n.toLocaleString(),
  valueKind = "count",
}: {
  data: BarDatum[];
  labelHeader?: string;
  valueHeader?: string;
  valueFormatter?: (n: number) => string;
  valueKind?: "count" | "percent" | "amount";
}) {
  const defaultSort: SortColumn = valueKind === "amount" ? "value" : "percent";
  const [sort, setSort] = useState<{ column: SortColumn; dir: SortDir }>({ column: defaultSort, dir: "desc" });

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const rows = data.map((d) => ({
    ...d,
    count: valueKind === "percent" ? d.count : (d.count ?? d.value),
    percent: valueKind === "percent" ? d.value : total > 0 ? (d.value / total) * 100 : 0,
  }));

  const sorted = [...rows].sort((a, b) => {
    const key = (r: (typeof rows)[number]) =>
      sort.column === "count" ? (r.count ?? -Infinity) : sort.column === "percent" ? r.percent : r.value;
    const diff = key(a) - key(b);
    return sort.dir === "desc" ? -diff : diff;
  });

  function toggleSort(column: SortColumn) {
    setSort((prev) =>
      prev.column === column ? { column, dir: prev.dir === "desc" ? "asc" : "desc" } : { column, dir: "desc" },
    );
  }

  function ariaSortFor(column: SortColumn): "ascending" | "descending" | "none" {
    if (sort.column !== column) return "none";
    return sort.dir === "desc" ? "descending" : "ascending";
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface">
          <tr>
            <th className="px-3 py-2 sm:px-4 sm:py-3 font-medium">{labelHeader}</th>
            {valueKind === "amount" ? (
              <th className="px-3 py-2 sm:px-4 sm:py-3" aria-sort={ariaSortFor("value")}>
                <SortButton active={sort.column === "value"} dir={sort.dir} onClick={() => toggleSort("value")}>
                  {valueHeader}
                </SortButton>
              </th>
            ) : (
              <>
                <th className="px-3 py-2 sm:px-4 sm:py-3" aria-sort={ariaSortFor("count")}>
                  <SortButton active={sort.column === "count"} dir={sort.dir} onClick={() => toggleSort("count")}>
                    No.
                  </SortButton>
                </th>
                <th className="px-3 py-2 sm:px-4 sm:py-3" aria-sort={ariaSortFor("percent")}>
                  <SortButton active={sort.column === "percent"} dir={sort.dir} onClick={() => toggleSort("percent")}>
                    %
                  </SortButton>
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <tr key={d.label} className="border-b border-border last:border-0 hover:bg-surface">
              <td className="px-3 py-2 sm:px-4 sm:py-3">{d.label}</td>
              {valueKind === "amount" ? (
                <td className="px-3 py-2 sm:px-4 sm:py-3">{valueFormatter(d.value)}</td>
              ) : (
                <>
                  <td className="px-3 py-2 sm:px-4 sm:py-3">{d.count != null ? formatCount(d.count) : "—"}</td>
                  <td className="px-3 py-2 sm:px-4 sm:py-3">{Math.round(d.percent * 10) / 10}%</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
