import Link from "next/link";
import { loadFilterState } from "@/lib/filters/codec";
import {
  DEFAULT_BREAKDOWNS,
  DEFAULT_MAP_INDICATOR,
  NATIONAL_GEO_CODE,
  mapIndicatorTopicSlug,
  type GeoLevel,
  type MapBaseIndicator,
  type MapIndicator,
} from "@/lib/filters/schema";
import { getChildGeos, getGeoAncestors, resolveGeoOrNational } from "@/lib/db/geo";
import {
  getBhwCounts,
  getCertification,
  getChildIndicators,
  getChildTrainingCoverage,
  getDemographics,
  getHonorarium,
  getTrainingCoverage,
  type ChildIndicatorRow,
} from "@/lib/db/indicators";
import { getDataCompleteness, type CompletenessRow } from "@/lib/db/data-quality";
import {
  getCohorts,
  getWorkload,
  getHonorariumInequality,
  getIncomeClassEquity,
} from "@/lib/db/derived-figures";
import { formatIndicatorValue, metaForIndicator } from "@/lib/analysis/map-indicators";
import { computeDataQualityGrade } from "@/lib/analysis/data-quality-grade";
import type { ChildIndicator } from "@/components/explore/geo-comparison-figure";
import { getBhwOverview, coverageForDisplay } from "@/lib/db/stepzero";
import { getPeerRank } from "@/lib/db/peer-ranks";
import { getInsights } from "@/lib/db/insights";
import { GeoCascade } from "@/components/filters/geo-cascade";
import { BreakdownPicker } from "@/components/filters/breakdown-picker";
import { GeoSearch } from "@/components/home/geo-search";
import { ActiveFilterChips, type BreadcrumbStep } from "@/components/filters/active-filter-chips";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import { DenominatorExplainer } from "@/components/home/denominator-explainer";
import { BenchmarkBars, type BenchmarkRow } from "@/components/place/benchmark";
import { FigureTabs } from "@/components/ui/figure-tabs";
import { DemographicsFigure } from "@/components/explore/demographics-figure";
import { AccreditationSourcesFigure } from "@/components/explore/accreditation-sources-figure";
import { CertificationFigure } from "@/components/explore/certification-figure";
import { TrainingFigure } from "@/components/explore/training-figure";
import { HonorariumFigure } from "@/components/explore/honorarium-figure";
import { HonorariumAmountFigure } from "@/components/explore/honorarium-amount-figure";
import { HonorariumDistributionFigure } from "@/components/explore/honorarium-distribution-figure";
import { CompletenessFigure } from "@/components/place/completeness-figure";
import { DataQualityBadge } from "@/components/explore/data-quality-badge";
import { PeerRankChip } from "@/components/explore/peer-rank-chip";
import { GeoComparisonFigure } from "@/components/explore/geo-comparison-figure";
import { DistributionFigure } from "@/components/explore/distribution-figure";
import {
  RelationshipFigure,
  type RelationshipPoint,
} from "@/components/explore/relationship-figure";
import { getChildPoverty } from "@/lib/db/poverty";
import { CohortsFigure } from "@/components/explore/cohorts-figure";
import { WorkloadFigure } from "@/components/explore/workload-figure";
import { HonorariumInequalityFigure } from "@/components/explore/honorarium-inequality-figure";
import { IncomeClassFigure } from "@/components/explore/income-class-figure";
import { InsightsGrid } from "@/components/insights/insights-grid";
import { ChatLauncher } from "@/components/chat/chat-launcher";
import { DIMENSION_LABEL } from "@/components/explore/demographics-figure";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentationSlide } from "@/components/present/presentation-slide";
import { PresentButton } from "@/components/present/present-button";

const CHILD_LEVEL_LABEL: Record<GeoLevel, string> = {
  national: "Region",
  region: "Province",
  province: "City/Municipality",
  citymun: "Barangay",
  barangay: "Barangay",
};

const CHILD_LEVEL_LABEL_PLURAL: Record<GeoLevel, string> = {
  national: "Regions",
  region: "Provinces",
  province: "Cities/Municipalities",
  citymun: "Barangays",
  barangay: "Barangays",
};

export const metadata = { title: "Explore" };

function captionFor(nProfiles: number | null, geoName: string) {
  return `N = ${nProfiles !== null ? nProfiles.toLocaleString() : "—"} validated profiles · ${geoName} · 2025 snapshot`;
}

