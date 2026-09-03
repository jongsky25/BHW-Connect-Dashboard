"use client";

import { useMemo, useState } from "react";
import type { DistrictIndexRow, DistrictMatchQuality } from "@/lib/db/districts";
import { MatchQualityBadge } from "./match-quality-badge";

const MATCH_QUALITY_FILTER_OPTIONS: { value: DistrictMatchQuality | "all"; label: string }[] = [
  { value: "all", label: "Any match quality" },
  { value: "all_exact", label: "All exact" },
  { value: "resolved", label: "Rule-resolved" },
  { value: "has_overrides", label: "Has corrections" },
  { value: "has_unresolved", label: "Known gap" },
];

function districtOrdinalLabel(row: DistrictIndexRow): string {
  if (row.isLone) return "Lone district";
  return row.ordinal ? `${row.ordinal}${ordinalSuffix(row.ordinal)} district` : "—";
}

function ordinalSuffix(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * The filterable index table (D2.1): region, free-text, and match-quality filters over the full
 * 250-district list, all client-side — the list is small (250 rows) and already fetched in full by
 * the server component, so a round trip per filter change would only add latency for no benefit.
 */
export function DistrictIndexTable({
  rows,
  regionOptions,
}: {
  rows: DistrictIndexRow[];
  regionOptions: { code: string; name: string }[];
}) {
  const [regionCode, setRegionCode] = useState<string>("all");
  const [matchQuality, setMatchQuality] = useState<DistrictMatchQuality | "all">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (regionCode !== "all" && row.regionCode !== regionCode) return false;
      if (matchQuality !== "all" && row.matchQuality !== matchQuality) return false;
      if (q && !row.districtName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, regionCode, matchQuality, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-muted" htmlFor="district-region-filter">
            Region
          </label>
          <select
            id="district-region-filter"
            value={regionCode}
            onChange={(e) => setRegionCode(e.target.value)}
            className="mt-1 w-full min-w-48 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="all">All regions</option>
            {regionOptions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted" htmlFor="district-quality-filter">
            Match quality
          </label>
          <select
            id="district-quality-filter"
            value={matchQuality}
            onChange={(e) => setMatchQuality(e.target.value as DistrictMatchQuality | "all")}
            className="mt-1 w-full min-w-44 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {MATCH_QUALITY_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 basis-56">
          <label className="block text-xs font-medium text-muted" htmlFor="district-search">
            Find a district
          </label>
          <input
            id="district-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Leyte's 1st"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <p className="text-xs text-muted" role="status">
        Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} districts.
      </p>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface">
            <tr>
              <th className="px-4 py-3 font-medium">District</th>
              <th className="px-4 py-3 font-medium">Region</th>
              <th className="px-4 py-3 font-medium">Seat</th>
              <th className="px-4 py-3 text-right font-medium">Member LGUs</th>
              <th className="px-4 py-3 text-right font-medium">Total BHWs</th>
              <th className="px-4 py-3 text-right font-medium">Population</th>
              <th className="px-4 py-3 font-medium">Match quality</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.districtCode} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">{row.districtName}</td>
                <td className="px-4 py-3 text-muted">{row.regionName ?? "—"}</td>
                <td className="px-4 py-3 text-muted">{districtOrdinalLabel(row)}</td>
                <td className="px-4 py-3 text-right">{row.memberCount.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">{row.bhwTotal.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  {row.population !== null ? row.population.toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <MatchQualityBadge quality={row.matchQuality} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted">
                  No districts match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
