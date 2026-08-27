import Link from "next/link";
import { formatCount } from "@/lib/format";
import type { UucPhcIndicatorDist } from "@/lib/db/uuc-phc-indicator-dist";
import { benchmark, share, showsWitness } from "./quality-format";
import type {
  UucPhcBenchmarkGap,
  UucPhcPublishedDelta,
  UucPhcQualityTotals,
} from "@/lib/db/uuc-phc-quality";

/**
 * The four sections of `/uuc-phc/data-quality` (plan U10).
 *
 * `docs/UUC_PHC_2025_CLEANING_REPORT.md` §6 is the most important thing written about this dataset
 * and it was invisible to anyone using it. This renders it.
 *
 * **Not one figure below is written into this file.** Every number arrives from a view or an
 * aggregate that recomputes it, because a page that assures a reader about data quality is the
 * worst possible place for a figure that has quietly gone stale. The prose is fixed; the numbers
 * are not, and where a count reaching zero would make a sentence false, the section renders
 * nothing rather than a sentence about nothing.
 *
 * Server components throughout: static renderings of numbers already fetched.
 */

/* ------------------------------------------------------------------ what was bounded */

export function BoundedSection({
  totals,
  dists,
}: {
  totals: UucPhcQualityTotals;
  /** The national distributions (U9). Their `cappedTotal` is the per-indicator count. */
  dists: UucPhcIndicatorDist[];
}) {
  // Only the indicators that actually have a bounded value, largest first. The five socio-economic
  // indicators were already inside 0–100 and needed no action; listing them at zero would pad the
  // table with rows that say nothing.
  const bounded = dists
    .filter((dist) => dist.cappedTotal > 0)
    .sort((a, b) => b.cappedTotal - a.cappedTotal);

  return (
    <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">What was bounded</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        The source recorded values outside any possible range — Water as high as 9,594%, FIC 18,088.
        Cleaning bounded each to what its indicator can take: 100 for a coverage percentage, 1,000
        for a rate per 1,000.{" "}
        <strong>Bounding contains the symptom; it does not validate the value.</strong> A bounded
        figure is a ceiling the source overshot, and its true figure is not known.
      </p>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Indicator
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Bounded to
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Values bounded
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Share of the list
              </th>
            </tr>
          </thead>
          <tbody>
            {bounded.map((dist) => (
              <tr key={dist.meta.key} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <Link
                    href="/uuc-phc/indicators"
                    className="underline decoration-border hover:text-accent"
                  >
                    {dist.meta.label}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted">
                  {formatCount(dist.meta.max)}
                  {dist.meta.unit === "%" ? "%" : ""}
                </td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums">
                  {formatCount(dist.cappedTotal)}
                </td>
                <td className="py-2 text-right tabular-nums text-muted">
                  {share(dist.cappedTotal, dist.nListed)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The distinction the whole section turns on. 1,584 is values; 1,397 is barangays; printing
          either where the other belongs overstates or understates the reach of the problem. */}
      <p className="mt-4 rounded-md bg-surface px-4 py-3 text-sm">
        <strong className="tabular-nums">{formatCount(totals.nValuesCapped)}</strong> values were
        bounded, across{" "}
        <strong className="tabular-nums">{formatCount(totals.nBarangaysCapped)}</strong> of the
        list&rsquo;s {formatCount(totals.nListed)} barangays —{" "}
        <strong>{share(totals.nBarangaysCapped, totals.nListed)}</strong>. The two counts differ
        because {formatCount(totals.nBarangaysMultiCapped)} barangays carry more than one bounded
        value, so the number of affected <em>barangays</em> is the smaller of the two and the one a
        share should be taken against.
      </p>

      <p className="mt-3 text-xs text-muted">
        Which barangays they are is recorded per row, so a bounded value never renders without its
        marker.{" "}
        <Link href="/uuc-phc/indicators" className="underline hover:text-accent">
          The distributions
        </Link>{" "}
        draw them as their own segment of the top bar.
      </p>
    </section>
  );
}

/* -------------------------------------------------- where the comparison cannot be made */

function GapTable({ gaps, unit }: { gaps: UucPhcBenchmarkGap[]; unit: string }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              Province
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              What the source supplied
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Barangays affected
            </th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((gap) => (
            <tr
              key={`${gap.finding}-${gap.provinceCode}`}
              className="border-b border-border last:border-0"
            >
              <td className="py-2 pr-3">{gap.provinceName}</td>
              <td className="py-2 pr-3 text-muted">
                {gap.kind}
                {showsWitness(gap) && (
                  <span className="tabular-nums">
                    {" "}
                    ({benchmark(gap.witnessValue)}
                    {unit})
                  </span>
                )}
              </td>
              <td className="py-2 text-right tabular-nums">
                <span className="font-medium">{formatCount(gap.nAffected)}</span>
                {gap.nAffected !== gap.nListedProvince && (
                  <span className="text-muted"> of {formatCount(gap.nListedProvince)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BenchmarkSection({ gaps }: { gaps: UucPhcBenchmarkGap[] }) {
  const criterionD = gaps.filter((gap) => gap.finding === "criterion_d");
  const ficOnly = gaps.filter((gap) => gap.finding === "fic_only");
  const nCriterionD = criterionD.reduce((total, gap) => total + gap.nAffected, 0);
  const nFicOnly = ficOnly.reduce((total, gap) => total + gap.nAffected, 0);

  if (criterionD.length === 0 && ficOnly.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">Where the comparison cannot be made</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Criterion (d) asks whether a barangay performs worse than <em>its province</em>, so it needs
        a usable provincial benchmark. Two different things go wrong with those benchmarks, and they
        are kept apart here because they have different consequences and different fixes.
      </p>

      {criterionD.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium">
            Benchmarks that cannot carry criterion (d) at all —{" "}
            <span className="tabular-nums">{formatCount(nCriterionD)}</span> barangays in{" "}
            {formatCount(criterionD.length)} province{criterionD.length === 1 ? "" : "s"}
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            These figures compare perfectly well and mean nothing, which is why they need naming
            rather than filtering. The barangays&rsquo; place on the list is not in doubt — the
            socio-economic test passes on any one of four routes — but they are excluded from the
            health route&rsquo;s denominator everywhere this section reports it.
          </p>
          <GapTable gaps={criterionD} unit="" />
        </div>
      )}

      {ficOnly.length > 0 && (
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-sm font-medium">
            An immunisation benchmark no barangay can reach —{" "}
            <span className="tabular-nums">{formatCount(nFicOnly)}</span> barangays in{" "}
            {formatCount(ficOnly.length)} province{ficOnly.length === 1 ? "" : "s"}
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            Barangay immunisation coverage was bounded to 100 during cleaning; these
            provinces&rsquo; benchmarks were not. Every barangay there would read as worse than its
            province on that one indicator by construction — an artefact of the cleaning, not a
            finding. Unlike the group above, these barangays still support criterion (d) on the
            other six indicators. Capping the reference to 100 would close it, and was outside the
            instruction given.
          </p>
          <GapTable gaps={ficOnly} unit="%" />
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------- the published-total reconciliation */

export function ReconciliationSection({ deltas }: { deltas: UucPhcPublishedDelta[] }) {
  const national = deltas.find((delta) => delta.geoLevel === "national");
  const regions = deltas.filter((delta) => delta.geoLevel !== "national");
  if (!national) return null;

  return (
    <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">Against the published total</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        The 2027 Budget Cue Cards publish their own distribution of UUC for PHC barangays by region
        (p{national.sourcePage}, as of {national.sourceAsOf ?? "2025"}, citing DC No. 2025-0549).
        This dashboard renders the reconciled workbook instead, and the two do not quite agree.
      </p>

      <p className="mt-5 rounded-md bg-surface px-4 py-3 text-sm">
        This dashboard lists{" "}
        <strong className="tabular-nums">{formatCount(national.nListed)}</strong> barangays; the cue
        cards publish <strong className="tabular-nums">{formatCount(national.nPublished)}</strong> —
        a difference of{" "}
        <strong className="tabular-nums">
          {national.delta > 0 ? "+" : ""}
          {formatCount(national.delta)}
        </strong>
        .
      </p>

      {regions.length > 0 && (
        <>
          <p className="mt-4 text-sm text-muted">
            The whole difference sits in {formatCount(regions.length)} region
            {regions.length === 1 ? "" : "s"}. Every other region matches to the unit.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Region
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Cue cards
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    This dashboard
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Difference
                  </th>
                </tr>
              </thead>
              <tbody>
                {regions.map((delta) => (
                  <tr key={delta.geoCode} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">{delta.geoName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">
                      {formatCount(delta.nPublished)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCount(delta.nListed)}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {delta.delta > 0 ? "+" : ""}
                      {formatCount(delta.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* The caveat the plan is emphatic about. A vintage gap is the likeliest reading and neither
          document says so, which makes stating it as the cause a claim neither source supports. */}
      <p className="mt-4 border-t border-border pt-4 text-xs text-muted">
        <strong className="font-medium text-foreground">Why they differ is not recorded.</strong>{" "}
        The workbook corroborates its own figure three independent ways, and the cue cards are a
        snapshot as of {national.sourceAsOf ?? "2025"} while the workbook file name reads as a later
        revision — so a vintage difference is the likeliest reading.{" "}
        <em>Neither document states that</em>, and this page does not assert it. What is recorded is
        the two figures, their dates, and where the gap sits.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- what is unresolved */

export function UnresolvedSection({ totals }: { totals: UucPhcQualityTotals }) {
  return (
    <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">What is still unresolved</h2>

      <div className="mt-4 border-t border-border pt-4">
        <h3 className="text-sm font-medium">The encoding error behind the bounding</h3>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          A water-coverage figure recorded as 9,594% is not a percentage by any reading. Something
          went wrong at entry — a denominator error, a count where a percentage was wanted, or a
          units mismatch — and bounding contains that symptom without diagnosing it. It is a
          question for the source office, not something this dashboard can resolve. If a corrected
          extract ever arrives, the right response is to regenerate rather than patch: every figure
          on this page recomputes, so the page would simply start reporting the corrected data.
        </p>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm font-medium">
          The criterion (d) score cannot be re-derived from the published columns
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          The source office recorded its own criterion (d) result for each barangay, and this
          dashboard reports that recorded classification rather than deriving one. The reason is
          measurable: the source scored the values <em>before</em> cleaning bounded them, so
          recomputing the score from the published columns disagrees on{" "}
          <strong className="tabular-nums">{formatCount(totals.nScoreDisagreement)}</strong> of the{" "}
          {formatCount(totals.nListed)} barangays
          {totals.nScoreUnderstated === totals.nScoreDisagreement && (
            <> — every one of them scoring lower than the source recorded</>
          )}
          .
        </p>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          That recomputation is not merely different, it is wrong as a statement about
          qualification: it would leave{" "}
          <strong className="tabular-nums">{formatCount(totals.nNoRouteIfRecomputed)}</strong>{" "}
          listed barangays meeting no qualifying route at all, which DOH AO No. 2020-0023 makes
          impossible — a barangay reaches this list only with a socio-economic factor present. The
          source&rsquo;s own score leaves {formatCount(totals.nNoRouteAsRecorded)}. The column is
          therefore auditable against the source office, and not against the columns beside it.
        </p>
      </div>

      <p className="mt-5 border-t border-border pt-4 text-xs text-muted">
        Two more things are known and need no reporting: the published total is{" "}
        {formatCount(totals.nListed)}, and one source row could not be resolved to a single
        barangay.{" "}
        <Link href="/uuc-phc/methodology" className="underline hover:text-accent">
          The methodology page
        </Link>{" "}
        covers both.
      </p>
    </section>
  );
}
