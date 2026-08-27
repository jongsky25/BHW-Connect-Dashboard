import type { Metadata } from "next";
import Link from "next/link";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import { UUC_PHC_BRAND_LABEL, uucDeckCaption, getUucPhcCounts } from "@/lib/db/uuc-phc";
import { getUucPhcCriteria, getUucPhcCriteriaChildren } from "@/lib/db/uuc-phc-criteria";
import { CriteriaSection } from "@/components/uuc-phc/criteria-section";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentButton } from "@/components/present/present-button";
import { AskTheList } from "@/components/uuc-phc/ask-the-list";

// 1 hour, matching the rest of the section and for the same reason: the page is statically
// prerendered, so a transient empty read during (re)generation would otherwise cache an
// "unavailable" state.
export const revalidate = 3_600;

export const metadata: Metadata = {
  title: { absolute: "Why these barangays qualified · UUC for PHC 2025" },
  description:
    "How the 5,991 barangays on the 2025 UUC for PHC list qualified: Indigenous Peoples, conflict and displacement, 4Ps enrolment, and health indicators against the province. The four routes overlap.",
};

export default async function UucPhcCriteriaLanding() {
  const [criteria, counts, children] = await Promise.all([
    getUucPhcCriteria(NATIONAL_GEO_CODE, "national"),
    getUucPhcCounts(NATIONAL_GEO_CODE, "national"),
    getUucPhcCriteriaChildren(NATIONAL_GEO_CODE, "national"),
  ]);

  if (!criteria) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Why these barangays qualified</h1>
        <p className="text-muted">This breakdown is not available right now.</p>
      </div>
    );
  }

  const deckMeta = {
    pageLabel: "Qualifying criteria",
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
          <span className="font-medium text-foreground">Qualifying criteria</span>
        </nav>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Why these barangays qualified
            </h1>
            <PresentButton variant="secondary" />
          </div>
          <p className="max-w-2xl text-muted">
            DOH AO No. 2020-0023 sets four socio-economic routes onto the list, and a barangay needs
            only one of them alongside the physical factor. This is how many barangays came in on
            each — nationally, and for every region, province, city and municipality.
          </p>
        </section>

        <CriteriaSection
          criteria={criteria}
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
