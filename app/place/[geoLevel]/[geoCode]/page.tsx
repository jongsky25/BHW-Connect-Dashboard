import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getBhwCounts,
  getChildSummaries,
  getDemographics,
  getHonorarium,
  getTrainingCoverage,
} from "@/lib/db/indicators";
import { getBhwOverview, coverageForDisplay } from "@/lib/db/stepzero";
import { getDataCompleteness } from "@/lib/db/data-quality";
import { getGeoAncestors, getGeoByCode, getStaticGeoParams } from "@/lib/db/geo";
import { getPlaceLocator } from "@/lib/geo/locator";
import { getInsights } from "@/lib/db/insights";
import {
  DEFAULT_BREAKDOWNS,
  GEO_LEVELS,
  NATIONAL_GEO_CODE,
  type GeoLevel,
} from "@/lib/filters/schema";
import { FigureCard } from "@/components/narrative/figure-card";
import { ExportMenu } from "@/components/narrative/export-menu";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import { ProfileHeader, type BreadcrumbAncestor } from "@/components/place/profile-header";
import { LocatorMapThumbnail } from "@/components/place/locator-map";
import { ChildrenTable } from "@/components/place/children-table";
import { BenchmarkBars, type BenchmarkRow } from "@/components/place/benchmark";
import { GeoSearch } from "@/components/home/geo-search";
import { DemographicsFigure } from "@/components/explore/demographics-figure";
import { TrainingFigure } from "@/components/explore/training-figure";
import { HonorariumFigure } from "@/components/explore/honorarium-figure";
import { CompletenessFigure } from "@/components/place/completeness-figure";
import { InsightsGrid } from "@/components/insights/insights-grid";
import { AiInsight } from "@/components/narrative/ai-insight";

export const revalidate = 86_400; // ISR: refresh at most once a day (citymun/barangay; regions/provinces are SSG via generateStaticParams)

/** Plural label for the level one step below the given level, for the
 * "Places within" drill-down heading. Barangay has no children. */
const CHILD_LEVEL_PLURAL: Record<GeoLevel, string | null> = {
  national: "Regions",
  region: "Provinces",
  province: "Cities / municipalities",
  citymun: "Barangays",
  barangay: null,
};

type PlaceParams = { geoLevel: string; geoCode: string };

export async function generateStaticParams() {
  const params = await getStaticGeoParams();
  return params.map((p) => ({ geoLevel: p.geoLevel, geoCode: p.geoCode }));
}

function isGeoLevel(value: string): value is GeoLevel {
  return (GEO_LEVELS as readonly string[]).includes(value);
}

async function loadPlace(params: PlaceParams) {
  if (!isGeoLevel(params.geoLevel)) return null;
  const geo = await getGeoByCode(params.geoCode);
  if (!geo || geo.geoLevel !== params.geoLevel) return null;
  return geo;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PlaceParams>;
}): Promise<Metadata> {
  const geo = await loadPlace(await params);
  if (!geo) return { title: "Place not found" };

  const [overview, counts] = await Promise.all([
    getBhwOverview(geo.geoCode, geo.geoLevel),
    getBhwCounts(geo.geoCode, geo.geoLevel),
  ]);
  const headlineTotal = overview.totalBhw ?? counts?.nTotal ?? null;
  const description =
    headlineTotal !== null
      ? `${headlineTotal.toLocaleString()} Barangay Health Workers in ${geo.geoName}${
          counts?.pctAccredited !== null && counts?.pctAccredited !== undefined
            ? `, ${counts.pctAccredited}% of profiled BHWs accredited`
            : ""
        }.`
      : `Barangay Health Worker figures for ${geo.geoName}.`;

  return {
    title: geo.geoName,
    description,
    openGraph: { title: `${geo.geoName} · BHW Connect`, description, type: "website" },
  };
}

