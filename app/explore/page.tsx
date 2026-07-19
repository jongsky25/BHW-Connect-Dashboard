import { loadFilterState } from "@/lib/filters/codec";
import { DEFAULT_BREAKDOWNS, NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import { getChildGeos, getGeoAncestors, resolveGeoOrNational } from "@/lib/db/geo";
import { getBhwCounts, getDemographics, getHonorarium, getTrainingCoverage } from "@/lib/db/indicators";
import { GeoCascade } from "@/components/filters/geo-cascade";
import { BreakdownPicker } from "@/components/filters/breakdown-picker";
import { ActiveFilterChips, type BreadcrumbStep } from "@/components/filters/active-filter-chips";
import { FigureCard } from "@/components/narrative/figure-card";
import { DemographicsFigure } from "@/components/explore/demographics-figure";
import { TrainingFigure } from "@/components/explore/training-figure";
import { HonorariumFigure } from "@/components/explore/honorarium-figure";

export const metadata = { title: "Explore" };

function captionFor(nTotal: number | null, geoName: string) {
  return `N = ${nTotal !== null ? nTotal.toLocaleString() : "—"} BHWs · ${geoName} · 2025 snapshot`;
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

  const [ancestors, regions, counts, demographicsByDimension, training, honorarium] =
    await Promise.all([
      getGeoAncestors(geo.geoCode, geo.geoLevel),
      getChildGeos(NATIONAL_GEO_CODE, "national"),
      getBhwCounts(geo.geoCode, geo.geoLevel),
      Promise.all(
        breakdowns.map(async (dimension) => ({
          dimension,
          rows: await getDemographics(geo.geoCode, geo.geoLevel, [dimension]),
        })),
      ),
      getTrainingCoverage(geo.geoCode, geo.geoLevel),
      getHonorarium(geo.geoCode, geo.geoLevel),
    ]);

  const [provinces, citymuns, barangays] = await Promise.all([
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

  const caption = captionFor(counts?.nTotal ?? null, geo.geoName);

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

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <FigureCard
            title="Accreditation"
            caption={caption}
            headline={
              counts?.pctAccredited !== null && counts?.pctAccredited !== undefined
                ? `About ${Math.round(counts.pctAccredited)}% of BHWs here are accredited.`
                : "No accreditation data available."
            }
            technicalDetails={
              <p>
                {counts?.nAccredited?.toLocaleString() ?? "—"} of {counts?.nTotal?.toLocaleString() ?? "—"}{" "}
                BHWs are accredited ({counts?.pctAccredited ?? "—"}%).
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

          {demographicsByDimension.map(({ dimension, rows }) => (
            <DemographicsFigure key={dimension} dimension={dimension} rows={rows} caption={caption} />
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
    </div>
  );
}
