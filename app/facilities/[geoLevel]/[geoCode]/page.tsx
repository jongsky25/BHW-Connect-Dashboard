import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PORTAL_CRUMB, FACILITIES_CRUMB } from "@/lib/nav/breadcrumbs";
import { getGeoAncestors, getGeoByCode } from "@/lib/db/geo";
import {
  NHFR_BRAND_LABEL,
  getNhfrChildren,
  getNhfrCounts,
  getNhfrFacilities,
  getNhfrStaticParams,
  getNhfrTypes,
  nhfrCaption,
} from "@/lib/db/nhfr";
import { GEO_LEVELS, type GeoLevel } from "@/lib/filters/schema";
import { formatCount } from "@/lib/format";
import { FacilityStats } from "@/components/facilities/facility-stats";
import { CoverageBar } from "@/components/facilities/coverage-bar";
import { ChildBreakdown } from "@/components/facilities/child-breakdown";
import { TypeBreakdown } from "@/components/facilities/type-breakdown";
import { FacilityList } from "@/components/facilities/facility-list";
import { AskFacilities } from "@/components/facilities/ask-facilities";
import { AiInsight } from "@/components/narrative/ai-insight";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentationSlide } from "@/components/present/presentation-slide";
import { PresentButton } from "@/components/present/present-button";

// 1 hour. ISR: citymun render on demand; region/province are prerendered. Same reasoning as the
// landing page — a shorter window bounds how long a transient empty read can stay cached.
export const revalidate = 3_600;

const CHILD_HEADING: Record<GeoLevel, string | null> = {
  national: "Regions",
  region: "Provinces",
  province: "Cities / municipalities",
  citymun: null, // handled by FacilityList — the aggregate stops at citymun
  barangay: null,
};

type Params = { geoLevel: string; geoCode: string };

export async function generateStaticParams() {
  const params = await getNhfrStaticParams();
  return params.map((p) => ({ geoLevel: p.geoLevel, geoCode: p.geoCode }));
}

function isGeoLevel(value: string): value is GeoLevel {
  return (GEO_LEVELS as readonly string[]).includes(value);
}

async function loadGeo(params: Params) {
  if (!isGeoLevel(params.geoLevel)) return null;
  const geo = await getGeoByCode(params.geoCode);
  if (!geo || geo.geoLevel !== params.geoLevel) return null;
  return geo;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const geo = await loadGeo(await params);
  if (!geo) return { title: "Area not found" };

  const counts = await getNhfrCounts(geo.geoCode, geo.geoLevel);
  const description = counts
    ? `${formatCount(counts.nFacilities)} health facilities on the DOH registry in ${
        geo.geoName
      }, across ${formatCount(counts.nBarangaysWithFacility)} of ${formatCount(
        counts.nBarangays,
      )} barangays (NHFR, September 2026).`
    : `Health facilities in ${geo.geoName} (NHFR, September 2026).`;

  return { title: geo.geoName, description };
}

export default async function FacilitiesAreaPage({ params }: { params: Promise<Params> }) {
  const geo = await loadGeo(await params);
  if (!geo) notFound();

  // A barangay page would restate one row of the city/municipality's facility list, which already
  // names every facility and the barangay it is in. That is where the drill-down ends.
  if (geo.geoLevel === "barangay") notFound();

  const isCitymun = geo.geoLevel === "citymun";
  const [counts, children, types, facilities, ancestors] = await Promise.all([
    getNhfrCounts(geo.geoCode, geo.geoLevel),
    getNhfrChildren(geo.geoCode, geo.geoLevel),
    getNhfrTypes(geo.geoCode, geo.geoLevel),
    isCitymun ? getNhfrFacilities(geo.geoCode) : Promise.resolve([]),
    getGeoAncestors(geo.geoCode, geo.geoLevel),
  ]);

  const crumbAncestors = [ancestors.region, ancestors.province, ancestors.citymun].filter(
    (a): a is NonNullable<typeof a> => a !== null && a.geoCode !== geo.geoCode,
  );

  const childHeading = CHILD_HEADING[geo.geoLevel];
  const withoutFacility = counts
    ? Math.max(0, counts.nBarangays - counts.nBarangaysWithFacility)
    : 0;

  // Title-slide facts for presentation mode (serializable, server → client). brandLabel keeps the
  // deck from presenting this dataset under the BHW Census's name (UUC_PHC_BRAND_LABEL's
  // precedent).
  const deckMeta = {
    pageLabel: "Area profile",
    areaName: geo.geoName,
    filterChips: crumbAncestors.map((a) => a.geoName),
    captionLine: nhfrCaption(counts, geo.geoName),
    brandLabel: NHFR_BRAND_LABEL,
  };

  return (
    <PresentationProvider meta={deckMeta}>
      <div className="flex flex-col gap-8">
        {/* Built here rather than by the layout's SiteBreadcrumbs because the ancestor names come
            from the database. */}
        <Breadcrumbs
          items={[
            PORTAL_CRUMB,
            FACILITIES_CRUMB,
            ...crumbAncestors.map((a) => ({
              label: a.geoName,
              href: `/facilities/${a.geoLevel}/${a.geoCode}`,
            })),
            { label: geo.geoName },
          ]}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{geo.geoName}</h1>
          <PresentButton variant="secondary" />
        </div>

        {!counts ? (
          <p className="text-muted">Facility data is not available for this area right now.</p>
        ) : (
          <>
            <PresentationSlide id="coverage" title="Barangays with at least one facility">
              <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
                <FacilityStats counts={counts} />
                <div className="mt-6 border-t border-border pt-5">
                  <h2 className="text-sm font-semibold">Barangays with at least one facility</h2>
                  <div className="mt-3">
                    <CoverageBar counts={counts} />
                  </div>
                  {withoutFacility > 0 && (
                    <p className="mt-3 text-xs text-muted">
                      {formatCount(withoutFacility)}{" "}
                      {withoutFacility === 1 ? "barangay has" : "barangays have"} no registered
                      health facility.
                    </p>
                  )}
                </div>
              </section>
            </PresentationSlide>

            <PresentationSlide id="types" title="Facility types">
              <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
                <TypeBreakdown items={types} />
              </div>
            </PresentationSlide>

            {isCitymun ? (
              <PresentationSlide id="facility-list" title="Facilities">
                <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
                  <FacilityList facilities={facilities} expectedCount={counts.nFacilities} />
                </div>
              </PresentationSlide>
            ) : (
              childHeading && (
                <PresentationSlide id="areas" title={childHeading}>
                  <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
                    <ChildBreakdown heading={childHeading} items={children} />
                  </div>
                </PresentationSlide>
              )
            )}

            <PresentationSlide id="ai-insight" title="AI insight">
              <AiInsight
                geoCode={geo.geoCode}
                geoLevel={geo.geoLevel}
                geoName={geo.geoName}
                narrativeType="facilities_overview"
                methodologyHref="/facilities/methodology#ask"
              />
            </PresentationSlide>
          </>
        )}

        <p className="text-sm text-muted">
          Source: DOH National Health Facility Registry, September 2026 snapshot. See the{" "}
          <Link href="/facilities/methodology" className="underline hover:text-accent">
            methodology
          </Link>{" "}
          for what the registry does and does not record.
        </p>

        <AskFacilities geoCode={geo.geoCode} geoLevel={geo.geoLevel} geoName={geo.geoName} />
      </div>
    </PresentationProvider>
  );
}