export default async function PlacePage({ params }: { params: Promise<PlaceParams> }) {
  const geo = await loadPlace(await params);
  if (!geo) notFound();

  const [
    ancestors,
    overview,
    counts,
    demographicsByDimension,
    training,
    honorarium,
    insights,
    childSummaries,
    completeness,
  ] = await Promise.all([
    getGeoAncestors(geo.geoCode, geo.geoLevel),
    getBhwOverview(geo.geoCode, geo.geoLevel),
    getBhwCounts(geo.geoCode, geo.geoLevel),
    Promise.all(
      DEFAULT_BREAKDOWNS.map(async (dimension) => ({
        dimension,
        rows: await getDemographics(geo.geoCode, geo.geoLevel, [dimension]),
      })),
    ),
    getTrainingCoverage(geo.geoCode, geo.geoLevel),
    getHonorarium(geo.geoCode, geo.geoLevel),
    getInsights(geo.geoLevel, geo.geoCode, geo.geoName),
    getChildSummaries(geo.geoCode, geo.geoLevel),
    getDataCompleteness(geo.geoCode, geo.geoLevel),
  ]);

  // Needs ancestors (fetched above) to pick the right boundary file, so it
  // can't join the first Promise.all; it's a cached local-file read, not a DB call.
  const locator = await getPlaceLocator(geo, ancestors);

  const childLevelLabel = CHILD_LEVEL_PLURAL[geo.geoLevel];

  // Benchmark context: this place vs. its region and the nation, so every figure
  // answers "versus what?". National is always fetched; the region only when the
  // place sits inside one (below region level) so a region page never compares
  // against itself. Benchmarks are hidden entirely on the national page.
  const showBenchmarks = geo.geoLevel !== "national";
  const regionBenchmark =
    geo.geoLevel !== "national" && geo.geoLevel !== "region" ? ancestors.region : null;

  const [nationalOverview, nationalCounts, regionOverview, regionCounts] = await Promise.all([
    showBenchmarks ? getBhwOverview(NATIONAL_GEO_CODE, "national") : Promise.resolve(null),
    showBenchmarks ? getBhwCounts(NATIONAL_GEO_CODE, "national") : Promise.resolve(null),
    regionBenchmark ? getBhwOverview(regionBenchmark.geoCode, "region") : Promise.resolve(null),
    regionBenchmark ? getBhwCounts(regionBenchmark.geoCode, "region") : Promise.resolve(null),
  ]);

  const benchmarkRows = (
    place: number | null,
    region: number | null,
    national: number | null,
  ): BenchmarkRow[] => [
    { label: "This place", value: place, isPrimary: true },
    ...(regionBenchmark ? [{ label: regionBenchmark.geoName, value: region }] : []),
    { label: "Philippines", value: national },
  ];

  const breadcrumbAncestors: BreadcrumbAncestor[] = [
    { label: "Philippines", geoLevel: "national", geoCode: NATIONAL_GEO_CODE },
    ...(ancestors.region
      ? [
          {
            label: ancestors.region.geoName,
            geoLevel: "region" as const,
            geoCode: ancestors.region.geoCode,
          },
        ]
      : []),
    ...(ancestors.province
      ? [
          {
            label: ancestors.province.geoName,
            geoLevel: "province" as const,
            geoCode: ancestors.province.geoCode,
          },
        ]
      : []),
    ...(ancestors.citymun && geo.geoLevel === "barangay"
      ? [
          {
            label: ancestors.citymun.geoName,
            geoLevel: "citymun" as const,
            geoCode: ancestors.citymun.geoCode,
          },
        ]
      : []),
  ];

  const caption = `N = ${overview.validatedProfiles?.toLocaleString() ?? "—"} validated profiles · ${geo.geoName} · 2025 snapshot`;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <ProfileHeader
        geoName={geo.geoName}
        geoLevel={geo.geoLevel}
        ancestors={breadcrumbAncestors}
        totalBhw={overview.totalBhw}
        validatedProfiles={overview.validatedProfiles}
        coveragePct={coverageForDisplay(overview)}
        householdsPerBhw={overview.householdsPerBhw}
        incomeClass={geo.incomeClass}
        locator={
          locator ? (
            <LocatorMapThumbnail
              locator={locator}
              geoLevel={geo.geoLevel}
              geoCode={geo.geoCode}
              placeName={geo.geoName}
            />
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/compare?geos=${geo.geoCode}`}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Compare with other places
          </Link>
          <Link
            href={`/explore?geoLevel=${geo.geoLevel}&geoCode=${geo.geoCode}`}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
          >
            Explore full breakdowns
          </Link>
        </div>
        <div className="sm:w-64">
          <GeoSearch variant="compact" />
        </div>
      </div>

      <AiInsight geoCode={geo.geoCode} geoLevel={geo.geoLevel} geoName={geo.geoName} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FigureCard
          title="Accreditation"
          caption={caption}
          exportMenu={
            <ExportMenu geoCode={geo.geoCode} geoLevel={geo.geoLevel} indicator="accreditation" />
          }
          headline={
            counts?.pctAccredited !== null && counts?.pctAccredited !== undefined
              ? `About ${Math.round(counts.pctAccredited)}% of profiled BHWs here are accredited.`
              : "No accreditation data available."
          }
          technicalDetails={
            <p>
              {counts?.nAccredited?.toLocaleString() ?? "—"} of{" "}
              {counts?.nTotal?.toLocaleString() ?? "—"} validated profiles are accredited (
              {counts?.pctAccredited ?? "—"}%).
              {counts?.ciLow !== null &&
              counts?.ciLow !== undefined &&
              counts?.ciHigh !== null &&
              counts?.ciHigh !== undefined ? (
                <>
                  {" "}
                  95% <GlossaryTerm slug="confidence_interval">confidence interval</GlossaryTerm>:{" "}
                  {counts.ciLow}–{counts.ciHigh}%.
                </>
              ) : null}
            </p>
          }
          benchmark={
            showBenchmarks ? (
              <BenchmarkBars
                rows={benchmarkRows(
                  counts?.pctAccredited ?? null,
                  regionCounts?.pctAccredited ?? null,
                  nationalCounts?.pctAccredited ?? null,
                )}
                format="percent"
              />
            ) : undefined
          }
        >
          <p className="text-4xl font-semibold tracking-tight">
            {counts?.pctAccredited !== null && counts?.pctAccredited !== undefined
              ? `${counts.pctAccredited}%`
              : "—"}
          </p>
        </FigureCard>

        <FigureCard
          title="Average years of service"
          caption={caption}
          exportMenu={
            <ExportMenu geoCode={geo.geoCode} geoLevel={geo.geoLevel} indicator="service_years" />
          }
          headline={
            counts?.avgActiveYears !== null && counts?.avgActiveYears !== undefined
              ? `BHWs here have served an average of ${counts.avgActiveYears} years.`
              : "No service-year data available."
          }
          technicalDetails={<p>Computed from each BHW&apos;s recorded active-service years.</p>}
          benchmark={
            showBenchmarks ? (
              <BenchmarkBars
                rows={benchmarkRows(
                  counts?.avgActiveYears ?? null,
                  regionCounts?.avgActiveYears ?? null,
                  nationalCounts?.avgActiveYears ?? null,
                )}
                format="count"
                unitSuffix="yrs"
              />
            ) : undefined
          }
        >
          <p className="text-4xl font-semibold tracking-tight">{counts?.avgActiveYears ?? "—"}</p>
        </FigureCard>

        {overview.householdsPerBhw !== null && (
          <FigureCard
            title="Households per BHW"
            caption={`Households served per BHW · ${geo.geoName} · 2025`}
            headline={`Each BHW here serves about ${overview.householdsPerBhw} households.`}
            technicalDetails={
              <p>
                StepZero household count divided by Total BHWs (the StepZero universe). A higher
                figure means each BHW covers more households.
              </p>
            }
            benchmark={
              showBenchmarks ? (
                <BenchmarkBars
                  rows={benchmarkRows(
                    overview.householdsPerBhw,
                    regionOverview?.householdsPerBhw ?? null,
                    nationalOverview?.householdsPerBhw ?? null,
                  )}
                  format="count"
                  unitSuffix="hh/BHW"
                />
              ) : undefined
            }
          >
            <p className="text-4xl font-semibold tracking-tight">{overview.householdsPerBhw}</p>
          </FigureCard>
        )}

        {demographicsByDimension.map(({ dimension, rows }) => (
          <DemographicsFigure
            key={dimension}
            dimension={dimension}
            rows={rows}
            caption={caption}
            geoCode={geo.geoCode}
            geoLevel={geo.geoLevel}
          />
        ))}

        <TrainingFigure
          rows={training}
          caption={caption}
          geoLevel={geo.geoLevel}
          citymunAncestor={ancestors.citymun}
          geoCode={geo.geoCode}
        />

        <HonorariumFigure
          rows={honorarium}
          caption={caption}
          geoCode={geo.geoCode}
          geoLevel={geo.geoLevel}
        />

        <CompletenessFigure
          rows={completeness}
          caption={caption}
          geoLevel={geo.geoLevel}
          citymunAncestor={ancestors.citymun}
        />
      </div>

      {childLevelLabel && childSummaries.length > 0 && (
        <ChildrenTable
          rows={childSummaries}
          childLevelLabel={childLevelLabel}
          showTrainingGap={geo.geoLevel !== "citymun"}
        />
      )}

      <InsightsGrid insights={insights} geoLevel={geo.geoLevel} geoName={geo.geoName} />
    </div>
  );
}
