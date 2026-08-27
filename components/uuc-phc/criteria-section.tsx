import Link from "next/link";
import { formatCount } from "@/lib/format";
import type { UucPhcCriteria, UucPhcCriteriaChild } from "@/lib/db/uuc-phc-criteria";
import { RouteShares } from "./route-shares";
import { RouteNotEvaluable } from "./route-not-evaluable";
import { RouteBreakdown } from "./route-breakdown";
import { PresentationSlide } from "@/components/present/presentation-slide";

/**
 * The body of `/uuc-phc/criteria`, shared by the national page and the per-area page so the two
 * cannot drift into saying different things about the same aggregate.
 *
 * The page answers the question the section could not answer before U7: not *which* barangays are
 * on the list, but *why* — how many of an area's listed barangays came in on each of the four
 * socio-economic routes of DOH AO No. 2020-0023 §VI.A. Before this it was visible only inside a
 * `<details>` on one city page at a time, so "how many of BARMM's 399 qualified on the 4Ps route?"
 * meant reading 399 disclosures.
 */
export function CriteriaSection({
  criteria,
  areaLabel,
  childHeading,
  childAreas,
  coverageHref,
  indicatorsHref,
}: {
  criteria: UucPhcCriteria;
  areaLabel: string;
  childHeading: string | null;
  // Not named `children`: this is data for a table, not slot content, and React reserves that
  // name for what nests between the tags.
  childAreas: UucPhcCriteriaChild[];
  /** The matching coverage page — the same area on the section's existing drill-down. */
  coverageHref: string;
  /** The matching indicators page — the same area's distributions (plan U9). */
  indicatorsHref: string;
}) {
  return (
    <>
      <PresentationSlide id="routes" title="How these barangays qualified">
        <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Qualifying routes</h2>
            <p className="text-sm text-muted">
              {formatCount(criteria.nListed)} listed barangay
              {criteria.nListed === 1 ? "" : "s"} in {areaLabel}
            </p>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            A barangay qualifies only when a <strong>physical</strong> factor and a{" "}
            <strong>socio-economic</strong> factor are both present. The physical factor holds for
            every barangay here by construction — one below the 25% threshold never entered the list
            — so what distinguishes them is which socio-economic route carried them.
          </p>

          <div className="mt-5">
            <RouteShares criteria={criteria} areaLabel={areaLabel} />
          </div>

          <RouteNotEvaluable criteria={criteria} areaLabel={areaLabel} />

          {/* The one line the plan asks for: why counting routes is publishable when averaging the
              indicators is not. U9 added the second half — the indicator values are now published
              above barangay grain too, as distributions, which is the other rendering that keeps a
              bounded value visible instead of dissolving it. */}
          <p className="mt-4 border-t border-border pt-4 text-xs text-muted">
            These are counts of classifications, not averages of measurements — which is why this
            page can publish them. The indicator values themselves are never averaged either: they
            are shown one barangay at a time, and{" "}
            <Link href={indicatorsHref} className="underline hover:text-accent">
              as distributions
            </Link>
            , both of which keep a bounded value visible where a mean would absorb it.{" "}
            <Link href="/uuc-phc/methodology" className="underline hover:text-accent">
              Methodology
            </Link>
            {" · "}
            <Link href={coverageHref} className="underline hover:text-accent">
              Which barangays these are
            </Link>
          </p>
        </section>
      </PresentationSlide>

      {childHeading && childAreas.length > 0 && (
        <PresentationSlide id="children" title={`${childHeading} by route`}>
          <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
            <RouteBreakdown heading={childHeading} items={childAreas} />
          </div>
        </PresentationSlide>
      )}
    </>
  );
}
