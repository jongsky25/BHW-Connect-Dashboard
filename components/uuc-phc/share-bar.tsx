import { formatCount } from "@/lib/format";
import type { UucPhcCounts } from "@/lib/db/uuc-phc";

/**
 * A single 100% bar splitting an area's barangays into listed and not listed — the whole of this
 * dataset's shape at a glance, since membership is binary.
 *
 * Deliberately not a multi-stage funnel: there are exactly two states, and drawing them as one
 * filled track against its remainder is the honest rendering. The bar is labelled in text as well
 * as colour, so it carries without colour perception.
 */
export function ShareBar({ counts }: { counts: UucPhcCounts }) {
  const { nListed, nBarangays, sharePct, fraction } = counts;
  const notListed = Math.max(0, nBarangays - nListed);

  if (nBarangays <= 0) {
    return <p className="text-sm text-muted">No barangays recorded for this area.</p>;
  }

  return (
    <div>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-surface"
        role="img"
        aria-label={`${formatCount(nListed)} of ${formatCount(nBarangays)} barangays on the list${
          sharePct === null ? "" : ` (${sharePct}%)`
        }`}
      >
        <div className="h-full bg-accent" style={{ width: `${fraction * 100}%` }} />
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
          <dt className="text-muted">On the list</dt>
          <dd className="font-semibold tabular-nums">
            {formatCount(nListed)}
            {sharePct !== null && <span className="text-muted"> · {sharePct}%</span>}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full bg-surface ring-1 ring-border"
          />
          <dt className="text-muted">Not on the list</dt>
          <dd className="font-semibold tabular-nums">
            {formatCount(notListed)}
            {sharePct !== null && <span className="text-muted"> · {100 - sharePct}%</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}
