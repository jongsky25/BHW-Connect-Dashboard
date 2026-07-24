import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGeoAncestors, getGeoByCode } from "@/lib/db/geo";
import {
  getProfilingStatus,
  getProfilingStatusChildren,
  getProfilingStatusStaticParams,
} from "@/lib/db/profiling-status";
import { GEO_LEVELS, type GeoLevel } from "@/lib/filters/schema";
import { formatCount } from "@/lib/format";
import { StatusHero } from "@/components/profiling-status/status-hero";
import { FunnelBars } from "@/components/profiling-status/funnel-bars";
import { BottleneckBars } from "@/components/profiling-status/bottleneck-bars";
import { AreaRanking } from "@/components/profiling-status/area-ranking";
import { CoverageFlags } from "@/components/profiling-status/coverage-flags";
import { ChildBreakdown } from "@/components/profiling-status/child-breakdown";

// 1 hour, not 24. ISR: citymun render on-demand; region/province are SSG. As on the landing page,
// a shorter window bounds how long a transient empty read (getProfilingStatus returns null on any
// read miss) can stay cached as a "no data yet" state; the dataset only changes on the daily cron.
export const revalidate = 3_600;

const CHILD_HEADING: Record<GeoLevel, string | null> = {
  national: "Regions",
  region: "Provinces",
  province: "Cities / municipalities",
  citymun: "Barangays",
  barangay: null,
};

type Params = { geoLevel: string; geoCode: string };

export async function generateStaticParams() {
  const params = await getProfilingStatusStaticParams();
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

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const geo = await loadGeo(await params);
  if (!geo) return { title: "Area not found" };

  const status = await getProfilingStatus(geo.geoCode, geo.geoLevel);
  const description =
    status && status.totalBhw > 0
      ? `2026 profiling status for ${geo.geoName}: ${status.encode.pct ?? 0}% encoded, ${
          status.validate.pct ?? 0
        }% validated, ${status.certify.pct ?? 0}% certified of ${formatCount(status.totalBhw)} BHWs.`
      : `2026 BHW profiling status for ${geo.geoName}.`;

  return { title: geo.geoName, description };
}

export default async function ProfilingStatusAreaPage({ params }: { params: Promise<Params> }) {
  const geo = await loadGeo(await params);
  if (!geo) notFound();

  const [status, children, ancestors] = await Promise.all([
    getProfilingStatus(geo.geoCode, geo.geoLevel),
    getProfilingStatusChildren(geo.geoCode, geo.geoLevel),
    getGeoAncestors(geo.geoCode, geo.geoLevel),
  ]);

  // Breadcrumb: Overview › region › province › (current). Only ancestors above this level,
  // in order, each linking to its own profiling-status page.
  const crumbAncestors = [ancestors.region, ancestors.province, ancestors.citymun].filter(
    (a): a is NonNullable<typeof a> => a !== null && a.geoCode !== geo.geoCode,
  );

  const downloadHref = `/api/export/profiling-status?geoLevel=${geo.geoLevel}&geoCode=${encodeURIComponent(geo.geoCode)}`;
  const childHeading = CHILD_HEADING[geo.geoLevel];

  return (
    <div className="flex flex-col gap-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-muted">
        <Link href="/profiling-status" className="hover:text-accent hover:underline">
          Overview
        </Link>
        {crumbAncestors.map((a) => (
          <span key={a.geoCode} className="flex items-center gap-1">
            <span aria-hidden="true">›</span>
            <Link
              href={`/profiling-status/${a.geoLevel}/${a.geoCode}`}
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

      {status && status.totalBhw > 0 ? (
        <>
          <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
            <StatusHero status={status} />
            <div className="mt-6">
              <FunnelBars status={status} />
            </div>
            <div className="mt-6 border-t border-border pt-5">
              <BottleneckBars status={status} />
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
              <p className="text-xs text-muted">Encode → Validate → Certify · 2026 profiling</p>
              <a
                href={downloadHref}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-accent"
              >
                Download summary (PNG)
              </a>
            </div>
          </section>

          {childHeading && children.length > 0 && (
            <>
              <AreaRanking heading={childHeading} items={children} />
              <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
                <ChildBreakdown heading={childHeading} items={children} />
                <div className="mt-4 border-t border-border pt-4">
                  <CoverageFlags items={children} />
                </div>
              </div>
            </>
          )}

          {/* A city/municipality has barangay children in principle, but the 2026 profiling
              sheets are municipality-grain — so barangay rows don't exist yet. Say so explicitly
              rather than leaving a blank, matching the region-by-region rollout messaging. */}
          {childHeading === "Barangays" && children.length === 0 && (
            <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted sm:p-6">
              No barangay-level profiling data yet. The 2026 encoding status is reported per
              city/municipality; barangay breakdowns will appear here as barangay-grain data is
              loaded.
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted sm:p-6">
          <p>
            No 2026 profiling data for {geo.geoName} yet. This dataset is being rolled out region
            by region — check back as more areas are loaded.
          </p>
          <Link href="/profiling-status" className="mt-3 inline-block underline hover:text-accent">
            ← Back to overview
          </Link>
        </div>
      )}
    </div>
  );
}
