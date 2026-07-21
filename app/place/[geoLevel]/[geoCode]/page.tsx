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
import { getGeoByCode, getStaticGeoParams } from "@/lib/db/geo";
import { getBenchmarkContext, benchmarkRowsFor } from "@/lib/db/benchmark-context";
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
import { BenchmarkBars } from "@/components/place/benchmark";
import { GeoSearch } from "@/components/home/geo-search";
import { DemographicsFigure } from "@/components/explore/demographics-figure";
import { TrainingFigure } from "@/components/explore/training-figure";
import { HonorariumFigure } from "@/components/explore/honorarium-figure";
import { CompletenessFigure } from "@/components/place/completeness-figure";
import { InsightsGrid } from "@/components/insights/insights-grid";
import { AiInsight } from "@/components/narrative/ai-insight";
import { DIMENSION_LABEL } from "@/components/explore/demographics-figure";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentationSlide } from "@/components/present/presentation-slide";
import { PresentButton } from "@/components/present/present-button";

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
    benchmarkCtx,
    demographicsByDimension,
    training,
    honorarium,
    insights,
    childSummaries,
    completeness,
  ] = await Promise.all([
    // Benchmark context (E1.2): this place vs. its region and the nation, so
    // every figure answers "versus what?". Also carries the ancestors this page
    // needs for breadcrumbs/locator/fallback labels, so the ancestor fetch is
    // no longer duplicated here. Benchmarks are hidden entirely at national
    // level (`showBenchmarks`); the region row is omitted at and above region
    // level (`benchmarkCtx.region`).
    getBenchmarkContext(geo.geoCode, geo.geoLevel, geo.geoName),
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

  const ancestors = benchmarkCtx.ancestors;
  const overview = benchmarkCtx.self.overview;
  const counts = benchmarkCtx.self.counts;
  const showBenchmarks = benchmarkCtx.showBenchmarks;

  // Needs ancestors (fetched above) to pick the right boundary file, so it
  // can't join the first Promise.all; it's a cached local-file read, not a DB call.
  const locator = await getPlaceLocator(geo, ancestors);

  const childLevelLabel = CHILD_LEVEL_PLURAL[geo.geoLevel];

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

  // Title-slide facts for presentation mode (serializable, server → client).
  const deckMeta = {
    pageLabel: "Place profile",
    areaName: geo.geoName,
    filterChips: [
      ...breadcrumbAncestors.slice(1).map((a) => a.label),
      ...(geo.incomeClass ? [`Income class ${geo.incomeClass}`] : []),
    ],
    captionLine: caption,
  };

  return (
    <PresentationProvider meta={deckMeta}>
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
            <PresentButton variant="secondary" />
          </div>
          <div className="sm:w-64">
            <GeoSearch variant="compact" />
          </div>
        </div>

        <PresentationSlide id="ai-insight" title="AI insight">
          <AiInsight geoCode={geo.geoCode} geoLevel={geo.geoLevel} geoName={geo.geoName} />
        </PresentationSlide>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PresentationSlide id="accreditation" title="Accreditation">
            <FigureCard
              title="Accreditation"
              caption={caption}
              exportMenu={
                <ExportMenu
                  geoCode={geo.geoCode}
                  geoLevel={geo.geoLevel}
                  indicator="accreditation"
                />
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
                      95%{" "}
                      <GlossaryTerm slug="confidence_interval">
                        confidence interval
                      </GlossaryTerm>: {counts.ciLow}–{counts.ciHigh}%.
                    </>
                  ) : null}
                </p>
              }
              benchmark={
                showBenchmarks ? (
                  <BenchmarkBars
                    rows={benchmarkRowsFor(benchmarkCtx, (s) => s.counts?.pctAccredited ?? null)}
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
          </PresentationSlide>

          <PresentationSlide id="service-years" title="Average years of service">
            <FigureCard
              title="Average years of service"
              caption={caption}
              exportMenu={
                <ExportMenu
                  geoCode={geo.geoCode}
                  geoLevel={geo.geoLevel}
                  indicator="service_years"
                />
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
                    rows={benchmarkRowsFor(benchmarkCtx, (s) => s.counts?.avgActiveYears ?? null)}
                    format="count"
                    unitSuffix="yrs"
                  />
                ) : undefined
              }
            >
              <p className="text-4xl font-semibold tracking-tight">
                {counts?.avgActiveYears ?? "—"}
              </p>
            </FigureCard>
          </PresentationSlide>

          {overview.householdsPerBhw !== null && (
            <PresentationSlide id="households-per-bhw" title="Households per BHW">
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
                      rows={benchmarkRowsFor(benchmarkCtx, (s) => s.overview.householdsPerBhw)}
                      format="count"
                      unitSuffix="hh/BHW"
                    />
                  ) : undefined
                }
              >
                <p className="text-4xl font-semibold tracking-tight">{overview.householdsPerBhw}</p>
              </FigureCard>
            </PresentationSlide>
          )}

          {demographicsByDimension.map(({ dimension, rows }) => (
            <PresentationSlide
              key={dimension}
              id={`demographics-${dimension}`}
              title={`Demographics: ${DIMENSION_LABEL[dimension]}`}
            >
              <DemographicsFigure
                dimension={dimension}
                rows={rows}
                caption={caption}
                geoCode={geo.geoCode}
                geoLevel={geo.geoLevel}
              />
            </PresentationSlide>
          ))}

          <PresentationSlide id="training" title="Training coverage">
            <TrainingFigure
              rows={training}
              caption={caption}
              geoLevel={geo.geoLevel}
              citymunAncestor={ancestors.citymun}
              geoCode={geo.geoCode}
            />
          </PresentationSlide>

          <PresentationSlide id="honorarium" title="Honorarium">
            <HonorariumFigure
              rows={honorarium}
              caption={caption}
              geoCode={geo.geoCode}
              geoLevel={geo.geoLevel}
            />
          </PresentationSlide>

          <PresentationSlide id="completeness" title="Data completeness">
            <CompletenessFigure
              rows={completeness}
              caption={caption}
              geoLevel={geo.geoLevel}
              citymunAncestor={ancestors.citymun}
            />
          </PresentationSlide>
        </div>

        {childLevelLabel && childSummaries.length > 0 && (
          <PresentationSlide id="children-table" title={`Places within ${geo.geoName}`}>
            <ChildrenTable
              rows={childSummaries}
              childLevelLabel={childLevelLabel}
              showTrainingGap={geo.geoLevel !== "citymun"}
            />
          </PresentationSlide>
        )}

        <PresentationSlide id="insights" title="Insights">
          <InsightsGrid insights={insights} geoLevel={geo.geoLevel} geoName={geo.geoName} />
        </PresentationSlide>
      </div>
    </PresentationProvider>
  );
}
