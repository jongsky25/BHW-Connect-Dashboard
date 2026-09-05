import Link from "next/link";
import { formatCount, formatPct } from "@/lib/format";
import type { NhfrChild } from "@/lib/db/nhfr";

/**
 * The child-unit breakdown for a facilities page (a region's provinces, a province's cities).
 *
 * **Ordered by barangay coverage ascending — the least-covered areas lead.** This is the opposite
 * of ranking by facility count, and deliberately so: a raw count just re-ranks areas by how large
 * they are, and the question this dataset answers is where there is *nothing*. Areas with no
 * barangay denominator sort last, since they support no coverage claim either way.
 *
 * Areas with no facilities are shown, not filtered out: "0 facilities" is a finding about that
 * area, and dropping the row would make an incomplete-looking table out of complete data.
 */
export function ChildBreakdown({ heading, items }: { heading: string; items: NhfrChild[] }) {
  if (items.length === 0) return null;

  const sorted = [...items].sort((a, b) => {
    if (a.coveragePct === null && b.coveragePct === null) return 0;
    if (a.coveragePct === null) return 1;
    if (b.coveragePct === null) return -1;
    return a.coveragePct - b.coveragePct || a.nFacilities - b.nFacilities;
  });

  return (
    <section aria-label={heading}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <span className="text-xs text-muted">Least covered first</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Area
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Facilities
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Barangays with one
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Coverage
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.geoCode} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <Link
                    href={`/facilities/${c.geoLevel}/${c.geoCode}`}
                    className="font-medium hover:text-accent hover:underline"
                  >
                    {c.geoName}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums">
                  {formatCount(c.nFacilities)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted">
                  {formatCount(c.nBarangaysWithFacility)} of {formatCount(c.nBarangays)}
                </td>
                <td className="py-2 text-right tabular-nums">{formatPct(c.coveragePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
