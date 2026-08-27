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
  getUucPhcCriteria,
  getUucPhcCriteriaChildren,
  type UucPhcCriteria,
} from "@/lib/db/uuc-phc-criteria";
import { GEO_LEVELS, type GeoLevel } from "@/lib/filters/schema";
import { formatCount } from "@/lib/format";
import { CriteriaSection } from "@/components/uuc-phc/criteria-section";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentButton } from "@/components/present/present-button";
import { AskTheList } from "@/components/uuc-phc/ask-the-list";

// 1 hour. Region and province are prerendered by the coverage section's params; citymun renders on
// demand. Same reasoning as the rest of the section.
export const revalidate = 3_600;

const CHILD_HEADING: Record<GeoLevel, string | null> = {
  national: "Regions",
  region: "Provinces",
  province: "Cities / municipalities",
  // The aggregate stops at citymun — below it every row would be one barangay's four yes/nos,
  // which is what the coverage page's per-barangay disclosure already shows.
  citymun: null,
  barangay: null,
};

type Params = { geoLevel: string; geoCode: string };

// The same region and province set the coverage route prerenders, from the same helper — the two
// routes are one drill-down and should not differ in which areas are built ahead of time.
// City/municipality pages are left to ISR, as there.
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

/** The lead sentence of the page description — the route that carried most of the area's list. */
function leadingRoute(criteria: UucPhcCriteria): string | null {
  const ranked = criteria.routes
    .filter((route) => route.sharePct !== null)
    .sort((a, b) => (b.sharePct ?? 0) - (a.sharePct ?? 0));
  const top = ranked[0];
  if (!top || top.count === 0) return null;
  return `${formatCount(top.count)} of them on ${top.label.toLowerCase()} (${top.sharePct}%)`;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const geo = await loadGeo(await params);
  if (!geo) return { title: "Area not found" };

  const criteria = await getUucPhcCriteria(geo.geoCode, geo.geoLevel);
  if (!criteria || criteria.nListed === 0) {
    return {
      title: `Why these barangays qualified · ${geo.geoName}`,
      description: `No barangay in ${geo.geoName} is on the 2025 UUC for PHC list.`,
    };
  }

  const lead = leadingRoute(criteria);
  return {
    title: `Why these barangays qualified · ${geo.geoName}`,
    description: `How ${geo.geoName}'s ${formatCount(
      criteria.nListed,
    )} barangays on the 2025 UUC for PHC list qualified${lead ? `: ${lead}` : ""}. The four routes overlap.`,
  };
}

export default async function UucPhcCriteriaAreaPage({ params }: { params: Promise<Params> }) {
  const geo = await loadGeo(await params);
  if (!geo) notFound();

  // Barangay pages would be four yes/nos, which the coverage page's disclosure already renders.
  if (geo.geoLevel === "barangay") notFound();

  const [criteria, counts, children, ancestors] = await Promise.all([
    getUucPhcCriteria(geo.geoCode, geo.geoLevel),
    getUucPhcCounts(geo.geoCode, geo.geoLevel),
    getUucPhcCriteriaChildren(geo.geoCode, geo.geoLevel),
    getGeoAncestors(geo.geoCode, geo.geoLevel),
  ]);

  const crumbAncestors = [ancestors.region, ancestors.province, ancestors.citymun].filter(
    (a): a is NonNullable<typeof a> => a !== null && a.geoCode !== geo.geoCode,
  );

  const deckMeta = {
    pageLabel: "Qualifying criteria",
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
          <Link href="/uuc-phc/criteria" className="hover:text-accent hover:underline">
            Qualifying criteria
          </Link>
          {crumbAncestors.map((a) => (
            <span key={a.geoCode} className="flex items-center gap-1">
              <span aria-hidden="true">›</span>
              <Link
                href={`/uuc-phc/criteria/${a.geoLevel}/${a.geoCode}`}
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
            Why these barangays qualified
            <span className="block text-base font-normal text-muted">{geo.geoName}</span>
          </h1>
          <PresentButton variant="secondary" />
        </div>

        {criteria ? (
          <CriteriaSection
            criteria={criteria}
            areaLabel={geo.geoName}
            childHeading={CHILD_HEADING[geo.geoLevel]}
            childAreas={children}
            coverageHref={`/uuc-phc/${geo.geoLevel}/${geo.geoCode}`}
          />
        ) : (
          <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted sm:p-6">
            <p>The qualifying-route breakdown for {geo.geoName} could not be loaded right now.</p>
            <Link href="/uuc-phc/criteria" className="mt-3 inline-block underline hover:text-accent">
              ← Back to qualifying criteria
            </Link>
          </div>
        )}

        <AskTheList geoCode={geo.geoCode} geoLevel={geo.geoLevel} geoName={geo.geoName} />
      </div>
    </PresentationProvider>
  );
}
