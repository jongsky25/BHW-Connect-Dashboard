import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PORTAL_CRUMB, UUC_PHC_CRUMB } from "@/lib/nav/breadcrumbs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGeoAncestors, getGeoByCode } from "@/lib/db/geo";
import {
  UUC_PHC_BRAND_LABEL,
  getUucPhcBarangays,
  getUucPhcChildren,
  getUucPhcCounts,
  getUucPhcStaticParams,
  uucDeckCaption,
} from "@/lib/db/uuc-phc";
import { GEO_LEVELS, type GeoLevel } from "@/lib/filters/schema";
import { formatCount } from "@/lib/format";
import { CoverageHero } from "@/components/uuc-phc/coverage-hero";
import { ShareBar } from "@/components/uuc-phc/share-bar";
import { ChildBreakdown } from "@/components/uuc-phc/child-breakdown";
import { BarangayList } from "@/components/uuc-phc/barangay-list";
import { getUucPhcBarangayDetails } from "@/lib/db/uuc-phc-indicators";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentationSlide } from "@/components/present/presentation-slide";
import { PresentButton } from "@/components/present/present-button";
import { AiInsight } from "@/components/narrative/ai-insight";
import { AskTheList } from "@/components/uuc-phc/ask-the-list";

// 1 hour. ISR: citymun render on demand; region/province are prerendered. Same reasoning as the
// landing page — a shorter window bounds how long a transient empty read can stay cached.
export const revalidate = 3_600;

const CHILD_HEADING: Record<GeoLevel, string | null> = {
  national: "Regions",
  region: "Provinces",
  province: "Cities / municipalities",
  citymun: null, // handled by BarangayList — the aggregate stops at citymun
  barangay: null,
};

type Params = { geoLevel: string; geoCode: string };

export async function generateStaticParams() {
  const params = await getUucPhcStaticParams();
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

  const counts = await getUucPhcCounts(geo.geoCode, geo.geoLevel);
  const description =
    counts && counts.nBarangays > 0
      ? `${formatCount(counts.nListed)} of ${formatCount(
          counts.nBarangays,
        )} barangays in ${geo.geoName} are on the 2025 list of Unserved and Underserved Communities for Primary Health Care${
          counts.sharePct === null ? "" : ` (${counts.sharePct}%)`
        }.`
      : `2025 UUC for PHC status for ${geo.geoName}.`;

  return { title: geo.geoName, description };
}

