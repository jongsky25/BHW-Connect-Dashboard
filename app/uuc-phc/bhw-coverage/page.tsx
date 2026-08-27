import type { Metadata } from "next";
import Link from "next/link";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import { UUC_PHC_BRAND_LABEL, uucDeckCaption, getUucPhcCounts } from "@/lib/db/uuc-phc";
import { getUucBhwCoverage, getUucBhwCoverageChildren } from "@/lib/db/uuc-phc-bhw-coverage";
import { BhwCoverageSection } from "@/components/uuc-phc/bhw-coverage-section";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentButton } from "@/components/present/present-button";
import { AskTheList } from "@/components/uuc-phc/ask-the-list";

// 1 hour, matching the rest of the section and for the same reason: the page is statically
// prerendered, so a transient empty read during (re)generation would otherwise cache an
// "unavailable" state for the whole window.
export const revalidate = 3_600;

export const metadata: Metadata = {
  title: { absolute: "BHW coverage and the list · UUC for PHC 2025" },
  description:
    "A consistency check, not a finding: how BHW coverage compares between the barangays on the 2025 UUC for PHC list and every other barangay in the same area. UUC status is defined partly on distance to a health facility, so the comparison is partly definitional.",
};

export default async function UucPhcBhwCoverageLanding() {
  const [coverage, counts, children] = await Promise.all([
    getUucBhwCoverage(NATIONAL_GEO_CODE, "national"),
    getUucPhcCounts(NATIONAL_GEO_CODE, "national"),
    getUucBhwCoverageChildren(NATIONAL_GEO_CODE, "national"),
  ]);

  if (!coverage) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">BHW coverage and the list</h1>
        <p className="text-muted">This comparison is not available right now.</p>
      </div>
    );
  }

  const deckMeta = {
    pageLabel: "BHW coverage and the list",
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
          <span className="font-medium text-foreground">BHW coverage</span>
        </nav>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              BHW coverage and the list
            </h1>
            <PresentButton variant="secondary" />
          </div>
          <p className="max-w-2xl text-muted">
            The two datasets on this dashboard meet here: how many households each Barangay Health
            Worker covers in the barangays on the 2025 list, against every other barangay in the
            same area. Read the note below first — the comparison is not the discovery it looks
            like.
          </p>
        </section>

        <BhwCoverageSection
          coverage={coverage}
          areaLabel="the Philippines"
          childHeading="Regions"
          childAreas={children}
          coverageHref="/uuc-phc"
        />

        <AskTheList geoCode={NATIONAL_GEO_CODE} geoLevel="national" geoName="Philippines" />
      </div>
    </PresentationProvider>
  );
}
