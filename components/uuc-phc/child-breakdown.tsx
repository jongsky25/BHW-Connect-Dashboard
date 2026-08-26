import Link from "next/link";
import { formatCount } from "@/lib/format";
import type { UucPhcChild } from "@/lib/db/uuc-phc";

function pctLabel(pct: number | null): string {
  return pct === null ? "—" : `${pct}%`;
}

/**
 * The child-unit breakdown for a UUC for PHC page (a region's provinces, a province's cities).
 * Each row links to that child's own page and shows how many of its barangays are on the list,
 * out of how many it has.
 *
 * Areas with none listed are shown, not filtered out: "0 of 39" is a finding about that area, and
 * dropping the row would make an incomplete-looking table out of complete data. Sorted by share
 * descending so the most-affected areas lead, with the count as the tie-break — a list ordered by
 * raw count alone would just re-rank areas by how many barangays they happen to have.
 *
 * A server component — the drill-down is real navigation, not a client fetch.
 */
export function ChildBreakdown({ heading, items }: { heading: string; items: UucPhcChild[] }) {
  if (items.length === 0) return null;

  const sorted = [...items].sort(
    (a, b) => (b.sharePct ?? -1) - (a.sharePct ?? -1) || b.nListed - a.nListed,
  );

  return (
    <section aria-label={heading}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <span className="text-xs text-muted">Most affected first</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Area
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                On the list
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                All barangays
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.geoCode} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <Link
                    href={`/uuc-phc/${c.geoLevel}/${c.geoCode}`}
                    className="font-medium hover:text-accent hover:underline"
                  >
                    {c.geoName}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums">
                  {formatCount(c.nListed)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted">
                  {formatCount(c.nBarangays)}
                </td>
                <td className="py-2 text-right tabular-nums">{pctLabel(c.sharePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
