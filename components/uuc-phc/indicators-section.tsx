import Link from "next/link";
import { formatCount } from "@/lib/format";
import type { UucPhcIndicatorDist } from "@/lib/db/uuc-phc-indicator-dist";
import { IndicatorHistogram } from "./indicator-histogram";
import { PresentationSlide } from "@/components/present/presentation-slide";

/**
 * The body of `/uuc-phc/indicators`, shared by the national page and the per-area page so the two
 * cannot drift into saying different things about the same distributions — the same arrangement
 * `CriteriaSection` uses, for the same reason.
 *
 * Three groups, in the order DOH AO No. 2020-0023 §VI.A runs its test: the physical factor that
 * every listed barangay meets, the three socio-economic routes, and the seven health indicators
 * criterion (d) compares against the province.
 */

const GROUPS = [
  {
    key: "physical" as const,
    id: "physical",
    heading: "The physical factor",
    blurb:
      "Every listed barangay meets this one — it is the half of the test that never varies, which is why the criteria page counts routes and not this. What varies is by how much.",
  },
  {
    key: "socio" as const,
    id: "socio",
    heading: "Socio-economic factors",
    blurb:
      "The measurements behind criteria (a), (b) and (c). A barangay needs only one of the routes, so a low reading here is not a barangay that nearly missed the list — it is one that came in on a different route.",
  },
  {
    key: "health" as const,
    id: "health",
    heading: "Health indicators",
    blurb:
      "Criterion (d). Each of these is tested against the barangay's own province rather than against a national standard, so the count beneath every chart is a count of barangays worse than their province — not of barangays below any absolute threshold.",
  },
];

export function IndicatorsSection({
  dists,
  areaLabel,
  nListed,
  coverageHref,
  criteriaHref,
}: {
  dists: UucPhcIndicatorDist[];
  areaLabel: string;
  /** From `agg_uuc_phc_counts`, not from the distributions — see the note on the empty state. */
  nListed: number;
  /** The matching coverage page: which barangays these are. */
  coverageHref: string;
  /** The matching criteria page: which route carried them onto the list. */
  criteriaHref: string;
}) {
  if (nListed === 0) {
    // An empty state, not an empty chart. Twelve axes with no bars on them would read as twelve
    // failed loads; the list is national and complete as published, so this is a result.
    return (
      <div className="rounded-lg border border-border bg-background p-5 text-sm text-muted sm:p-6">
        <p>
          No barangay in {areaLabel} is on the 2025 list, so there are no indicator values to
          distribute. The list is national and complete as published, so this is a result rather
          than missing data.
        </p>
        <Link href={coverageHref} className="mt-3 inline-block underline hover:text-accent">
          ← Back to the list for {areaLabel}
        </Link>
      </div>
    );
  }

  // Said once, for the whole health group, rather than under each of its seven charts: criterion
  // (d) compares a barangay against its own province, so an area spanning several provinces has no
  // single line to draw. That is a property of the area, not a gap in the data.
  const spansProvinces = dists.some(
    (dist) => dist.meta.group === "health" && dist.benchmark === "aggregate",
  );

  return (
    <>
      {GROUPS.map((group) => {
        const groupDists = dists.filter((dist) => dist.meta.group === group.key);
        if (groupDists.length === 0) return null;

        return (
          <PresentationSlide key={group.id} id={group.id} title={group.heading}>
            <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-lg font-semibold tracking-tight">{group.heading}</h2>
                <p className="text-sm text-muted">
                  {formatCount(nListed)} listed barangay{nListed === 1 ? "" : "s"} in {areaLabel}
                </p>
              </div>
              <p className="mt-2 max-w-2xl text-sm text-muted">{group.blurb}</p>

              {group.key === "health" && spansProvinces && (
                <p className="mt-3 rounded-md bg-surface px-4 py-3 text-sm text-muted">
                  No provincial benchmark is drawn on these charts: {areaLabel} spans more than one
                  province, and criterion (d) tests each barangay against its own, so there is no
                  single line to draw here. The benchmark appears on province and city/municipality
                  pages, where one province&rsquo;s figure applies to every barangay on the chart.
                </p>
              )}

              <div className="mt-4 border-t border-border">
                {groupDists.map((dist) => (
                  <IndicatorHistogram key={dist.meta.key} dist={dist} areaLabel={areaLabel} />
                ))}
              </div>
            </section>
          </PresentationSlide>
        );
      })}

      {/* The refusal, stated. U3 declined to publish indicator aggregates because a mean absorbs
          the bounded ceilings; this page publishes distributions instead, and building it without
          saying why there is no average would re-open the hole U3 closed. */}
      <p className="rounded-lg border border-border bg-surface px-5 py-4 text-xs text-muted sm:px-6">
        <strong className="font-medium text-foreground">
          There is no average on this page, and that is deliberate.
        </strong>{" "}
        1,584 of these values were recorded outside any possible range and bounded during cleaning,
        so they are ceilings the source overshot rather than measurements. A mean or a median
        dissolves them into one figure that asserts coverage the data does not support; a
        distribution keeps every value at its own position and lets the bounded ones be counted
        where they land.{" "}
        <Link href="/uuc-phc/data-quality" className="underline hover:text-accent">
          What was bounded, and what else is known to be wrong
        </Link>
        {" · "}
        <Link href="/uuc-phc/methodology" className="underline hover:text-accent">
          Methodology
        </Link>
        {" · "}
        <Link href={criteriaHref} className="underline hover:text-accent">
          Which route carried these barangays
        </Link>
        {" · "}
        <Link href={coverageHref} className="underline hover:text-accent">
          Which barangays these are
        </Link>
      </p>
    </>
  );
}
