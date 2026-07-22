import { formatCount } from "@/lib/format";
import type { ProfilingStatus } from "@/lib/db/profiling-status";

/**
 * The denominator, promoted to the visual anchor of a profiling-status page: the total number of
 * BHWs to profile at hero scale, with the "how far to go" gap right beneath it. Certification is
 * the finish line, so the gap is the Certify step's remaining count and % to go. A server
 * component — no interactivity, shared by the landing and per-area pages. Follows the same type
 * scale as the census `StatHero` without pulling in its client-side enlarge machinery.
 */
export function StatusHero({ status }: { status: ProfilingStatus }) {
  const { remaining, pctToGo } = status.certify;
  return (
    <div>
      <p className="text-base text-muted">BHWs to profile</p>
      <p className="mt-1 text-[3rem] font-semibold leading-none tracking-tight sm:text-[3.5rem]">
        {formatCount(status.totalBhw)}
      </p>
      {pctToGo !== null && (
        <p className="mt-3 text-sm">
          <span className="font-semibold text-foreground">{formatCount(remaining)}</span>{" "}
          <span className="text-muted">still to certify</span>{" "}
          <span aria-hidden="true" className="text-muted">
            ·
          </span>{" "}
          <span className="font-semibold text-foreground">{pctToGo}%</span>{" "}
          <span className="text-muted">to go</span>
        </p>
      )}
    </div>
  );
}
