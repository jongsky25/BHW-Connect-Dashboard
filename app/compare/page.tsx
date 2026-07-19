import { loadFilterState } from "@/lib/filters/codec";
import { DEFAULT_BREAKDOWNS } from "@/lib/filters/schema";
import { getGeoByCode } from "@/lib/db/geo";
import { getBhwCounts, getDemographics, getHonorarium, getTrainingCoverage } from "@/lib/db/indicators";
import { getBhwOverview, coverageForDisplay } from "@/lib/db/stepzero";
import { AddGeoSearch } from "@/components/compare/add-geo-search";
import { IndicatorPicker } from "@/components/compare/indicator-picker";
import { CompareColumn, type CompareColumnData } from "@/components/compare/compare-column";

export const metadata = { title: "Compare" };

const GEO_LEVEL_LABEL: Record<string, string> = {
  national: "Country",
  region: "Region",
  province: "Province",
  citymun: "City/Municipality",
  barangay: "Barangay",
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const filters = loadFilterState(rawParams);
  const requestedCodes = [...new Set(filters.compareGeos ?? [])].slice(0, 4);

  const resolved = await Promise.all(requestedCodes.map((code) => getGeoByCode(code)));
  const valid = resolved
    .map((geo, i) => (geo ? { geo, code: requestedCodes[i] } : null))
    .filter((v): v is { geo: NonNullable<(typeof resolved)[number]>; code: string } => v !== null)
    .map((v) => v.geo);
  const notFoundCount = requestedCodes.length - valid.length;

  const levels = [...new Set(valid.map((g) => g.geoLevel))];
  const isMismatched = levels.length > 1;
  const canCompare = valid.length >= 2 && !isMismatched;

  let columns: CompareColumnData[] = [];
  if (canCompare) {
    columns = await Promise.all(
      valid.map(async (geo) => {
        const [overview, counts, demographics, training, honorarium] = await Promise.all([
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
        ]);
        return {
          geoCode: geo.geoCode,
          geoName: geo.geoName,
          geoLevel: geo.geoLevel,
          counts,
          totalBhw: overview.totalBhw,
          validatedProfiles: overview.validatedProfiles,
          coveragePct: coverageForDisplay(overview),
          demographics,
          training,
          honorarium,
        };
      }),
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Compare places</h1>

      <div className="flex flex-wrap items-end gap-4">
        <AddGeoSearch disabled={valid.length >= 4} />
        {canCompare && <IndicatorPicker />}
      </div>

      {notFoundCount > 0 && (
        <p className="rounded-md bg-surface px-4 py-2 text-sm text-muted">
          {notFoundCount} of the requested place{notFoundCount === 1 ? "" : "s"} in this link
          couldn&apos;t be found and {notFoundCount === 1 ? "was" : "were"} skipped.
        </p>
      )}

      {isMismatched && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-4">
          <p className="font-medium">Compare places at the same level</p>
          <p className="mt-1 text-sm text-muted">
            You&apos;ve selected a mix of levels ({levels.map((l) => GEO_LEVEL_LABEL[l]).join(", ")}
            ). Remove places until only one level remains — e.g. compare two provinces, or two
            regions, but not a province against a region.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {valid.map((geo) => (
              <li key={geo.geoCode} className="rounded-full border border-border bg-background px-3 py-1 text-xs">
                {geo.geoName} ({GEO_LEVEL_LABEL[geo.geoLevel]})
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isMismatched && valid.length < 2 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
          <p>Add at least two places of the same level to compare them side by side.</p>
          {valid.length === 1 && (
            <p className="text-sm">
              {valid[0].geoName} is added — search above to add one more (up to 4 total).
            </p>
          )}
        </div>
      )}

      {canCompare && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => (
            <CompareColumn
              key={col.geoCode}
              data={col}
              indicator={filters.indicator}
              canRemove={columns.length > 2}
            />
          ))}
        </div>
      )}
    </div>
  );
}
