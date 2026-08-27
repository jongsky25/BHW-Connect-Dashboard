import type { Metadata } from "next";
import Link from "next/link";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import { UUC_PHC_BRAND_LABEL, uucDeckCaption, getUucPhcCounts } from "@/lib/db/uuc-phc";
import { getUucPhcIndicatorDist } from "@/lib/db/uuc-phc-indicator-dist";
import { IndicatorsSection } from "@/components/uuc-phc/indicators-section";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentButton } from "@/components/present/present-button";
import { AskTheList } from "@/components/uuc-phc/ask-the-list";

// 1 hour, matching the rest of the section and for the same reason: the page is statically
// prerendered, so a transient empty read during (re)generation would otherwise cache an
// "unavailable" state.
export const revalidate = 3_600;

export const metadata: Metadata = {
  title: { absolute: "The indicators behind the list · UUC for PHC 2025" },
  description:
    "How the 5,991 barangays on the 2025 UUC for PHC list are distributed across the 12 indicators they were assessed on, with the values bounded during cleaning counted separately. No averages: a mean would hide them.",
};

export default async function UucPhcIndicatorsLanding() {
  const [counts, dists] = await Promise.all([
    getUucPhcCounts(NATIONAL_GEO_CODE, "national"),
    getUucPhcIndicatorDist(NATIONAL_GEO_CODE, "national"),
  ]);

  // `counts` is what says whether anything is listed; `dists` being empty with counts present is a
  // read failure, and the two must not be confused — see the module note on getUucPhcIndicatorDist.
  if (!counts || dists.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">The indicators behind the list</h1>
        <p className="text-muted">These distributions are not available right now.</p>
      </div>
    );
  }

  const deckMeta = {
    pageLabel: "Indicators",
    areaName: "Philippines",
    filterChips: [] as string[],
    captionLine: uucDeckCaption(counts, "Philippines"),
    brandLabel: UUC_PHC_BRAND_LABEL,
  };

  return (
    <PresentationProvider meta={deckMeta}>
      <div className="flex flex-col gap-8">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1 text-sm text-muted"
        >
          <Link href="/uuc-phc" className="hover:text-accent hover:underline">
            Overview
          </Link>
          <span aria-hidden="true">›</span>
          <span className="font-medium text-foreground">Indicators</span>
        </nav>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              The indicators behind the list
            </h1>
            <PresentButton variant="secondary" />
          </div>
          <p className="max-w-2xl text-muted">
            The 12 measurements each listed barangay was assessed on, as distributions rather than
            as figures — every value at its own position, for the whole country and for every
            region, province, city and municipality.
          </p>
        </section>

        <IndicatorsSection
          dists={dists}
          areaLabel="the Philippines"
          nListed={counts.nListed}
          coverageHref="/uuc-phc"
          criteriaHref="/uuc-phc/criteria"
        />

        <AskTheList geoCode={NATIONAL_GEO_CODE} geoLevel="national" geoName="Philippines" />
      </div>
    </PresentationProvider>
  );
}
