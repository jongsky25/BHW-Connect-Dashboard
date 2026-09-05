import { formatCount } from "@/lib/format";
import { licensingLabel, type NhfrFacility } from "@/lib/db/nhfr";

/**
 * Every facility in a city/municipality — the leaf of the drill-down, and the level at which
 * "which ones, and where" is the actionable question.
 *
 * **Licence status renders what the source says and nothing more.** A blank is shown as "not
 * stated", never as "unlicensed": 63% of the register carries no status, overwhelmingly Barangay
 * Health Stations, which are not a licensed facility type. Rendering that absence as a compliance
 * failure would libel thousands of functioning facilities.
 *
 * **No addresses or contact details**, because they were never ingested — 91% of the source's
 * email addresses are personal webmail accounts (see ingestion/clean_nhfr.py). The barangay is
 * the location this section publishes.
 */
export function FacilityList({
  facilities,
  expectedCount,
}: {
  facilities: NhfrFacility[];
  expectedCount: number;
}) {
  if (facilities.length === 0) {
    return (
      <p className="text-sm text-muted">
        No health facilities are on the DOH registry for this city or municipality.
      </p>
    );
  }

  // The query is bounded, so say so when the bound bit rather than showing a short list that
  // looks complete (the failure the district export had to fix).
  const truncated = facilities.length < expectedCount;

  return (
    <section aria-label="Facilities">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Facilities</h2>
        <span className="text-xs text-muted">A–Z</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Facility
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Type
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Barangay
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Ownership
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Beds
              </th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f) => (
              <tr key={f.facilityCode} className="border-b border-border last:border-0 align-top">
                <td className="py-2 pr-3">
                  <span className="font-medium">{f.facilityName}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {licensingLabel(f.licensingStatus)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-muted">{f.facilityType}</td>
                <td className="py-2 pr-3 text-muted">{f.barangayName ?? "—"}</td>
                <td className="py-2 pr-3 text-muted">
                  {f.ownershipMajor}
                  {f.ownershipSub && (
                    <span className="mt-0.5 block text-xs">{f.ownershipSub}</span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums text-muted">
                  {f.bedCapacity > 0 ? formatCount(f.bedCapacity) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
        {truncated ? (
          <>
            Showing the first {formatCount(facilities.length)} of {formatCount(expectedCount)}{" "}
            facilities.
          </>
        ) : (
          <>
            {formatCount(facilities.length)}{" "}
            {facilities.length === 1 ? "facility" : "facilities"} listed. A dash under Beds means
            the facility records no bed capacity — most out-patient facilities do not.
          </>
        )}
      </p>
    </section>
  );
}
