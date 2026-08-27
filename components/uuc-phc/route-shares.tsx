import { formatCount } from "@/lib/format";
import type { UucPhcCriteria, UucPhcRoute } from "@/lib/db/uuc-phc-criteria";

/**
 * The four socio-economic routes of DOH AO No. 2020-0023 §VI.A, each drawn as its **own** 0–100%
 * track against **its own** denominator.
 *
 * **This is four bars and not one, for a reason that is about the data rather than the design.**
 * The routes overlap: a barangay can qualify on three of them at once, and the four counts add up
 * to well above the area's listed count almost everywhere. A stacked bar or a pie would assert a
 * partition — four slices of one whole, each barangay in exactly one — and the data does not have
 * that shape. Four independent tracks make each share readable on its own and make no claim about
 * how they combine, which is the only honest thing to say without a set-intersection figure this
 * aggregate does not carry.
 *
 * Each row therefore prints its denominator in words rather than sharing one caption, because
 * route (d)'s denominator genuinely differs from the other three's — it excludes the barangays
 * whose provincial reference cannot support the comparison.
 *
 * A server component: this is a static rendering of numbers already fetched.
 */

function RouteRow({ route }: { route: UucPhcRoute }) {
  const notEvaluable = route.denominator <= 0;

  return (
    <div className="border-b border-border py-4 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-medium">
          <span className="text-muted">({route.criterion})</span> {route.label}
        </h3>
        {notEvaluable ? (
          // A zero denominator is not a 0% share. "0 of 0" invites a reader to see a route nobody
          // qualified on, when in fact the question cannot be asked here at all — the sentence
          // below the tracks says which barangays and why.
          <p className="text-sm text-muted">Not evaluable here</p>
        ) : (
          <p className="text-sm tabular-nums">
            <span className="font-semibold">{formatCount(route.count)}</span>{" "}
            <span className="text-muted">of {formatCount(route.denominator)}</span>
            {route.sharePct !== null && (
              <>
                {" "}
                <span aria-hidden="true" className="text-muted">
                  ·
                </span>{" "}
                <span className="font-semibold">{route.sharePct}%</span>
              </>
            )}
          </p>
        )}
      </div>

      <div
        className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface"
        role="img"
        aria-label={
          notEvaluable
            ? `${route.label}: not evaluable for any listed barangay here`
            : `${route.label}: ${formatCount(route.count)} of ${formatCount(
                route.denominator,
              )} listed barangays${route.sharePct === null ? "" : ` (${route.sharePct}%)`}`
        }
      >
        <div className="h-full bg-accent" style={{ width: `${route.fraction * 100}%` }} />
      </div>

      <p className="mt-2 text-xs text-muted">{route.test}</p>
    </div>
  );
}

export function RouteShares({ criteria, areaLabel }: { criteria: UucPhcCriteria; areaLabel: string }) {
  if (criteria.nListed === 0) {
    return (
      <p className="text-sm text-muted">
        No barangay in {areaLabel} is on the 2025 list, so there is no qualifying route to break
        down. The list is national and complete as published, so this is a result rather than
        missing data.
      </p>
    );
  }

  return (
    <div>
      <div className="border-t border-border">
        {criteria.routes.map((route) => (
          <RouteRow key={route.key} route={route} />
        ))}
      </div>

      {/* The overlap, stated rather than implied. This is the sentence the four separate tracks
          exist to support: a reader who adds the percentages above gets this number, and it is
          above 100 because barangays qualify on more than one route. */}
      {criteria.shareSumPct !== null && (
        <p className="mt-4 rounded-md bg-surface px-4 py-3 text-sm">
          These four shares add up to{" "}
          <strong className="tabular-nums">{criteria.shareSumPct}%</strong>
          {criteria.shareSumPct > 100 ? (
            <>
              , not 100%, because a barangay can qualify on more than one route at a time. They are
              four overlapping shares of {areaLabel}&rsquo;s {formatCount(criteria.nListed)} listed
              barangay
              {criteria.nListed === 1 ? "" : "s"} — not four slices of it.
            </>
          ) : (
            <>
              . The routes still overlap in principle — a barangay can qualify on more than one —
              so these are four independent shares of {areaLabel}&rsquo;s{" "}
              {formatCount(criteria.nListed)} listed barangay
              {criteria.nListed === 1 ? "" : "s"}, not four slices of it.
            </>
          )}
        </p>
      )}
    </div>
  );
}
