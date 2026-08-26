import { formatCount } from "@/lib/format";
import type { UucPhcBarangay } from "@/lib/db/uuc-phc";
import type { UucPhcBarangayDetail } from "@/lib/db/uuc-phc-indicators";
import { BarangayDetail } from "./barangay-detail";

/**
 * The leaf of the drill-down: every barangay of a city/municipality, marked with whether it is on
 * the 2025 list. Listed barangays expand to show why they qualified and the values behind it
 * (`BarangayDetail`); the rest are named as plain chips.
 *
 * Both states are named. At this level the reader is looking at their own town, so "which ones" is
 * the actionable question — and showing only the listed barangays would leave a reader unable to
 * tell an unlisted barangay from one the dataset never covered.
 */
export function BarangayList({
  items,
  details,
}: {
  items: UucPhcBarangay[];
  /** Indicator detail per listed barangay, keyed by geo_code. Empty renders names only. */
  details: UucPhcBarangayDetail[];
}) {
  if (items.length === 0) return null;

  const listed = items.filter((b) => b.listed);
  const rest = items.filter((b) => !b.listed);
  const detailByCode = new Map(details.map((d) => [d.geoCode, d]));

  return (
    <section aria-label="Barangays">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Barangays</h2>
        <span className="text-xs text-muted">
          {formatCount(listed.length)} of {formatCount(items.length)} on the list
        </span>
      </div>

      {listed.length > 0 && (
        <div className="mt-2">
          {details.length > 0 && (
            <p className="pb-2 text-xs text-muted">
              Open a barangay for the factors it qualified on and its health indicators.
            </p>
          )}
          {listed.map((b) => {
            const detail = detailByCode.get(b.geoCode);
            return detail ? (
              <BarangayDetail key={b.geoCode} detail={detail} />
            ) : (
              <p
                key={b.geoCode}
                className="border-b border-border py-3 text-sm font-medium last:border-0"
              >
                {b.geoName}
              </p>
            );
          })}
        </div>
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
