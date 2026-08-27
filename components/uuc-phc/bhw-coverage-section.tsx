import Link from "next/link";
import { formatCount } from "@/lib/format";
import {
  coverageDirection,
  sizeExplanation,
  type UucBhwCoverage,
  type UucBhwCoverageChild,
  type UucBhwSide,
} from "@/lib/db/uuc-phc-bhw-coverage";
import { PresentationSlide } from "@/components/present/presentation-slide";

/**
 * The body of `/uuc-phc/bhw-coverage` (plan §9 U12b), shared by the national page and the per-area
 * page so the two cannot drift into saying different things about the same aggregate.
 *
 * **The caveat leads, and that is the increment's whole shape.** UUC membership is defined partly
 * on distance to a health facility, so a BHW coverage gap between listed and unlisted barangays is
 * partly definitional. The owner's framing is that this page asks whether coverage is *consistent
 * with what the list already implies* — and the reportable finding is the **exception**, not the
 * average. Every block below is arranged to make the average hard to quote out of context and the
 * exception easy to find.
 */

const DASH = "—";

/** A derived ratio, or the dash. The unit is the `<dt>` beside it, never part of the value. */
function ratioLabel(value: number | null): string {
  return value === null ? DASH : value.toLocaleString();
}

/** One side's figures. The headline ratio sits above the two per-barangay ones it must be read
 * against, in that order, because the size explanation is not a footnote to the headline — it is
 * most of the headline. */
