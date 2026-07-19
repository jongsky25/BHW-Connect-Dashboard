import { loadFilterState } from "@/lib/filters/codec";
import { DEFAULT_BREAKDOWNS, NATIONAL_GEO_CODE, type GeoLevel } from "@/lib/filters/schema";
import { getChildGeos, getGeoAncestors, resolveGeoOrNational } from "@/lib/db/geo";
import {
  getBhwCounts,
  getChildIndicators,
  getDemographics,
  getHonorarium,
  getTrainingCoverage,
} from "@/lib/db/indicators";
import { getBhwOverview, coverageForDisplay } from "@/lib/db/stepzero";
import { GeoCascade } from "@/components/filters/geo-cascade";
import { BreakdownPicker } from "@/components/filters/breakdown-picker";
import { ActiveFilterChips, type BreadcrumbStep } from "@/components/filters/active-filter-chips";
import { FigureCard } from "@/components/narrative/figure-card";
import { ExportMenu } from "@/components/narrative/export-menu";
import { DemographicsFigure } from "@/components/explore/demographics-figure";
import { TrainingFigure } from "@/components/explore/training-figure";
import { HonorariumFigure } from "@/components/explore/honorarium-figure";
import { GeoComparisonFigure } from "@/components/explore/geo-comparison-figure";
import { ChatLauncher } from "@/components/chat/chat-launcher";

const CHILD_LEVEL_LABEL: Record<GeoLevel, string> = {
  national: "Region",
  region: "Province",
  province: "City/Municipality",
  citymun: "Barangay",
  barangay: "Barangay",
};

export const metadata = { title: "Explore" };

function captionFor(nProfiles: number | null, geoName: string) {
  return `N = ${nProfiles !== null ? nProfiles.toLocaleString() : "—"} validated profiles · ${geoName} · 2025 snapshot`;
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

  const [regions, overview, counts, demographicsByDimension, training, honorarium, provinces, citymuns, barangays] =
    await Promise.all([
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
    ]);

  const breadcrumbSteps: BreadcrumbStep[] = [
    { label: "Philippines", geoLevel: "national", geoCode: NATIONAL_GEO_CODE },
    ...(ancestors.region ? [{ label: ancestors.region.geoName, geoLevel: "region" as const, geoCode: ancestors.region.geoCode }] : []),
    ...(ancestors.province ? [{ label: ancestors.province.geoName, geoLevel: "province" as const, geoCode: ancestors.province.geoCode }] : []),
    ...(ancestors.citymun ? [{ label: ancestors.citymun.geoName, geoLevel: "citymun" as const, geoCode: ancestors.citymun.geoCode }] : []),
    ...(geo.geoLevel === "barangay" ? [{ label: geo.geoName, geoLevel: "barangay" as const, geoCode: geo.geoCode }] : []),
  ];

  const caption = captionFor(overview.validatedProfiles ?? null, geo.geoName);
  const coverage = coverageForDisplay(overview);

  // Map-capable levels only go down to citymun (BUILD_PLAN.md §2/§4.3 — barangay
  // choropleths are deferred to Phase 2's PMTiles work). At citymun/barangay,
  // this figure is simply omitted rather than shown broken/empty.
  const mapChildLevel: GeoLevel | null =
    geo.geoLevel === "national" ? "region" : geo.geoLevel === "region" ? "province" : geo.geoLevel === "province" ? "citymun" : null;
  const mapChildren = geo.geoLevel === "national" ? regions : geo.geoLevel === "region" ? provinces : geo.geoLevel === "province" ? citymuns : [];
  const mapGeojsonUrl =
    geo.geoLevel === "national"
      ? "/geo/regions.json"
      : geo.geoLevel === "region"
        ? `/geo/provinces/${geo.geoCode}.json`
        : geo.geoLevel === "province"
          ? `/geo/citymun/${geo.geoCode}.json`
          : null;
  const childIndicators = mapChildLevel ? await getChildIndicators(mapChildren.map((c) => c.geoCode)) : [];

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

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <span>
            <span className="font-semibold">{overview.totalBhw?.toLocaleString() ?? "—"}</span>{" "}
            <span className="text-muted">total BHWs</span>
          </span>
          <span>
            <span className="font-semibold">{overview.validatedProfiles?.toLocaleString() ?? "—"}</span>{" "}
            <span className="text-muted">
              validated profiles{coverage !== null ? ` (${coverage}% of registered)` : ""}
            </span>
          </span>
          {!overview.hasStepzero && (
            <span className="text-xs text-muted">Quick-count total not available for this area.</span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <FigureCard
            title="Accreditation"
            caption={caption}
            exportMenu={<ExportMenu geoCode={geo.geoCode} geoLevel={geo.geoLevel} indicator="accreditation" />}
            headline={
              counts?.pctAccredited !== null && counts?.pctAccredited !== undefined
                ? `About ${Math.round(counts.pctAccredited)}% of profiled BHWs here are accredited.`
                : "No accreditation data available."
            }
            technicalDetails={
              <p>
                {counts?.nAccredited?.toLocaleString() ?? "—"} of {counts?.nTotal?.toLocaleString() ?? "—"}{" "}
                validated profiles are accredited ({counts?.pctAccredited ?? "—"}%).
              </p>
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
            headline={
              counts?.avgActiveYears !== null && counts?.avgActiveYears !== undefined
                ? `BHWs here have served an average of ${counts.avgActiveYears} years.`
                : "No service-year data available."
            }
            technicalDetails={<p>Computed from each BHW&apos;s recorded active-service years.</p>}
          >
            <p className="text-4xl font-semibold tracking-tight">
              {counts?.avgActiveYears ?? "—"}
            </p>
          </FigureCard>

          {mapChildLevel && (
            <div className="xl:col-span-2">
              <GeoComparisonFigure
                geojsonUrl={mapGeojsonUrl}
                childLevel={mapChildLevel}
                childLevelLabel={CHILD_LEVEL_LABEL[geo.geoLevel]}
                items={childIndicators}
                caption={caption}
              />
            </div>
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
          />

          <HonorariumFigure rows={honorarium} caption={caption} />
        </div>
      </div>

      <ChatLauncher geoCode={geo.geoCode} geoLevel={geo.geoLevel} geoName={geo.geoName} />
    </div>
  );
}
