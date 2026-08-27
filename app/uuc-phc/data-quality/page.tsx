import type { Metadata } from "next";
import Link from "next/link";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import { getUucPhcIndicatorDist } from "@/lib/db/uuc-phc-indicator-dist";
import {
  getUucPhcBenchmarkGaps,
  getUucPhcPublishedDeltas,
  getUucPhcQualityTotals,
} from "@/lib/db/uuc-phc-quality";
import {
  BenchmarkSection,
  BoundedSection,
  ReconciliationSection,
  UnresolvedSection,
} from "@/components/uuc-phc/quality-sections";
import { AskTheList } from "@/components/uuc-phc/ask-the-list";

// 1 hour, matching the rest of the section. The figures are recomputed by views on every read, so
// this window is about page generation cost rather than about staleness of the underlying facts.
export const revalidate = 3_600;

export const metadata: Metadata = {
  title: { absolute: "Data quality · UUC for PHC 2025" },
  description:
    "What is known to be wrong with the 2025 UUC for PHC indicator data: the values bounded during cleaning, the provincial benchmarks that cannot carry the health comparison, the gap against the published total, and what remains unresolved.",
};

export default async function UucPhcDataQualityPage() {
  const [totals, dists, gaps, deltas] = await Promise.all([
    getUucPhcQualityTotals(),
    getUucPhcIndicatorDist(NATIONAL_GEO_CODE, "national"),
    getUucPhcBenchmarkGaps(),
    getUucPhcPublishedDeltas(),
  ]);

  // An empty data-quality page reads as a clean bill of health, which is the one thing it must
  // never say by accident. If the totals could not be read, say so rather than rendering nothing.
  if (!totals) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Data quality</h1>
        <p className="text-muted">
          These figures are not available right now. That is a failure to load them, not a finding
          that there is nothing to report — what is known about this dataset&rsquo;s quality is
          written up in{" "}
          <Link href="/uuc-phc/methodology" className="underline hover:text-accent">
            the methodology
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-muted">
        <Link href="/uuc-phc" className="hover:text-accent hover:underline">
          Overview
        </Link>
        <span aria-hidden="true">›</span>
        <span className="font-medium text-foreground">Data quality</span>
      </nav>

      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Data quality</h1>
        <p className="max-w-2xl text-muted">
          This dashboard publishes the 2025 list as issued, and what is wrong with the data behind
          it is published alongside rather than left in a file nobody reads. Everything on this page
          is recomputed from the data itself each time it renders — including the figures that make
          this dashboard look worse — so it cannot quietly drift away from what the data actually
          says.
        </p>
      </section>

      <BoundedSection totals={totals} dists={dists} />
      <BenchmarkSection gaps={gaps} />
      <ReconciliationSection deltas={deltas} />
      <UnresolvedSection totals={totals} />

      <AskTheList geoCode={NATIONAL_GEO_CODE} geoLevel="national" geoName="Philippines" />
    </div>
  );
}
