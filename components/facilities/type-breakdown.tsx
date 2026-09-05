import { formatCount } from "@/lib/format";
import type { NhfrTypeCount } from "@/lib/db/nhfr";

/**
 * An area's facilities by type, most common first, with the government/private split per type.
 *
 * `agg_nhfr_by_type` is sparse — only non-zero rows exist — so this renders what is *here* rather
 * than all 45 national categories with zeros against most of them. An area with no facilities
 * gets the empty state, and the count beside it (from `agg_nhfr_counts`) states the 0 explicitly,
 * so "nothing here" is never confused with "nothing loaded".
 */
export function TypeBreakdown({ items }: { items: NhfrTypeCount[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted">
        No health facilities are on the DOH registry for this area.
      </p>
    );
  }

  const total = items.reduce((sum, t) => sum + t.nFacilities, 0);

  return (
    <section aria-label="Facilities by type">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">By facility type</h2>
        <span className="text-xs text-muted">{items.length} types present</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Type
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Facilities
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Government
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Private
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.facilityType} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <span className="font-medium">{t.facilityType}</span>
                  {t.facilityMajorType === "Health Related Facility" && (
                    <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs text-muted">
                      health-related
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums">
                  {formatCount(t.nFacilities)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted">
                  {formatCount(t.nGovernment)}
                </td>
                <td className="py-2 text-right tabular-nums text-muted">
                  {formatCount(t.nPrivate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
        {formatCount(total)} facilities across {items.length}{" "}
        {items.length === 1 ? "type" : "types"}.
      </p>
    </section>
  );
}