export default async function UucPhcAreaPage({ params }: { params: Promise<Params> }) {
  const geo = await loadGeo(await params);
  if (!geo) notFound();

  // Barangay pages would be a single yes/no — the city/municipality page already names every
  // barangay and its status, so that is where the drill-down ends.
  if (geo.geoLevel === "barangay") notFound();

  const isCitymun = geo.geoLevel === "citymun";
  const [counts, children, barangays, details, ancestors] = await Promise.all([
    getUucPhcCounts(geo.geoCode, geo.geoLevel),
    getUucPhcChildren(geo.geoCode, geo.geoLevel),
    isCitymun ? getUucPhcBarangays(geo.geoCode) : Promise.resolve([]),
    // Indicators render only here, at barangay grain, where a capped value can carry its own
    // marker — see lib/db/uuc-phc-indicators.ts on why there are no indicator aggregates.
    isCitymun ? getUucPhcBarangayDetails(geo.geoCode) : Promise.resolve([]),
    getGeoAncestors(geo.geoCode, geo.geoLevel),
  ]);

  // Breadcrumb: Overview › region › province › (current). Only ancestors above this level.
  const crumbAncestors = [ancestors.region, ancestors.province, ancestors.citymun].filter(
    (a): a is NonNullable<typeof a> => a !== null && a.geoCode !== geo.geoCode,
  );

  const childHeading = CHILD_HEADING[geo.geoLevel];

  // Title-slide facts for presentation mode. The chips are this area's ancestry, the same context
  // the breadcrumb carries — a deck opened on a city should say which province it is in.
  const deckMeta = {
    pageLabel: "Area profile",
    areaName: geo.geoName,
    filterChips: crumbAncestors.map((a) => a.geoName),
    captionLine: uucDeckCaption(counts, geo.geoName),
    brandLabel: UUC_PHC_BRAND_LABEL,
  };

  return (
    <PresentationProvider meta={deckMeta}>
      <div className="flex flex-col gap-8">
        {/* Breadcrumb — built here rather than by the layout's `SiteBreadcrumbs`
            because the ancestor names come from the database. */}
        <Breadcrumbs
          items={[
            PORTAL_CRUMB,
            UUC_PHC_CRUMB,
            ...crumbAncestors.map((a) => ({
              label: a.geoName,
              href: `/uuc-phc/${a.geoLevel}/${a.geoCode}`,
            })),
            { label: geo.geoName },
          ]}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{geo.geoName}</h1>
          <PresentButton variant="secondary" />
        </div>

        {counts ? (
          <>
            <PresentationSlide id="coverage" title="Barangays on the 2025 list">
              <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
                <CoverageHero counts={counts} areaLabel={geo.geoName} />
                <div className="mt-6">
                  <ShareBar counts={counts} />
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <p className="text-xs text-muted">
                    Issued under DC No. 2025-0549 · criteria per DOH AO No. 2020-0023
                    {counts.nListed > 0 && (
                      <>
                        {" · "}
                        <Link
                          href={`/uuc-phc/criteria/${geo.geoLevel}/${geo.geoCode}`}
                          className="underline hover:text-accent"
                        >
                          Why these {formatCount(counts.nListed)} qualified
                        </Link>
                        {" · "}
                        <Link
                          href={`/uuc-phc/indicators/${geo.geoLevel}/${geo.geoCode}`}
                          className="underline hover:text-accent"
                        >
                          The indicators behind them
                        </Link>
                      </>
                    )}
                  </p>
                  <a
                    href={`/api/export/uuc-phc?geoLevel=${geo.geoLevel}&geoCode=${encodeURIComponent(geo.geoCode)}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-accent"
                  >
                    Download summary (PNG)
                  </a>
                </div>
                {counts.nListed === 0 && (
                  // A real zero, not a gap: this dataset is a single national publication, so an
                  // area with nothing listed was covered and assessed, not left out.
                  <p className="mt-4 text-sm text-muted">
                    No barangay in {geo.geoName} is on the 2025 list. The list is national and
                    complete as published, so this is a result rather than missing data.
                  </p>
                )}
              </section>
            </PresentationSlide>

            {/* The insight is promoted like /bhw's, and unlike U6's barangay disclosures: its
                caveats are inside its sentences (UUC_PHC_SYSTEM_PROMPT rule 4) rather than in a
                footnote that promotion would leave behind, so there is nothing here for a slide to
                strip. `narrativeType` is what keeps this out of the BHW insight's cache row. */}
            <PresentationSlide id="ai-insight" title="AI insight">
              <AiInsight
                geoCode={geo.geoCode}
                geoLevel={geo.geoLevel}
                geoName={geo.geoName}
                narrativeType="uuc_overview"
                methodologyHref="/uuc-phc/methodology#ask"
              />
            </PresentationSlide>

            {childHeading && children.length > 0 && (
              <PresentationSlide id="children" title={childHeading}>
                <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
                  <ChildBreakdown heading={childHeading} items={children} />
                </div>
              </PresentationSlide>
            )}

            {isCitymun && barangays.length > 0 && (
              // The barangay list is one slide, not one per barangay: the indicator disclosures
              // inside it stay closed on promotion, so a capped value cannot reach a screen
              // without the † footnote that travels with it (U3).
              <PresentationSlide id="barangays" title="Listed barangays">
                <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
                  <BarangayList items={barangays} details={details} />
                </div>
              </PresentationSlide>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted sm:p-6">
            <p>UUC for PHC data for {geo.geoName} could not be loaded right now.</p>
            <Link href="/uuc-phc" className="mt-3 inline-block underline hover:text-accent">
              ← Back to overview
            </Link>
          </div>
        )}

        <AskTheList geoCode={geo.geoCode} geoLevel={geo.geoLevel} geoName={geo.geoName} />
      </div>
    </PresentationProvider>
  );
}