function SideCard({
  label,
  sublabel,
  side,
  emphasis,
}: {
  label: string;
  sublabel: string;
  side: UucBhwSide;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex-1 rounded-lg border p-4 ${
        emphasis ? "border-accent/40 bg-accent-subtle/30" : "border-border bg-surface"
      }`}
    >
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs text-muted">{sublabel}</p>
      <p className="mt-3 text-3xl font-semibold tabular-nums leading-none">
        {side.householdsPerBhw === null ? DASH : side.householdsPerBhw.toLocaleString()}
      </p>
      <p className="mt-1 text-xs text-muted">households per BHW</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
        <div>
          <dt className="text-muted">Barangays</dt>
          <dd className="tabular-nums font-medium">{formatCount(side.nBarangays)}</dd>
        </div>
        <div>
          <dt className="text-muted">BHWs</dt>
          <dd className="tabular-nums font-medium">{formatCount(side.nBhw)}</dd>
        </div>
        <div>
          <dt className="text-muted">BHWs per barangay</dt>
          <dd className="tabular-nums font-medium">{ratioLabel(side.bhwPerBarangay)}</dd>
        </div>
        <div>
          <dt className="text-muted">Households per barangay</dt>
          <dd className="tabular-nums font-medium">{ratioLabel(side.householdsPerBarangay)}</dd>
        </div>
        <div>
          <dt className="text-muted">With no BHW at all</dt>
          <dd className="tabular-nums font-medium">{formatCount(side.nNoBhw)}</dd>
        </div>
        <div>
          <dt className="text-muted">Individually profiled</dt>
          <dd className="tabular-nums font-medium">
            {side.profilingCoveragePct === null ? DASH : `${side.profilingCoveragePct.toFixed(1)}%`}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function BhwCoverageSection({
  coverage,
  areaLabel,
  childHeading,
  childAreas,
  coverageHref,
}: {
  coverage: UucBhwCoverage;
  areaLabel: string;
  childHeading: string | null;
  /** Not named `children`: data for a table, not slot content. */
  childAreas: UucBhwCoverageChild[];
  /** The matching page on the section's existing coverage drill-down. */
  coverageHref: string;
}) {
  const { comparison } = coverage;
  const direction = coverageDirection(comparison);
  const size = sizeExplanation(comparison);

  return (
    <>
      {/* The definitional caveat, before any figure. Not a footnote: a reader who takes only the
          first block away from this page must take *this* one. */}
      <section className="rounded-lg border border-warning/40 bg-warning/5 p-5 sm:p-6">
        <h2 className="text-base font-semibold tracking-tight">
          This is a consistency check, not a finding
        </h2>
        <p className="mt-2 max-w-3xl text-sm">
          A barangay reaches the 2025 list partly on <strong>distance to a health facility</strong>{" "}
          — the physical factor of DOH AO No. 2020-0023. Health-system access is therefore part of
          the definition of being on this list, so any difference in BHW coverage between listed and
          unlisted barangays is <strong>partly definitional rather than a discovery</strong>. That
          holds in both directions: &ldquo;unserved barangays have fewer BHWs&rdquo; and
          &ldquo;unserved barangays have more BHWs&rdquo; are equally circular as headlines.
        </p>
        <p className="mt-2 max-w-3xl text-sm">
          What this page can honestly ask is narrower:{" "}
          <em>is BHW coverage consistent with what the list already implies?</em> The figure worth
          acting on is the <strong>exception</strong> — an area where the direction reverses against
          the national pattern — not the average gap.
        </p>
      </section>

      <PresentationSlide id="bhw-coverage" title="BHW coverage, listed vs. all other barangays">
        <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold tracking-tight">BHW coverage in {areaLabel}</h2>
            <p className="text-sm text-muted">StepZero headcount, every barangay</p>
          </div>

          {comparison.kind === "comparable" && (
            <>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <SideCard
                  label="On the 2025 UUC for PHC list"
                  sublabel={`${formatCount(comparison.listed.nBarangays)} barangays`}
                  side={comparison.listed}
                  emphasis
                />
                <SideCard
                  label="All other barangays"
                  sublabel={`${formatCount(comparison.other.nBarangays)} barangays`}
                  side={comparison.other}
                />
              </div>

              {/* The compositional explanation, computed from the same two numbers as the
                  headline. Without it "listed barangays have better coverage" is a claim about
                  BHW deployment; with it, it is mostly a fact about barangay size. */}
              {size && (
                <div className="mt-4 rounded-md border border-border bg-surface p-4 text-sm">
                  <p className="font-medium">Most of that difference is barangay size.</p>
                  <p className="mt-1 text-muted">
                    Listed barangays here hold{" "}
                    <strong className="text-foreground tabular-nums">
                      {size.householdsPerBarangayRatio}&times;
                    </strong>{" "}
                    the households of the others and carry{" "}
                    <strong className="text-foreground tabular-nums">
                      {size.bhwPerBarangayRatio}&times;
                    </strong>{" "}
                    the BHWs each. Households per BHW is a ratio of those two, so a difference in
                    barangay size moves it on its own — without anything about where BHWs are
                    deployed having changed.
                  </p>
                </div>
              )}

              <p className="mt-4 text-sm">
                {direction === "thinner" && (
                  <>
                    <strong>This area runs against the national pattern.</strong> Its listed
                    barangays carry <em>more</em> households per BHW than the rest of it — the
                    direction the list&rsquo;s own criteria do not already account for, and the case
                    this page exists to surface.
                  </>
                )}
                {direction === "thicker" && (
                  <>
                    Listed barangays here carry <em>fewer</em> households per BHW than the rest of
                    the area — the same direction as the national picture, and the one the
                    definitional overlap and the size difference above between them explain.
                  </>
                )}
                {direction === "even" && (
                  <>
                    The two groups carry the same households per BHW, to the tenth of a household
                    this site publishes.
                  </>
                )}
              </p>
            </>
          )}

          {comparison.kind === "nothing-listed" && (
            <p className="mt-4 max-w-2xl text-sm text-muted">
              No barangay in {areaLabel} is on the 2025 UUC for PHC list, so there are not two
              groups to compare. That is a result, not missing data — the list is national and
              complete in a single publication.
            </p>
          )}

          {comparison.kind === "all-listed" && (
            <p className="mt-4 max-w-2xl text-sm text-muted">
              Every barangay in {areaLabel} is on the 2025 UUC for PHC list, so there is no other
              group to compare it against. Its coverage figures are the area&rsquo;s own, which the{" "}
              <Link href={coverageHref} className="underline hover:text-accent">
                coverage page
              </Link>{" "}
              already carries.
            </p>
          )}

          {comparison.kind === "suppressed" && (
            <p className="mt-4 max-w-2xl text-sm text-muted">
              Only a handful of barangays in {areaLabel} fall on the{" "}
              {comparison.suppressedSide === "listed" ? "listed" : "unlisted"} side — fewer than
              five — so no comparison is drawn. Rendering one, two or three barangays as a group
              statistic and setting it beside a group of hundreds would be a claim about a group,
              made from something that is not one.
            </p>
          )}

          {(coverage.unallocatedNBhw > 0 || coverage.unallocatedHouseholds > 0) && (
            <p className="mt-4 border-t border-border pt-4 text-xs text-muted">
              <strong className="text-foreground">
                {formatCount(coverage.unallocatedNBhw)} BHW
                {coverage.unallocatedNBhw === 1 ? "" : "s"} and{" "}
                {formatCount(coverage.unallocatedHouseholds)} household
                {coverage.unallocatedHouseholds === 1 ? "" : "s"}
              </strong>{" "}
              in this area&rsquo;s published quick-count total sit in neither group: the quick count
              carries them above barangay level only, so there is no barangay to attach a list
              status to. They are stated rather than absorbed — the two groups plus this figure are
              the area total exactly.
            </p>
          )}

          <p className="mt-4 border-t border-border pt-4 text-xs text-muted">
            Built from the StepZero quick count, which covers every one of the country&rsquo;s
            barangays, and <strong>not</strong> from the individually-profiled census. Listed
            barangays are remote by construction and so are plausibly also less profiled — splitting
            a profiled figure by list status would measure profiling progress and report it as BHW
            supply. The &ldquo;individually profiled&rdquo; row on each card is there so that
            difference is visible rather than acting unseen.{" "}
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
        <PresentationSlide id="bhw-coverage-children" title={childHeading}>
          <CoverageBreakdown heading={childHeading} items={childAreas} />
        </PresentationSlide>
      )}
    </>
  );
}

/**
 * The child breakdown, ordered so the exception leads.
 *
 * Every other table in this section sorts by how *affected* an area is. This one sorts by how far
 * it runs against the national pattern, because that is the only thing on this page the list's own
 * criteria do not already account for — the areas where listed barangays carry more households per
 * BHW than the rest of the area. Areas that cannot be compared keep their rows and say why, on the
 * section's rule that a dropped row makes an incomplete-looking table out of complete data.
 */
export function CoverageBreakdown({
  heading,
  items,
}: {
  heading: string;
  items: UucBhwCoverageChild[];
}) {
  if (items.length === 0) return null;

  const rows = items.map((item) => {
    const c = item.comparison;
    const listed = c.kind === "comparable" ? c.listed.householdsPerBhw : null;
    const other = c.kind === "comparable" ? c.other.householdsPerBhw : null;
    // The gap in households per BHW, listed minus other. Positive is the exception.
    const gap = listed !== null && other !== null ? Math.round((listed - other) * 10) / 10 : null;
    return { item, listed, other, gap, direction: coverageDirection(c) };
  });

  // Exceptions first, largest gap leading; then the rest by gap; then the rows with no comparison,
  // which keep their place at the foot rather than being filtered away.
  const sorted = [...rows].sort((a, b) => {
    if (a.gap === null && b.gap === null) return 0;
    if (a.gap === null) return 1;
    if (b.gap === null) return -1;
    return b.gap - a.gap;
  });

  const nExceptions = rows.filter((r) => r.direction === "thinner").length;

  return (
    <section
      aria-label={heading}
      className="rounded-lg border border-border bg-background p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
        <span className="text-xs text-muted">
          {nExceptions === 0
            ? "No area here runs against the pattern"
            : `${nExceptions} area${nExceptions === 1 ? "" : "s"} against the pattern, first`}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Area
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Listed
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                All others
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Difference
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ item, listed, other, gap, direction }) => (
              <tr key={item.geoCode} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <Link
                    href={`/uuc-phc/bhw-coverage/${item.geoLevel}/${item.geoCode}`}
                    className="font-medium hover:text-accent hover:underline"
                  >
                    {item.geoName}
                  </Link>
                  {direction === "thinner" && (
                    <span className="ml-2 inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[0.65rem] font-medium text-warning">
                      Against the pattern
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {listed === null ? DASH : listed.toLocaleString()}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted">
                  {other === null ? DASH : other.toLocaleString()}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {gap === null ? (
                    <span className="text-xs text-muted">
                      {item.comparison.kind === "nothing-listed"
                        ? "none listed"
                        : item.comparison.kind === "all-listed"
                          ? "all listed"
                          : "too few to compare"}
                    </span>
                  ) : (
                    <span className={gap > 0 ? "font-medium text-warning" : ""}>
                      {gap > 0 ? "+" : ""}
                      {gap.toLocaleString()}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Households per BHW, listed barangays against all other barangays in the same area. A
        positive difference means the listed barangays carry the heavier load — the direction the
        list&rsquo;s own criteria do not already account for.
      </p>
    </section>
  );
}
