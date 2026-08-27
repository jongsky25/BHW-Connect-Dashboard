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
import {
  coverageDirection,
  getUucBhwCoverage,
  getUucBhwCoverageChildren,
} from "@/lib/db/uuc-phc-bhw-coverage";
import { GEO_LEVELS, type GeoLevel } from "@/lib/filters/schema";
import { BhwCoverageSection } from "@/components/uuc-phc/bhw-coverage-section";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentButton } from "@/components/present/present-button";
import { AskTheList } from "@/components/uuc-phc/ask-the-list";

// 1 hour. Region and province are prerendered from the coverage section's params; citymun renders
// on demand. Same reasoning as the rest of the section.
export const revalidate = 3_600;

const CHILD_HEADING: Record<GeoLevel, string | null> = {
  national: "Regions",
  region: "Provinces",
  province: "Cities / municipalities",
  // The aggregate stops at citymun, and a barangay is entirely listed or entirely not — one level
  // below this there is no split to draw.
  citymun: null,
  barangay: null,
};

type Params = { geoLevel: string; geoCode: string };

// The same region and province set every other route in this section prerenders, from the same
// helper: the four routes are one drill-down and should not differ in which areas are built ahead.
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

  const coverage = await getUucBhwCoverage(geo.geoCode, geo.geoLevel);
  const comparison = coverage?.comparison;

  // The description states which way the comparison points but never as a discovery — the page's
  // own caveat cannot travel into a search result or a social card, so the wording here has to
  // survive being read alone.
  let detail = "";
  if (comparison?.kind === "comparable") {
    const direction = coverageDirection(comparison);
    detail =
      direction === "thinner"
        ? ` Listed barangays here carry more households per BHW than the rest of the area — against the national pattern.`
        : direction === "thicker"
          ? ` Listed barangays here carry fewer households per BHW than the rest of the area, mostly because they are smaller.`
          : ` The two groups carry the same households per BHW.`;
  } else if (comparison?.kind === "nothing-listed") {
    detail = ` No barangay in ${geo.geoName} is on the 2025 list, so there is nothing to compare.`;
  }

  return {
    title: `BHW coverage and the list · ${geo.geoName}`,
    description:
      `How BHW coverage in ${geo.geoName} compares between the barangays on the 2025 UUC for PHC list and every other barangay in the area.` +
      `${detail} A consistency check, not a finding: UUC status is defined partly on distance to a health facility.`,
  };
}

export default async function UucPhcBhwCoverageAreaPage({ params }: { params: Promise<Params> }) {
  const geo = await loadGeo(await params);
  if (!geo) notFound();

  // A barangay is entirely listed or entirely not, so a barangay page would be one side and an
  // empty one. `/uuc-phc/barangay/*` 404s for the same reason.
  if (geo.geoLevel === "barangay") notFound();

  const [coverage, counts, children, ancestors] = await Promise.all([
    getUucBhwCoverage(geo.geoCode, geo.geoLevel),
    getUucPhcCounts(geo.geoCode, geo.geoLevel),
    getUucBhwCoverageChildren(geo.geoCode, geo.geoLevel),
    getGeoAncestors(geo.geoCode, geo.geoLevel),
  ]);

  const crumbAncestors = [ancestors.region, ancestors.province, ancestors.citymun].filter(
    (a): a is NonNullable<typeof a> => a !== null && a.geoCode !== geo.geoCode,
  );

  const deckMeta = {
    pageLabel: "BHW coverage and the list",
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
          <Link href="/uuc-phc/bhw-coverage" className="hover:text-accent hover:underline">
            BHW coverage
          </Link>
          {crumbAncestors.map((a) => (
            <span key={a.geoCode} className="flex items-center gap-1">
              <span aria-hidden="true">›</span>
              <Link
                href={`/uuc-phc/bhw-coverage/${a.geoLevel}/${a.geoCode}`}
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
            BHW coverage and the list
            <span className="block text-base font-normal text-muted">{geo.geoName}</span>
          </h1>
          <PresentButton variant="secondary" />
        </div>

        {coverage ? (
          <BhwCoverageSection
            coverage={coverage}
            areaLabel={geo.geoName}
            childHeading={CHILD_HEADING[geo.geoLevel]}
            childAreas={children}
            coverageHref={`/uuc-phc/${geo.geoLevel}/${geo.geoCode}`}
          />
        ) : (
          <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted sm:p-6">
            <p>The BHW coverage comparison for {geo.geoName} could not be loaded right now.</p>
            <Link
              href="/uuc-phc/bhw-coverage"
              className="mt-3 inline-block underline hover:text-accent"
            >
              ← Back to BHW coverage
            </Link>
          </div>
        )}

        <AskTheList geoCode={geo.geoCode} geoLevel={geo.geoLevel} geoName={geo.geoName} />
      </div>
    </PresentationProvider>
  );
}
