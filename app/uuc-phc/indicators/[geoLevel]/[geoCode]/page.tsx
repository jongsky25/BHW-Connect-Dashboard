import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGeoAncestors, getGeoByCode } from "@/lib/db/geo";
import {
  UUC_PHC_BRAND_LABEL,
  getUucPhcCounts,
  getUucPhcStaticParams,
  uucDeckCaption,
} from "@/lib/db/uuc-phc";
import { getUucPhcIndicatorDist } from "@/lib/db/uuc-phc-indicator-dist";
import { GEO_LEVELS, type GeoLevel } from "@/lib/filters/schema";
import { formatCount } from "@/lib/format";
import { IndicatorsSection } from "@/components/uuc-phc/indicators-section";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentButton } from "@/components/present/present-button";
import { AskTheList } from "@/components/uuc-phc/ask-the-list";

// 1 hour. Region and province are prerendered by the coverage section's params; citymun renders on
// demand. Same reasoning as the rest of the section.
export const revalidate = 3_600;

type Params = { geoLevel: string; geoCode: string };

// The same region and province set the coverage and criteria routes prerender, from the same
// helper — the three routes are one drill-down and should not differ in which areas are built
// ahead of time. City/municipality pages are left to ISR, as there.
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
  if (!counts || counts.nListed === 0) {
    return {
      title: `The indicators behind the list · ${geo.geoName}`,
      description: `No barangay in ${geo.geoName} is on the 2025 UUC for PHC list, so there are no indicator values to distribute.`,
    };
  }

  return {
    title: `The indicators behind the list · ${geo.geoName}`,
    description: `How ${geo.geoName}'s ${formatCount(
      counts.nListed,
    )} barangays on the 2025 UUC for PHC list are distributed across the 12 indicators they were assessed on, with the values bounded during cleaning counted separately. No averages.`,
  };
}

export default async function UucPhcIndicatorsAreaPage({ params }: { params: Promise<Params> }) {
  const geo = await loadGeo(await params);
  if (!geo) notFound();

  // A barangay page would be 12 single values, which is exactly the disclosure the coverage page's
  // city/municipality view already renders — and one value is not a distribution.
  if (geo.geoLevel === "barangay") notFound();

  const [counts, dists, ancestors] = await Promise.all([
    getUucPhcCounts(geo.geoCode, geo.geoLevel),
    getUucPhcIndicatorDist(geo.geoCode, geo.geoLevel),
    getGeoAncestors(geo.geoCode, geo.geoLevel),
  ]);

  const crumbAncestors = [ancestors.region, ancestors.province, ancestors.citymun].filter(
    (a): a is NonNullable<typeof a> => a !== null && a.geoCode !== geo.geoCode,
  );

  const deckMeta = {
    pageLabel: "Indicators",
    areaName: geo.geoName,
    filterChips: crumbAncestors.map((a) => a.geoName),
    captionLine: uucDeckCaption(counts, geo.geoName),
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
          <Link href="/uuc-phc/indicators" className="hover:text-accent hover:underline">
            Indicators
          </Link>
          {crumbAncestors.map((a) => (
            <span key={a.geoCode} className="flex items-center gap-1">
              <span aria-hidden="true">›</span>
              <Link
                href={`/uuc-phc/indicators/${a.geoLevel}/${a.geoCode}`}
                className="hover:text-accent hover:underline"
              >
                {a.geoName}
              </Link>
            </span>
          ))}
          <span aria-hidden="true">›</span>
          <span className="font-medium text-foreground">{geo.geoName}</span>
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            The indicators behind the list
            <span className="block text-base font-normal text-muted">{geo.geoName}</span>
          </h1>
          <PresentButton variant="secondary" />
        </div>

        {counts && (dists.length > 0 || counts.nListed === 0) ? (
          <IndicatorsSection
            dists={dists}
            areaLabel={geo.geoName}
            nListed={counts.nListed}
            coverageHref={`/uuc-phc/${geo.geoLevel}/${geo.geoCode}`}
            criteriaHref={`/uuc-phc/criteria/${geo.geoLevel}/${geo.geoCode}`}
          />
        ) : (
          <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted sm:p-6">
            <p>The indicator distributions for {geo.geoName} could not be loaded right now.</p>
            <Link
              href="/uuc-phc/indicators"
              className="mt-3 inline-block underline hover:text-accent"
            >
              ← Back to the indicators
            </Link>
          </div>
        )}

        <AskTheList geoCode={geo.geoCode} geoLevel={geo.geoLevel} geoName={geo.geoName} />
      </div>
    </PresentationProvider>
  );
}
