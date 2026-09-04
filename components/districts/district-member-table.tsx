"use client";

import { useMemo, useState } from "react";
import type { DistrictMemberReceipt } from "@/lib/db/districts";
import { MatchMethodBadge } from "./match-method-badge";
import { SourceRefLink } from "./source-ref-link";

const GEO_LEVEL_LABEL: Record<DistrictMemberReceipt["geoLevel"], string> = {
  citymun: "City/municipality",
  barangay: "Barangay",
};

/**
 * The per-row receipt table (D2.2): every live member of a district, each carrying the source page
 * it came from (linked to the exact revision, `SourceRefLink`), how it was matched, and — where a
 * human has reviewed the row — the reason. Client-side search only, same reasoning as
 * `DistrictIndexTable`: the largest district (Quezon City, ~142 barangays) is still small enough
 * that a round trip per keystroke would only add latency.
 */
export function DistrictMemberTable({ rows }: { rows: DistrictMemberReceipt[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.geoName.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-3">
      {rows.length > 15 && (
        <div className="max-w-xs">
          <label className="block text-xs font-medium text-muted" htmlFor="district-member-search">
            Find a member
          </label>
          <input
            id="district-member-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Tondo"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface">
            <tr>
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Level</th>
              <th className="px-4 py-3 font-medium">Match method</th>
              <th className="px-4 py-3 font-medium">Source page &amp; revision</th>
              <th className="px-4 py-3 font-medium">Retrieved</th>
              <th className="px-4 py-3 font-medium">Override reason</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0 align-top">
                <td className="px-4 py-3 font-medium">{row.geoName}</td>
                <td className="px-4 py-3 text-muted">{GEO_LEVEL_LABEL[row.geoLevel]}</td>
                <td className="px-4 py-3">
                  <MatchMethodBadge method={row.matchMethod} />
                </td>
                <td className="px-4 py-3">
                  <SourceRefLink sourceKind={row.sourceKind} sourceRef={row.sourceRef} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-muted">
                  {new Date(row.retrievedAt).toLocaleDateString("en-PH", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </td>
                <td className="px-4 py-3 text-muted">{row.reviewNote ?? "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  No members match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted" role="status">
        Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} members.
      </p>
    </div>
  );
}
