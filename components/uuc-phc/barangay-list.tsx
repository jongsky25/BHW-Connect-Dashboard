import { formatCount } from "@/lib/format";
import type { UucPhcBarangay } from "@/lib/db/uuc-phc";

/**
 * The leaf of the drill-down: every barangay of a city/municipality, marked with whether it is on
 * the 2025 list.
 *
 * Both states are named. At this level the reader is looking at their own town, so "which ones"
 * is the actionable question — and showing only the listed barangays would leave a reader unable
 * to tell an unlisted barangay from one the dataset never covered. Listed barangays lead; the
 * rest follow in name order.
 */
export function BarangayList({ items }: { items: UucPhcBarangay[] }) {
  if (items.length === 0) return null;

  const listed = items.filter((b) => b.listed);
  const rest = items.filter((b) => !b.listed);

  return (
    <section aria-label="Barangays">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Barangays</h2>
        <span className="text-xs text-muted">
          {formatCount(listed.length)} of {formatCount(items.length)} on the list
        </span>
      </div>

      {listed.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {listed.map((b) => (
            <li
              key={b.geoCode}
              className="rounded-md border border-accent/40 bg-accent-subtle px-2.5 py-1 text-sm font-medium text-accent"
            >
              {b.geoName}
            </li>
          ))}
        </ul>
      )}

      {rest.length > 0 && (
        <>
          <p className="mt-5 text-xs font-medium uppercase tracking-wide text-muted">
            Not on the list
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {rest.map((b) => (
              <li
                key={b.geoCode}
                className="rounded-md border border-border px-2.5 py-1 text-sm text-muted"
              >
                {b.geoName}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
