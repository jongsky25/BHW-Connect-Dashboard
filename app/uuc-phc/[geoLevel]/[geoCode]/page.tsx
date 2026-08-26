import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGeoAncestors, getGeoByCode } from "@/lib/db/geo";
import {
  getUucPhcBarangays,
  getUucPhcChildren,
  getUucPhcCounts,
  getUucPhcStaticParams,
} from "@/lib/db/uuc-phc";
import { GEO_LEVELS, type GeoLevel } from "@/lib/filters/schema";
import { formatCount } from "@/lib/format";
import { CoverageHero } from "@/components/uuc-phc/coverage-hero";
import { ShareBar } from "@/components/uuc-phc/share-bar";
import { ChildBreakdown } from "@/components/uuc-phc/child-breakdown";
import { BarangayList } from "@/components/uuc-phc/barangay-list";
import { getUucPhcBarangayDetails } from "@/lib/db/uuc-phc-indicators";

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

  return (
    <div className="flex flex-col gap-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-muted">
        <Link href="/uuc-phc" className="hover:text-accent hover:underline">
          Overview
        </Link>
        {crumbAncestors.map((a) => (
          <span key={a.geoCode} className="flex items-center gap-1">
            <span aria-hidden="true">›</span>
            <Link
              href={`/uuc-phc/${a.geoLevel}/${a.geoCode}`}
              className="hover:text-accent hover:underline"
            >
              {a.geoName}
            </Link>
          </span>
        ))}
        <span aria-hidden="true">›</span>
        <span className="font-medium text-foreground">{geo.geoName}</span>
      </nav>

      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{geo.geoName}</h1>

      {counts ? (
        <>
          <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
            <CoverageHero counts={counts} areaLabel={geo.geoName} />
            <div className="mt-6">
              <ShareBar counts={counts} />
            </div>
            {counts.nListed === 0 && (
              // A real zero, not a gap: this dataset is a single national publication, so an
              // area with nothing listed was covered and assessed, not left out.
              <p className="mt-5 border-t border-border pt-4 text-sm text-muted">
                No barangay in {geo.geoName} is on the 2025 list. The list is national and complete
                as published, so this is a result rather than missing data.
              </p>
            )}
          </section>

          {childHeading && children.length > 0 && (
            <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
              <ChildBreakdown heading={childHeading} items={children} />
            </div>
          )}

          {isCitymun && barangays.length > 0 && (
            <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
              <BarangayList items={barangays} details={details} />
            </div>
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
    </div>
  );
}
