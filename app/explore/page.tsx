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
  getChildIndicators,
  getChildTrainingCoverage,
  getDemographics,
  getHonorarium,
  getTrainingCoverage,
  type ChildIndicatorRow,
} from "@/lib/db/indicators";
import { formatIndicatorValue, metaForIndicator } from "@/lib/analysis/map-indicators";
import type { ChildIndicator } from "@/components/explore/geo-comparison-figure";
import { getBhwOverview, coverageForDisplay } from "@/lib/db/stepzero";
import { getInsights } from "@/lib/db/insights";
import { GeoCascade } from "@/components/filters/geo-cascade";
import { BreakdownPicker } from "@/components/filters/breakdown-picker";
import { ActiveFilterChips, type BreadcrumbStep } from "@/components/filters/active-filter-chips";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import { DenominatorExplainer } from "@/components/home/denominator-explainer";
import { DemographicsFigure } from "@/components/explore/demographics-figure";
import { TrainingFigure } from "@/components/explore/training-figure";
import { HonorariumFigure } from "@/components/explore/honorarium-figure";
import { GeoComparisonFigure } from "@/components/explore/geo-comparison-figure";
import { DistributionFigure } from "@/components/explore/distribution-figure";
import { RelationshipFigure } from "@/components/explore/relationship-figure";
import { InsightsGrid } from "@/components/insights/insights-grid";
import { ChatLauncher } from "@/components/chat/chat-launcher";

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

  const [
    regions,
    overview,
    counts,
    demographicsByDimension,
    training,
    honorarium,
    provinces,
    citymuns,
    barangays,
    insights,
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
    ancestors.region ? getChildGeos(ancestors.region.geoCode, "region") : Promise.resolve([]),
    ancestors.province ? getChildGeos(ancestors.province.geoCode, "province") : Promise.resolve([]),
    ancestors.citymun ? getChildGeos(ancestors.citymun.geoCode, "citymun") : Promise.resolve([]),
    getInsights(geo.geoLevel, geo.geoCode, geo.geoName),
  ]);

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

  // Map-capable levels only go down to citymun (BUILD_PLAN.md §2/§4.3 — barangay
  // choropleths are deferred to Phase 2's PMTiles work). At citymun/barangay,
  // this figure is simply omitted rather than shown broken/empty.
  const mapChildLevel: GeoLevel | null =
    geo.geoLevel === "national"
      ? "region"
      : geo.geoLevel === "region"
        ? "province"
        : geo.geoLevel === "province"
          ? "citymun"
          : null;
  const mapChildren =
    geo.geoLevel === "national"
      ? regions
      : geo.geoLevel === "region"
        ? provinces
        : geo.geoLevel === "province"
          ? citymuns
          : [];
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
  const trainingTopics = training
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
  // Full base-indicator rows per child, shared by the map (mapItems) and the
  // relationships scatter (E1.4, which needs every base value, not just the
  // active one) — one query, two figures.
  let childIndicators: ChildIndicatorRow[] = [];
  if (mapChildLevel) {
    const childCodes = mapChildren.map((c) => c.geoCode);
    const [childRows, trainingCoverage] = await Promise.all([
      getChildIndicators(childCodes),
      activeSlug ? getChildTrainingCoverage(childCodes, activeSlug) : Promise.resolve(null),
    ]);
    childIndicators = childRows;
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
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:flex-row">
      <h1 className="sr-only">Explore BHW figures for {geo.geoName}</h1>
      <aside className="flex flex-col gap-6 lg:w-64 lg:shrink-0">
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
        <ActiveFilterChips steps={breadcrumbSteps} />

        {/* Summary strip (E1.2): labeled, glossary-linked, with a collapsed
            denominator explainer. The two big-number cards (accreditation, avg
            years) were removed — their figures live here and, for children, in
            the map indicator switcher. */}
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
              <span className="font-semibold">{overview.totalBhw?.toLocaleString() ?? "—"}</span>{" "}
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
            <span>
              <span className="font-semibold">
                {counts?.pctAccredited !== null && counts?.pctAccredited !== undefined
                  ? formatIndicatorValue(counts.pctAccredited, "%")
                  : "—"}
              </span>{" "}
              <span className="text-muted">
                <GlossaryTerm slug="accredited">accredited</GlossaryTerm>
              </span>
            </span>
            <span>
              <span className="font-semibold">
                {counts?.avgActiveYears !== null && counts?.avgActiveYears !== undefined
                  ? formatIndicatorValue(counts.avgActiveYears, "")
                  : "—"}
              </span>{" "}
              <span className="text-muted">avg years of service</span>
            </span>
            {overview.householdsPerBhw !== null && (
              <span>
                <span className="font-semibold">
                  {overview.householdsPerBhw.toLocaleString()}
                </span>{" "}
                <span className="text-muted">
                  <GlossaryTerm slug="households_per_bhw">households per BHW</GlossaryTerm>
                </span>
              </span>
            )}
            {!overview.hasStepzero && (
              <span className="text-xs text-muted">
                Quick-count total not available for this area.
              </span>
            )}
          </div>
          {overview.hasStepzero && (
            <details className="mt-2.5 text-xs">
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

        {/* Map figure (E1.2 hero) — the indicator switcher is the page's
            centerpiece, full-width above the per-theme figure groups. */}
        {mapChildLevel && (
          <GeoComparisonFigure
            key={geo.geoCode}
            geojsonUrl={mapGeojsonUrl}
            childLevel={mapChildLevel}
            childLevelLabel={CHILD_LEVEL_LABEL[geo.geoLevel]}
            items={mapItems}
            caption={caption}
            activeIndicator={activeMapIndicator}
            meta={mapMeta}
            trainingTopics={trainingTopics}
          />
        )}

        {/* Distribution view (E1.3) — spread of the active indicator across
            children, reusing the map's data. */}
        {mapChildLevel && mapItems.length > 0 && (
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
        )}

        {/* Relationships view (E1.4) — scatter of children on two chosen
            indicators + Spearman-in-words, reusing the same child rows. */}
        {mapChildLevel && childIndicators.length > 0 && (
          <RelationshipFigure
            key={geo.geoCode}
            points={childIndicators}
            childLevel={mapChildLevel}
            childLevelLabelPlural={CHILD_LEVEL_LABEL_PLURAL[geo.geoLevel]}
            caption={caption}
          />
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
          />

          <HonorariumFigure rows={honorarium} caption={caption} />
        </div>

        <InsightsGrid insights={insights} geoLevel={geo.geoLevel} geoName={geo.geoName} />
      </div>

      <ChatLauncher geoCode={geo.geoCode} geoLevel={geo.geoLevel} geoName={geo.geoName} />
    </div>
  );
}
