import { formatCount } from "@/lib/format";
import type { UucPhcCounts } from "@/lib/db/uuc-phc";

/**
 * The count of listed barangays at hero scale, with its denominator and share beneath it.
 *
 * The listed count is the hero rather than the denominator — the opposite choice to the
 * profiling-status page, and deliberately so. There the denominator *is* the story ("every BHW
 * must be profiled; here is how many are left"). Here the list is the story: these are the
 * barangays a programme targets, and the total barangay count is context for reading it.
 *
 * A server component — no interactivity, shared by the landing and per-area pages.
 */
export function CoverageHero({ counts, areaLabel }: { counts: UucPhcCounts; areaLabel: string }) {
  const { nListed, nBarangays, sharePct } = counts;
  return (
    <div>
      <p className="text-base text-muted">Unserved &amp; underserved barangays</p>
      <p className="mt-1 text-[3rem] font-semibold leading-none tracking-tight sm:text-[3.5rem]">
        {formatCount(nListed)}
      </p>
      <p className="mt-3 text-sm">
        <span className="text-muted">of</span>{" "}
        <span className="font-semibold text-foreground">{formatCount(nBarangays)}</span>{" "}
        <span className="text-muted">barangays in {areaLabel}</span>
        {sharePct !== null && (
          <>
            {" "}
            <span aria-hidden="true" className="text-muted">
              ·
            </span>{" "}
            <span className="font-semibold text-foreground">{sharePct}%</span>
          </>
        )}
      </p>
    </div>
  );
}
