import type { Metadata } from "next";
import Link from "next/link";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import {
  NHFR_BRAND_LABEL,
  getNhfrCounts,
  getNhfrChildren,
  getNhfrTypes,
  nhfrCaption,
} from "@/lib/db/nhfr";
import { formatCount } from "@/lib/format";
import { FacilityStats } from "@/components/facilities/facility-stats";
import { CoverageBar } from "@/components/facilities/coverage-bar";
import { ChildBreakdown } from "@/components/facilities/child-breakdown";
import { TypeBreakdown } from "@/components/facilities/type-breakdown";
import { AskFacilities } from "@/components/facilities/ask-facilities";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentationSlide } from "@/components/present/presentation-slide";
import { PresentButton } from "@/components/present/present-button";

// 1 hour, matching the other sections and for the same reason: the page is statically
// prerendered, so a transient empty read during (re)generation would otherwise cache an
// "unavailable" state.
export const revalidate = 3_600;

export const metadata: Metadata = {
  title: { absolute: "Health facilities · Overview" },
  description:
    "The DOH National Health Facility Registry, September 2026: 44,799 health facilities across the Philippines, and how many of each area's barangays have one.",
};

export default async function FacilitiesLanding() {
  const [counts, children, types] = await Promise.all([
    getNhfrCounts(NATIONAL_GEO_CODE, "national"),
    getNhfrChildren(NATIONAL_GEO_CODE, "national"),
    getNhfrTypes(NATIONAL_GEO_CODE, "national"),
  ]);

  if (!counts) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Health facilities</h1>
        <p className="text-muted">This dataset is not available right now.</p>
      </div>
    );
  }

  const withoutFacility = Math.max(0, counts.nBarangays - counts.nBarangaysWithFacility);

  // Title-slide facts for presentation mode (serializable, server → client). brandLabel keeps the
  // deck from presenting this dataset under the BHW Census's name (UUC_PHC_BRAND_LABEL's
  // precedent).
  const deckMeta = {
    pageLabel: "National overview",
    areaName: "Philippines",
    filterChips: [] as string[],
    captionLine: nhfrCaption(counts, "Philippines"),
    brandLabel: NHFR_BRAND_LABEL,
  };

  return (
    <PresentationProvider meta={deckMeta}>
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Where are the health facilities?
          </h1>
          <p className="max-w-2xl text-muted">
            The Department of Health maintains a{" "}
            <strong>National Health Facility Registry</strong> — every hospital, rural health
            unit, barangay health station, clinic and laboratory it registers, with the barangay
            each one sits in. This is the September 2026 snapshot, shown alongside the BHW
            workforce that staffs much of it.
          </p>
          <PresentButton variant="secondary" />
        </section>

        <PresentationSlide id="coverage" title="Barangays with at least one facility">
          <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <FacilityStats counts={counts} />
              <h2 className="text-lg font-semibold tracking-tight text-muted">Philippines</h2>
            </div>
            <div className="mt-6 border-t border-border pt-5">
              <h2 className="text-sm font-semibold">Barangays with at least one facility</h2>
              <div className="mt-3">
                <CoverageBar counts={counts} />
              </div>
              <p className="mt-3 text-xs text-muted">
                {formatCount(withoutFacility)} barangays have no registered health facility at
                all.
              </p>
            </div>
          </section>
        </PresentationSlide>

        <PresentationSlide id="types" title="Facility types">
          <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
            <TypeBreakdown items={types} />
          </div>
        </PresentationSlide>

        <PresentationSlide id="regions" title="By region">
          <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
            <ChildBreakdown heading="Regions" items={children} />
            {children.length > 0 && (
              <p className="mt-3 border-t border-border pt-4 text-xs text-muted">
                Drill into any region for its provinces, cities and municipalities. Sulu&apos;s
                facilities appear under BARMM — the source names them under Region IX, and the{" "}
                <Link href="/facilities/methodology" className="underline hover:text-accent">
                  methodology
                </Link>{" "}
                explains which side these rollups take.
              </p>
            )}
          </div>
        </PresentationSlide>

        <p className="text-sm text-muted">
          See the{" "}
          <Link href="/facilities/methodology" className="underline hover:text-accent">
            methodology
          </Link>{" "}
          for how the {formatCount(counts.nFacilities)} facilities were counted, what the source
          records about licensing, and which columns are deliberately not published here.
        </p>

        <AskFacilities geoCode={NATIONAL_GEO_CODE} geoLevel="national" geoName="Philippines" />
      </div>
    </PresentationProvider>
  );
}
