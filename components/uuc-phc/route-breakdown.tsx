import Link from "next/link";
import { formatCount } from "@/lib/format";
import { QUALIFYING_ROUTES, type UucPhcCriteriaChild } from "@/lib/db/uuc-phc-criteria";

/**
 * The child-unit breakdown for the criteria page: one row per area, one column per route, so a
 * reader can compare *which* route dominates across areas rather than one area at a time. This is
 * the comparison `docs/UUC_PHC_2025_PLAN.md` §9 "Considered and not planned" says belongs on this
 * page rather than on a `/uuc-phc/compare` route.
 *
 * **Every cell is a share of its own row's denominator, and the row's shares do not sum to 100%.**
 * The column header carries the route letter and the caption below the table says so once; the
 * cells themselves print the count with the percentage so no cell is a bare number that could be
 * mistaken for a slice.
 *
 * Route (d)'s cell is a share of that area's *evaluable* barangays, which is why the row prints
 * that denominator separately when it differs from the listed count. An area where the comparison
 * is evaluable for nobody shows "—", not "0%": no barangay qualified is a different statement from
 * the question not being answerable.
 *
 * Sorted by listed count descending — this table is about composition, and the areas contributing
 * most of the list are the ones whose composition moves the total.
 */
export function RouteBreakdown({
  heading,
  items,
}: {
  heading: string;
  items: UucPhcCriteriaChild[];
}) {
  if (items.length === 0) return null;

  const sorted = [...items].sort((a, b) => b.nListed - a.nListed || a.geoName.localeCompare(b.geoName));
  const anyExcluded = sorted.some((c) => c.healthExcluded > 0);

  return (
    <section aria-label={heading}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <span className="text-xs text-muted">Largest share of the list first</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Listed barangays by qualifying route. The four route columns overlap and do not sum to
            the listed count.
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Area
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Listed
              </th>
              {QUALIFYING_ROUTES.map((route) => (
                <th key={route.key} scope="col" className="py-2 pr-3 text-right font-medium">
                  ({route.criterion}) {route.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.geoCode} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <Link
                    href={`/uuc-phc/criteria/${c.geoLevel}/${c.geoCode}`}
                    className="font-medium hover:text-accent hover:underline"
                  >
                    {c.geoName}
                  </Link>
                  {c.healthExcluded > 0 && (
                    <span className="block text-xs text-muted">
                      (d) evaluable for {formatCount(c.healthEvaluable)} of{" "}
                      {formatCount(c.nListed)}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums">
                  {formatCount(c.nListed)}
                </td>
                {c.routes.map((route) => (
                  <td key={route.key} className="py-2 pr-3 text-right tabular-nums">
                    {route.sharePct === null ? (
                      <span className="text-muted" title="Not evaluable for any listed barangay here">
                        —
                      </span>
                    ) : (
                      <>
                        {formatCount(route.count)}{" "}
                        <span className="text-xs text-muted">{route.sharePct}%</span>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
        Each percentage is a share of that area&rsquo;s own listed barangays, and the four do not
        sum to 100%: a barangay can qualify on more than one route.
        {anyExcluded && (
          <>
            {" "}
            Where route (d) is evaluable for fewer barangays than are listed, its share is out of
            that smaller number and the row says which.
          </>
        )}
      </p>
    </section>
  );
}
