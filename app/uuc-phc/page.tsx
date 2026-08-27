import type { Metadata } from "next";
import Link from "next/link";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import {
  UUC_PHC_BRAND_LABEL,
  getUucPhcCounts,
  getUucPhcChildren,
  uucDeckCaption,
} from "@/lib/db/uuc-phc";
import { formatCount } from "@/lib/format";
import { CoverageHero } from "@/components/uuc-phc/coverage-hero";
import { ShareBar } from "@/components/uuc-phc/share-bar";
import { ChildBreakdown } from "@/components/uuc-phc/child-breakdown";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentationSlide } from "@/components/present/presentation-slide";
import { PresentButton } from "@/components/present/present-button";
import { AskTheList } from "@/components/uuc-phc/ask-the-list";

// 1 hour, matching /profiling-status and for the same reason: the page is statically prerendered,
// so a transient empty read during (re)generation would otherwise cache an "unavailable" state.
// This list is republished annually, so nothing is lost by refreshing hourly.
export const revalidate = 3_600;

export const metadata: Metadata = {
  title: { absolute: "UUC for PHC 2025 · Overview" },
  description:
    "The 2025 list of Unserved and Underserved Communities for Primary Health Care: 5,991 barangays across the Philippines, with the share of each region's barangays on the list.",
};

export default async function UucPhcLanding() {
  const [counts, children] = await Promise.all([
    getUucPhcCounts(NATIONAL_GEO_CODE, "national"),
    getUucPhcChildren(NATIONAL_GEO_CODE, "national"),
  ]);

  if (!counts) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">UUC for PHC 2025</h1>
        <p className="text-muted">This dataset is not available right now.</p>
      </div>
    );
  }

  const withAny = children.filter((c) => c.nListed > 0).length;

  // Title-slide facts for presentation mode (serializable, server → client). brandLabel is what
  // keeps the deck from presenting this dataset under the BHW Census's name — see plan U6.
  const deckMeta = {
    pageLabel: "National overview",
    areaName: "Philippines",
    filterChips: [] as string[],
    captionLine: uucDeckCaption(counts, "Philippines"),
    brandLabel: UUC_PHC_BRAND_LABEL,
  };

  return (
    <PresentationProvider meta={deckMeta}>
      <div className="flex flex-col gap-8">
        {/* Hero */}
        <section className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Which barangays are unserved or underserved?
          </h1>
          <p className="max-w-2xl text-muted">
            The Department of Health publishes a list of{" "}
            <strong>Unserved and Underserved Communities for Primary Health Care</strong> —
            barangays that are both hard to reach and socio-economically disadvantaged. A barangay
            qualifies only when <strong>both</strong> a physical and a socio-economic factor are
            present. This is the 2025 edition.
          </p>
          <PresentButton variant="secondary" />
        </section>

        {/* National figure */}
        <PresentationSlide id="coverage" title="Barangays on the 2025 list">
          <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <CoverageHero counts={counts} areaLabel="the Philippines" />
              <h2 className="text-lg font-semibold tracking-tight text-muted">Philippines</h2>
            </div>
            <div className="mt-6">
              <ShareBar counts={counts} />
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-xs text-muted">
                Issued under DC No. 2025-0549 · criteria per DOH AO No. 2020-0023
              </p>
              <a
                href="/api/export/uuc-phc?geoLevel=national&geoCode=PH"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-accent"
              >
                Download summary (PNG)
              </a>
            </div>
          </section>
        </PresentationSlide>

        {/* Region breakdown */}
        <PresentationSlide id="regions" title="By region">
          <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
            <ChildBreakdown heading="Regions" items={children} />
            {children.length > 0 && (
              <p className="mt-3 border-t border-border pt-4 text-xs text-muted">
                {withAny} of {children.length} regions have at least one barangay on the list. Drill
                into any region for its provinces, cities and municipalities.
              </p>
            )}
          </div>
        </PresentationSlide>

        <p className="text-sm text-muted">
          See{" "}
          <Link href="/uuc-phc/criteria" className="underline hover:text-accent">
            why these barangays qualified
          </Link>{" "}
          for the four routes onto the list,{" "}
          <Link href="/uuc-phc/indicators" className="underline hover:text-accent">
            the indicators behind it
          </Link>{" "}
          for how the 12 measurements are distributed,{" "}
          <Link href="/uuc-phc/bhw-coverage" className="underline hover:text-accent">
            BHW coverage and the list
          </Link>{" "}
          for how the two datasets here compare, or the{" "}
          <Link href="/uuc-phc/methodology" className="underline hover:text-accent">
            methodology
          </Link>{" "}
          for how the {formatCount(counts.nListed)} barangays were counted.
        </p>

        <AskTheList geoCode={NATIONAL_GEO_CODE} geoLevel="national" geoName="Philippines" />
      </div>
    </PresentationProvider>
  );
}