/** Pick a child's value for one base map indicator (E1.1). */
function mapBaseValue(row: ChildIndicatorRow, indicator: MapBaseIndicator): number | null {
  switch (indicator) {
    case "pct_accredited":
      return row.pctAccredited;
    case "any_honorarium_pct":
      return row.anyHonorariumPct;
    case "households_per_bhw":
      return row.householdsPerBhw;
    case "avg_active_years":
      return row.avgActiveYears;
    case "coverage_pct":
      return row.coveragePct;
    case "bhw_per_1000":
      return row.bhwPer1000;
  }
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const filters = loadFilterState(rawParams);
  const geo = await resolveGeoOrNational(filters.geoCode, filters.geoLevel);
  const breakdowns = filters.breakdowns ?? DEFAULT_BREAKDOWNS;

  // Only `ancestors` gates the second batch below (province/citymun/barangay
  // option lists need its resolved codes) — awaiting it alone first, then
  // running every independent query concurrently, cuts one full sequential
  // round-trip out of the page's server-rendering waterfall versus awaiting
  // all of batch one (including the slower demographics/training queries)
  // before batch two's three queries could even start.
  const ancestors = await getGeoAncestors(geo.geoCode, geo.geoLevel);

  // Benchmark context (E1.5, mirroring the place page): this place vs its region
  // and the nation. National is fetched only below the national level; the region
  // only below region level, so a region page never benchmarks against itself.
  const showBenchmarks = geo.geoLevel !== "national";
  const regionBenchmark =
    geo.geoLevel !== "national" && geo.geoLevel !== "region" ? ancestors.region : null;

  // E3 derived figures (cohorts, workload, honorarium inequality) are built down
  // to citymun only; a barangay falls back to its citymun ancestor, labeled —
  // mirroring the training/completeness fallback.
  const figureFallback = geo.geoLevel === "barangay" ? ancestors.citymun : null;
  const figureCode = figureFallback ? figureFallback.geoCode : geo.geoCode;
  const figureLevel: GeoLevel = figureFallback ? "citymun" : geo.geoLevel;
  const figureFallbackName = figureFallback ? figureFallback.geoName : null;

  const [
    regions,
    overview,
    counts,
    demographicsByDimension,
    training,
    honorarium,
    certification,
    completeness,
    citymunCompleteness,
    provinces,
    citymuns,
    barangays,
    insights,
    nationalOverview,
    nationalCounts,
    regionOverview,
    regionCounts,
    cohorts,
    workload,
    honorariumInequality,
    incomeClassEquity,
  ] = await Promise.all([
    getChildGeos(NATIONAL_GEO_CODE, "national"),
    getBhwOverview(geo.geoCode, geo.geoLevel),
    getBhwCounts(geo.geoCode, geo.geoLevel),
    Promise.all(
      breakdowns.map(async (dimension) => ({
        dimension,
        rows: await getDemographics(geo.geoCode, geo.geoLevel, [dimension]),
      })),
    ),
    getTrainingCoverage(geo.geoCode, geo.geoLevel),
    getHonorarium(geo.geoCode, geo.geoLevel),
    getCertification(geo.geoCode, geo.geoLevel),
    getDataCompleteness(geo.geoCode, geo.geoLevel),
    // Completeness is citymun-grain; a barangay has no rows, so fetch its
    // citymun's for the data-quality grade (E2.5), mirroring CompletenessFigure.
    geo.geoLevel === "barangay" && ancestors.citymun
      ? getDataCompleteness(ancestors.citymun.geoCode, "citymun")
      : Promise.resolve([] as CompletenessRow[]),
    ancestors.region ? getChildGeos(ancestors.region.geoCode, "region") : Promise.resolve([]),
    ancestors.province ? getChildGeos(ancestors.province.geoCode, "province") : Promise.resolve([]),
    ancestors.citymun ? getChildGeos(ancestors.citymun.geoCode, "citymun") : Promise.resolve([]),
    getInsights(geo.geoLevel, geo.geoCode, geo.geoName),
    showBenchmarks ? getBhwOverview(NATIONAL_GEO_CODE, "national") : Promise.resolve(null),
    showBenchmarks ? getBhwCounts(NATIONAL_GEO_CODE, "national") : Promise.resolve(null),
    regionBenchmark ? getBhwOverview(regionBenchmark.geoCode, "region") : Promise.resolve(null),
    regionBenchmark ? getBhwCounts(regionBenchmark.geoCode, "region") : Promise.resolve(null),
    getCohorts(figureCode, figureLevel),
    getWorkload(figureCode, figureLevel),
    getHonorariumInequality(figureCode, figureLevel),
    geo.geoLevel === "national" ? getIncomeClassEquity() : Promise.resolve([]),
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

  const breadcrumbSteps: BreadcrumbStep[] = [
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
    ...(ancestors.citymun
      ? [
          {
            label: ancestors.citymun.geoName,
            geoLevel: "citymun" as const,
            geoCode: ancestors.citymun.geoCode,
          },
        ]
      : []),
    ...(geo.geoLevel === "barangay"
      ? [{ label: geo.geoName, geoLevel: "barangay" as const, geoCode: geo.geoCode }]
      : []),
  ];

  const caption = captionFor(overview.validatedProfiles ?? null, geo.geoName);
  const coverage = coverageForDisplay(overview);

  // Read-time data-quality grade (E2.5). At barangay (no completeness rows) it
  // describes the citymun it falls back to, labeled as such.
  const gradeRows = geo.geoLevel === "barangay" ? citymunCompleteness : completeness;
  const dataQualityGrade = computeDataQualityGrade(gradeRows);
  const gradeFallbackName =
    geo.geoLevel === "barangay" && citymunCompleteness.length > 0
      ? (ancestors.citymun?.geoName ?? null)
      : null;

  // The children the comparison figure ranks. This goes one level deeper than the
  // *map* (E1.6): national→region, region→province, province→citymun, and
  // citymun→barangay. Only the first three have boundary files; at citymun the
  // figure renders list-only (no choropleth) with the map-absence stub above it.
  const compareChildLevel: GeoLevel | null =
    geo.geoLevel === "national"
      ? "region"
      : geo.geoLevel === "region"
        ? "province"
        : geo.geoLevel === "province"
          ? "citymun"
          : geo.geoLevel === "citymun"
            ? "barangay"
            : null;
  const mapChildren =
    geo.geoLevel === "national"
      ? regions
      : geo.geoLevel === "region"
        ? provinces
        : geo.geoLevel === "province"
          ? citymuns
          : geo.geoLevel === "citymun"
            ? barangays
            : [];
  // Boundary files exist only down to citymun polygons (province view); barangay
  // choropleths are deferred to Phase 2's PMTiles work (BUILD_PLAN §2/§4.3), so
  // at citymun the map is absent and only the ranked list renders.
  const mapGeojsonUrl =
    geo.geoLevel === "national"
      ? "/geo/regions.json"
      : geo.geoLevel === "region"
        ? `/geo/provinces/${geo.geoCode}.json`
        : geo.geoLevel === "province"
          ? `/geo/citymun/${geo.geoCode}.json`
          : null;
  // Indicator switcher (E1.1). Topics come from the parent's training rows; an
  // active `training:` indicator whose topic isn't available here falls back to
  // the default accreditation view so a stale permalink never shows all-grey.
  // `agg_training` has no barangay rows, so the switcher's training option is
  // suppressed when the children are barangays (citymun view) — otherwise it
  // would offer a topic every child renders as no-data.
  const trainingTopics =
    compareChildLevel === "barangay"
      ? []
      : training
          .filter((r) => r.topicSlug)
          .map((r) => ({ slug: r.topicSlug, label: r.topicLabel ?? r.topicSlug }))
          .sort((a, b) => a.label.localeCompare(b.label));

  const requestedSlug = mapIndicatorTopicSlug(filters.mapIndicator);
  const activeMapIndicator: MapIndicator =
    requestedSlug !== null && !trainingTopics.some((t) => t.slug === requestedSlug)
      ? DEFAULT_MAP_INDICATOR
      : filters.mapIndicator;
  const activeSlug = mapIndicatorTopicSlug(activeMapIndicator);
  const activeTopicLabel = activeSlug
    ? (trainingTopics.find((t) => t.slug === activeSlug)?.label ?? activeSlug)
    : null;
  const mapMeta = metaForIndicator(activeMapIndicator, activeTopicLabel);

  let mapItems: ChildIndicator[] = [];
  // Empirical-Bayes adjusted values per child for the accreditation map (E3.6),
  // populated only when accreditation is active and the children are at
  // citymun/barangay grain (the levels adjusted). Undefined hides the toggle.
  let adjustedMapItems: ChildIndicator[] | undefined;
  // Full base-indicator rows per child, shared by the map (mapItems) and the
  // relationships scatter (E1.4, which needs every base value, not just the
  // active one) — one query, two figures.
  let childIndicators: ChildIndicatorRow[] = [];
  // Relationships scatter points (E1.4) = child base indicators + the external PSA SAE poverty
  // variable (E4.4), which carries data only where children are cities/municipalities.
  let relationshipPoints: RelationshipPoint[] = [];
  if (compareChildLevel) {
    const childCodes = mapChildren.map((c) => c.geoCode);
    const [childRows, trainingCoverage, povertyByCode] = await Promise.all([
      getChildIndicators(childCodes),
      activeSlug ? getChildTrainingCoverage(childCodes, activeSlug) : Promise.resolve(null),
      compareChildLevel === "citymun"
        ? getChildPoverty(childCodes)
        : Promise.resolve(new Map<string, { incidence: number }>()),
    ]);
    childIndicators = childRows;
    relationshipPoints = childRows.map((c) => ({
      ...c,
      povertyIncidence: povertyByCode.get(c.geoCode)?.incidence ?? null,
    }));
    mapItems = childIndicators.map((c) => {
      if (trainingCoverage) {
        const t = trainingCoverage.get(c.geoCode);
        return {
          geoCode: c.geoCode,
          geoName: c.geoName,
          value: t?.coveragePct ?? null,
          nTotal: t?.nTotal ?? c.nTotal,
        };
      }
      return {
        geoCode: c.geoCode,
        geoName: c.geoName,
        value: mapBaseValue(c, activeMapIndicator as MapBaseIndicator),
        nTotal: c.nTotal,
      };
    });

    if (
      activeMapIndicator === "pct_accredited" &&
      (compareChildLevel === "citymun" || compareChildLevel === "barangay") &&
      childIndicators.some((c) => c.adjustedPctAccredited !== null)
    ) {
      adjustedMapItems = childIndicators.map((c) => ({
        geoCode: c.geoCode,
        geoName: c.geoName,
        value: c.adjustedPctAccredited,
        nTotal: c.nTotal,
      }));
    }
  }

  // The parent geo's own value for the active indicator — the distribution
  // figure's marker (E1.3), sourced identically to the summary strip so the two
  // never disagree.
  let parentValue: number | null = null;
  if (activeSlug) {
    parentValue = training.find((r) => r.topicSlug === activeSlug)?.coveragePct ?? null;
  } else {
    switch (activeMapIndicator as MapBaseIndicator) {
      case "pct_accredited":
        parentValue = counts?.pctAccredited ?? null;
        break;
      case "any_honorarium_pct":
        parentValue = counts?.anyHonorariumPct ?? null;
        break;
      case "households_per_bhw":
        parentValue = overview.householdsPerBhw;
        break;
      case "avg_active_years":
        parentValue = counts?.avgActiveYears ?? null;
        break;
      case "coverage_pct":
        parentValue = coverage;
        break;
      case "bhw_per_1000":
        parentValue = overview.bhwPer1000;
        break;
    }
  }

  // Peer standing of the current geo among its same-level siblings for the active
  // base indicator (E2.3). Only region/province/citymun are ranked; training
  // indicators and national/barangay have no row.
  const PEER_LEVEL_PLURAL: Partial<Record<GeoLevel, string>> = {
    region: "regions",
    province: "provinces",
    citymun: "cities/municipalities",
  };
  const activeBaseIndicator: MapBaseIndicator | null = activeSlug
    ? null
    : (activeMapIndicator as MapBaseIndicator);
  const peerRank =
    activeBaseIndicator && PEER_LEVEL_PLURAL[geo.geoLevel]
      ? await getPeerRank(geo.geoCode, geo.geoLevel, activeBaseIndicator)
      : null;
  const peerParentName =
    geo.geoLevel === "region"
      ? "the Philippines"
      : geo.geoLevel === "province"
        ? (ancestors.region?.geoName ?? null)
        : geo.geoLevel === "citymun"
          ? (ancestors.province?.geoName ?? null)
          : null;

  // Title-slide facts for presentation mode: where we are, which filters are
  // active, and the page's caption line — all serializable (server → client).
  const deckMeta = {
    pageLabel: "Explore",
    areaName: geo.geoName,
    filterChips: [
      ...breadcrumbSteps.slice(1).map((s) => s.label),
      ...(filters.breakdowns ?? []).map((d) => DIMENSION_LABEL[d]),
    ],
    captionLine: caption,
  };

  return (
    <PresentationProvider meta={deckMeta}>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:flex-row">
        <h1 className="sr-only">Explore BHW figures for {geo.geoName}</h1>
        <aside className="flex flex-col gap-6 lg:w-64 lg:shrink-0">
          {/* Jump straight to any place without walking the cascade (E1.6). In
            explore mode the search stays on /explore with the geo applied as
            filters, rather than leaving for the place page. */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted" htmlFor="geo-search-input">
              Jump to a place
            </label>
            <GeoSearch variant="compact" mode="explore" />
          </div>
          <GeoCascade
            regions={regions}
            provinces={provinces}
            citymuns={citymuns}
            barangays={barangays}
            selected={{
              regionCode: ancestors.region?.geoCode ?? null,
              provinceCode: ancestors.province?.geoCode ?? null,
              citymunCode: ancestors.citymun?.geoCode ?? null,
              barangayCode: geo.geoLevel === "barangay" ? geo.geoCode : null,
            }}
          />
          <BreakdownPicker />
        </aside>

        <div className="flex flex-1 flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ActiveFilterChips steps={breadcrumbSteps} />
            <PresentButton />
          </div>

          {/* Summary strip (E1.2) + benchmark context (E1.5), consolidated into
            one block so a headline figure is never shown twice. The count/
            context metrics (which have no vs-region/vs-nation comparison) sit on
            the top line; the three comparative metrics (% accredited, avg years,
            households per BHW) render once below — with benchmark bars when this
            isn't the national view, and as plain values at national (nothing
            above it to compare against). */}
          <PresentationSlide id="at-a-glance" title={`${geo.geoName} at a glance`}>
            <section
              aria-labelledby="area-summary-heading"
              className="rounded-lg border border-border bg-surface px-4 py-3"
            >
              <h2
                id="area-summary-heading"
                className="text-xs font-semibold uppercase tracking-wide text-muted"
              >
                {geo.geoName} at a glance
              </h2>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                <span>
                  <span className="font-semibold">
                    {overview.totalBhw?.toLocaleString() ?? "—"}
                  </span>{" "}
                  <span className="text-muted">total BHWs</span>
                </span>
                <span>
                  <span className="font-semibold">
                    {overview.validatedProfiles?.toLocaleString() ?? "—"}
                  </span>{" "}
                  <span className="text-muted">
                    <GlossaryTerm slug="validated_profile">validated profiles</GlossaryTerm>
                    {coverage !== null ? ` (${coverage}% of registered)` : ""}
                  </span>
                </span>
                {overview.bhwPer1000 !== null && (
                  <span>
                    <span className="font-semibold">
                      {formatIndicatorValue(overview.bhwPer1000, "")}
                    </span>{" "}
                    <span className="text-muted">
                      <GlossaryTerm slug="bhw_per_1000">BHWs per 1,000 residents</GlossaryTerm>
                    </span>
                  </span>
                )}
                {!overview.hasStepzero && (
                  <span className="text-xs text-muted">
                    Quick-count total not available for this area.
                  </span>
                )}
              </div>

              {/* The three comparative headline metrics — shown once here. With
                vs-region/vs-nation bars below the national level; plain values at
                national. This replaces the former standalone benchmark block. */}
              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
                <div>
                  <p className="mb-1 text-xs font-medium">
                    <GlossaryTerm slug="accredited">% accredited</GlossaryTerm>
                  </p>
                  {showBenchmarks ? (
                    <BenchmarkBars
                      rows={benchmarkRows(
                        counts?.pctAccredited ?? null,
                        regionCounts?.pctAccredited ?? null,
                        nationalCounts?.pctAccredited ?? null,
                      )}
                      format="percent"
                    />
                  ) : (
                    <p className="text-sm font-semibold">
                      {counts?.pctAccredited != null
                        ? formatIndicatorValue(counts.pctAccredited, "%")
                        : "—"}
                    </p>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium">Avg years of service</p>
                  {showBenchmarks ? (
                    <BenchmarkBars
                      rows={benchmarkRows(
                        counts?.avgActiveYears ?? null,
                        regionCounts?.avgActiveYears ?? null,
                        nationalCounts?.avgActiveYears ?? null,
                      )}
                      format="count"
                      unitSuffix="yrs"
                    />
                  ) : (
                    <p className="text-sm font-semibold">
                      {counts?.avgActiveYears != null
                        ? formatIndicatorValue(counts.avgActiveYears, "")
                        : "—"}
                    </p>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium">
                    <GlossaryTerm slug="households_per_bhw">Households per BHW</GlossaryTerm>
                  </p>
                  {showBenchmarks ? (
                    <BenchmarkBars
                      rows={benchmarkRows(
                        overview.householdsPerBhw,
                        regionOverview?.householdsPerBhw ?? null,
                        nationalOverview?.householdsPerBhw ?? null,
                      )}
                      format="count"
                      unitSuffix="hh/BHW"
                    />
                  ) : (
                    <p className="text-sm font-semibold">
                      {overview.householdsPerBhw != null
                        ? overview.householdsPerBhw.toLocaleString()
                        : "—"}
                    </p>
                  )}
                </div>
              </div>

              {overview.hasStepzero && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-muted hover:text-accent">
                    How are these BHWs counted?
                  </summary>
                  <div className="mt-2">
                    <DenominatorExplainer
                      totalBhw={overview.totalBhw}
                      registeredUniverse={overview.registeredUniverse}
                      validatedProfiles={overview.validatedProfiles}
                      coveragePct={coverage}
                    />
                  </div>
                </details>
              )}
            </section>
          </PresentationSlide>

          {/* Data-quality grade (E2.5) — one honest letter for how complete the
            profiles behind these figures are, linking the full breakdown. */}
          <DataQualityBadge grade={dataQualityGrade} fallbackCitymunName={gradeFallbackName} />

          {/* Map-absence stub (E1.6) — at citymun/barangay there's no choropleth
            (barangay boundaries are on the roadmap). At citymun the ranked list
            still renders below; barangay is a leaf with no children to rank. */}
          {mapGeojsonUrl === null && (
            <div className="rounded-lg border border-dashed border-border bg-surface/60 px-4 py-3 text-sm">
              <p className="font-medium">
                Maps below the city/municipality level are on the roadmap.
              </p>
              <p className="mt-1 text-muted">
                {compareChildLevel
                  ? `Barangay choropleths aren't available yet, so the ranked list below covers every barangay in ${geo.geoName}.`
                  : `Barangay-level maps aren't available yet — the figures below describe ${geo.geoName}.`}{" "}
                <Link href="/roadmap" className="underline hover:text-accent">
                  See the roadmap
                </Link>
                .
              </p>
            </div>
          )}

          {/* Comparison figure (E1.2 hero) — the indicator switcher is the page's
            centerpiece. Full choropleth at national/region/province; list-only
            (no boundary file) at citymun, under the stub above. */}
          {compareChildLevel && (
            <PresentationSlide id="geo-comparison" title={`Map: ${mapMeta.label}`}>
              <GeoComparisonFigure
                key={geo.geoCode}
                geojsonUrl={mapGeojsonUrl}
                childLevel={compareChildLevel}
                childLevelLabel={CHILD_LEVEL_LABEL[geo.geoLevel]}
                items={mapItems}
                adjustedItems={adjustedMapItems}
                caption={caption}
                activeIndicator={activeMapIndicator}
                meta={mapMeta}
                trainingTopics={trainingTopics}
              />
            </PresentationSlide>
          )}

          {/* Peer-standing chip (E2.3): how this geo ranks among its siblings on
            the active indicator. */}
          <PeerRankChip
            rank={peerRank}
            geoName={geo.geoName}
            parentName={peerParentName}
            siblingPlural={PEER_LEVEL_PLURAL[geo.geoLevel] ?? ""}
            indicatorLabel={mapMeta.label}
          />

          {/* Distribution view (E1.3) — spread of the active indicator across
            children, reusing the map's data. */}
          {compareChildLevel && mapItems.length > 0 && (
            <PresentationSlide id="distribution" title={`Distribution: ${mapMeta.label}`}>
              <DistributionFigure
                key={`${geo.geoCode}-${activeMapIndicator}`}
                items={mapItems}
                parentValue={parentValue}
                parentName={geo.geoName}
                childLevelLabel={CHILD_LEVEL_LABEL[geo.geoLevel]}
                childLevelLabelPlural={CHILD_LEVEL_LABEL_PLURAL[geo.geoLevel]}
                meta={mapMeta}
                caption={caption}
              />
            </PresentationSlide>
          )}

          {/* Relationships view (E1.4) — scatter of children on two chosen
            indicators + Spearman-in-words, reusing the same child rows. */}
          {compareChildLevel && childIndicators.length > 0 && (
            <PresentationSlide id="relationships" title="Relationships between indicators">
              <RelationshipFigure
                key={geo.geoCode}
                points={relationshipPoints}
                childLevel={compareChildLevel}
                childLevelLabelPlural={CHILD_LEVEL_LABEL_PLURAL[geo.geoLevel]}
                caption={caption}
              />
            </PresentationSlide>
          )}

          {/* Per-theme figure groups (E1.5 parity): certification, demographics,
            training, and completeness — each now responding to the geo filter,
            with exports, matching what the place page shows for one geo. */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <PresentationSlide id="accreditation-sources" title="Accreditation sources">
              <AccreditationSourcesFigure
                lguReported={overview.pctRegisteredAccredited}
                verified={counts?.pctAccredited ?? null}
                verifiedCi={counts ? { low: counts.ciLow, high: counts.ciHigh } : null}
                caption={caption}
              />
            </PresentationSlide>

            <PresentationSlide id="certification" title="Certification">
              <CertificationFigure
                rows={certification}
                caption={caption}
                geoCode={geo.geoCode}
                geoLevel={geo.geoLevel}
              />
            </PresentationSlide>

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

            <PresentationSlide id="completeness" title="Data completeness">
              <CompletenessFigure
                rows={completeness}
                caption={caption}
                geoLevel={geo.geoLevel}
                citymunAncestor={ancestors.citymun}
              />
            </PresentationSlide>

            {/* Workload distribution (E3.4) — how many households each BHW covers. */}
            <PresentationSlide id="workload" title="Workload">
              <WorkloadFigure
                row={workload}
                caption={caption}
                geoLevel={geo.geoLevel}
                fallbackCitymunName={figureFallbackName}
              />
            </PresentationSlide>
          </div>

          {/* Joining waves (E3.2) — when today's BHWs reached each milestone. */}
          <PresentationSlide id="cohorts" title="Joining waves">
            <CohortsFigure
              rows={cohorts}
              caption={caption}
              geoLevel={geo.geoLevel}
              fallbackCitymunName={figureFallbackName}
            />
          </PresentationSlide>

          {/* Income-class equity (E3.7) — national scope only. */}
          {geo.geoLevel === "national" && incomeClassEquity.length > 0 && (
            <PresentationSlide id="income-class" title="Income-class equity">
              <IncomeClassFigure rows={incomeClassEquity} caption={caption} />
            </PresentationSlide>
          )}

          {/* One honorarium story told three ways — tabbed, exactly as Home does
            it, but scoped to the selected geo (E1.5). */}
          <PresentationSlide id="honorarium" title="Honorarium">
            <FigureTabs
              heading="Honorarium"
              tabs={[
                {
                  id: "who",
                  label: "Who receives",
                  content: (
                    <HonorariumFigure
                      rows={honorarium}
                      caption={caption}
                      geoCode={geo.geoCode}
                      geoLevel={geo.geoLevel}
                    />
                  ),
                },
                {
                  id: "amount",
                  label: "How much",
                  content: (
                    <HonorariumAmountFigure
                      rows={honorarium}
                      caption={caption}
                      geoCode={geo.geoCode}
                      geoLevel={geo.geoLevel}
                    />
                  ),
                },
                {
                  id: "distribution",
                  label: "Distribution",
                  content: (
                    <HonorariumDistributionFigure
                      rows={honorarium}
                      caption={caption}
                      geoCode={geo.geoCode}
                      geoLevel={geo.geoLevel}
                    />
                  ),
                },
                {
                  id: "inequality",
                  label: "Inequality",
                  content: (
                    <HonorariumInequalityFigure
                      row={honorariumInequality}
                      caption={caption}
                      geoLevel={geo.geoLevel}
                      fallbackCitymunName={figureFallbackName}
                    />
                  ),
                },
              ]}
            />
          </PresentationSlide>

          <PresentationSlide id="insights" title="Insights">
            <InsightsGrid insights={insights} geoLevel={geo.geoLevel} geoName={geo.geoName} />
          </PresentationSlide>
        </div>

        <ChatLauncher geoCode={geo.geoCode} geoLevel={geo.geoLevel} geoName={geo.geoName} />
      </div>
    </PresentationProvider>
  );
}
