import { formatCount } from "@/lib/format";
import type { UucPhcCriteria } from "@/lib/db/uuc-phc-criteria";

/**
 * Why route (d)'s denominator is smaller than the other three's, stated on the page rather than
 * left to a methodology link.
 *
 * Criterion (d) is a *comparison* against the barangay's province, so it needs a usable provincial
 * benchmark. For 226 barangays in 5 provinces there is none that can carry the comparison — the
 * benchmarks are placeholders (every value exactly 1), zero-fills, missing, or recorded as
 * fractions rather than percentages. Those barangays are excluded from the health route's
 * denominator, and this is where the page says so.
 *
 * **Both figures are read from the aggregate, never typed.** An excluded count written into the
 * copy would go stale the first time a corrected extract arrives, and a stale caveat about data
 * quality is worse than none. Renders nothing where the exclusion does not bite, because a caveat
 * about zero barangays is noise on the 1,500-odd areas it does not apply to.
 */
export function RouteNotEvaluable({
  criteria,
  areaLabel,
}: {
  criteria: UucPhcCriteria;
  areaLabel: string;
}) {
  if (criteria.healthExcluded <= 0) return null;

  const all = criteria.healthEvaluable === 0;

  return (
    <p className="mt-4 rounded-md border border-border px-4 py-3 text-sm text-muted">
      <strong className="font-medium text-foreground">
        {formatCount(criteria.healthExcluded)}
      </strong>{" "}
      of {areaLabel}&rsquo;s {formatCount(criteria.nListed)}{" "}
      listed barangays are left out of the health route&rsquo;s denominator
      {all ? " — all of them" : ""}. Criterion (d) compares a barangay against its province, and for
      these the provincial figures cannot support the comparison: they were supplied as
      placeholders, zeroes, fractions, or not at all. Their place on the list is not in doubt — the
      socio-economic test passes on any one of the four routes — but the health comparison cannot be
      evaluated for them, so the share above is{" "}
      {all ? (
        <>out of none.</>
      ) : (
        <>out of the {formatCount(criteria.healthEvaluable)} it can be evaluated for.</>
      )}
    </p>
  );
}
