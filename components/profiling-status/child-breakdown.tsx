import Link from "next/link";
import { formatCount } from "@/lib/format";
import type { ProfilingStatusChild } from "@/lib/db/profiling-status";

function pctLabel(pct: number | null): string {
  return pct === null ? "—" : `${pct}%`;
}

/**
 * The child-unit breakdown for a profiling-status page (a region's provinces, a province's
 * cities). Each row links to that child's own profiling-status page, and shows how its BHWs are
 * split across the four mutually-exclusive stages — Encoded / Validated / Attested / Not encoded —
 * which sum to that area's Total. A server component — the drill-down is real navigation, not a
 * client fetch.
 */
export function ChildBreakdown({
  heading,
  items,
}: {
  heading: string;
  items: ProfilingStatusChild[];
}) {
  if (items.length === 0) return null;

  return (
    <section aria-label={heading}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <span className="text-xs text-muted">Count · % of total — stages sum to 100%</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Area
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Total
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Encoded
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Validated
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Attested
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Not encoded
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.geoCode} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <Link
                    href={`/profiling-status/${c.geoLevel}/${c.geoCode}`}
                    className="font-medium hover:text-accent hover:underline"
                  >
                    {c.geoName}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted">
                  {formatCount(c.totalBhw)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatCount(c.encoded.count)} · {pctLabel(c.encoded.pct)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatCount(c.validated.count)} · {pctLabel(c.validated.pct)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatCount(c.attested.count)} · {pctLabel(c.attested.pct)}
                </td>
                <td className="py-2 text-right tabular-nums text-muted">
                  {formatCount(c.notEncoded.count)} · {pctLabel(c.notEncoded.pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
