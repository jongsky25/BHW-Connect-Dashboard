import { formatCount } from "@/lib/format";
import type { NhfrCounts } from "@/lib/db/nhfr";

/**
 * Barangays with at least one facility, against all the area's barangays.
 *
 * This is the one share this dataset supports, and it is the finding worth leading with: a raw
 * facility count says how much there is, and only this says whether any of it is *where people
 * are*. Nationally 28,511 of 41,958 barangays have a facility, so roughly 13,400 have none.
 *
 * **The unfilled remainder is the point, so it is labelled, not left as empty track.** A bar
 * whose remainder has no legend reads as "the rest is fine"; here the rest is the gap.
 *
 * The 108 facilities carrying no barangay code in the source cannot count toward the filled
 * portion. They are a rounding-level share of 44,799 and are named on the methodology page rather
 * than silently absorbed.
 */
export function CoverageBar({ counts }: { counts: NhfrCounts }) {
  const { nBarangaysWithFacility, nBarangays, coveragePct, coverageFraction } = counts;
  const without = Math.max(0, nBarangays - nBarangaysWithFacility);

  if (nBarangays <= 0) {
    return <p className="text-sm text-muted">No barangays recorded for this area.</p>;
  }

  return (
    <div>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-surface"
        role="img"
        aria-label={`${formatCount(nBarangaysWithFacility)} of ${formatCount(
          nBarangays,
        )} barangays have at least one health facility${
          coveragePct === null ? "" : ` (${coveragePct}%)`
        }`}
      >
        <div className="h-full bg-accent" style={{ width: `${coverageFraction * 100}%` }} />
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
          <dt className="text-muted">Barangays with a facility</dt>
          <dd className="font-semibold tabular-nums">
            {formatCount(nBarangaysWithFacility)}
            {coveragePct !== null && <span className="text-muted"> · {coveragePct}%</span>}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full bg-surface ring-1 ring-border"
          />
          <dt className="text-muted">Barangays with none</dt>
          <dd className="font-semibold tabular-nums">
            {formatCount(without)}
            {coveragePct !== null && <span className="text-muted"> · {100 - coveragePct}%</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}
