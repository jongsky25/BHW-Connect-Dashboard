import { loadFilterState } from "@/lib/filters/codec";
import { DEFAULT_BREAKDOWNS, NATIONAL_GEO_CODE, type GeoLevel } from "@/lib/filters/schema";
import { getChildGeos, getGeoAncestors, getGeoByCode, type GeoOption } from "@/lib/db/geo";
import {
  getBhwCounts,
  getCertification,
  getChildSummaries,
  getDemographics,
  getHonorarium,
  getTrainingCoverage,
} from "@/lib/db/indicators";
import { getBhwOverview, coverageForDisplay } from "@/lib/db/stepzero";
import type { CompareMetricValues } from "@/lib/analysis/compare-metrics";
import { AddGeoSearch } from "@/components/compare/add-geo-search";
import { IndicatorPicker } from "@/components/compare/indicator-picker";
import { CompareColumn, type CompareColumnData } from "@/components/compare/compare-column";
import { CompareSummary, type CompareSummaryPlace } from "@/components/compare/compare-summary";
import { SelectedGeoChips } from "@/components/compare/selected-geo-chips";
import { QuickAddChips, type QuickAddSuggestion } from "@/components/compare/quick-add-chips";
import { PresentationProvider } from "@/components/present/presentation-context";
import { PresentationSlide } from "@/components/present/presentation-slide";
import { PresentButton } from "@/components/present/present-button";

export const metadata = { title: "Compare" };

const GEO_LEVEL_LABEL: Record<string, string> = {
  national: "Country",
  region: "Region",
  province: "Province",
  citymun: "City/Municipality",
  barangay: "Barangay",
};

/** How many same-level peers to suggest when exactly one place is selected. */
const MAX_PEER_SUGGESTIONS = 8;

/**
 * The largest same-level peers of a selected geo (by validated profiles), for
 * the one-place quick-add row. Same-level by construction — suggestions come
 * from the parent's child list — so adding one can never trip the mixed-level
 * guard. Regions peer against each other under the national roll-up; the
 * national row itself has no peers.
 */
async function getPeerSuggestions(geo: GeoOption): Promise<QuickAddSuggestion[]> {
  let parent: { geoCode: string; geoLevel: GeoLevel } | null = null;
  if (geo.geoLevel === "region") {
    parent = { geoCode: NATIONAL_GEO_CODE, geoLevel: "national" };
  } else if (geo.geoLevel !== "national") {
    const ancestors = await getGeoAncestors(geo.geoCode, geo.geoLevel);
    const parentOption =
      geo.geoLevel === "province"
        ? ancestors.region
        : geo.geoLevel === "citymun"
          ? ancestors.province
          : ancestors.citymun;
    if (parentOption) parent = { geoCode: parentOption.geoCode, geoLevel: parentOption.geoLevel };
  }
  if (!parent) return [];

  const siblings = await getChildSummaries(parent.geoCode, parent.geoLevel);
  return siblings
    .filter((s) => s.geoCode !== geo.geoCode)
    .sort((a, b) => (b.nTotal ?? -1) - (a.nTotal ?? -1))
    .slice(0, MAX_PEER_SUGGESTIONS)
    .map((s) => ({ geoCode: s.geoCode, geoName: s.geoName }));
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const filters = loadFilterState(rawParams);
  const requestedCodes = [...new Set(filters.compareGeos ?? [])].slice(0, 4);

  const resolved = await Promise.all(requestedCodes.map((code) => getGeoByCode(code)));
  const valid = resolved.filter((geo): geo is GeoOption => geo !== null);
  const notFoundCount = requestedCodes.length - valid.length;

  const levels = [...new Set(valid.map((g) => g.geoLevel))];
  const isMismatched = levels.length > 1;
  const canCompare = valid.length >= 2 && !isMismatched;

  // Quick-add suggestions bootstrap the empty and one-place states: regions
  // (the natural entry comparison) when nothing is selected; the selected
  // place's largest same-level peers when one is.
  let suggestions: QuickAddSuggestion[] = [];
  let suggestionsLabel = "";
  if (valid.length === 0) {
    const regions = await getChildGeos(NATIONAL_GEO_CODE, "national");
    suggestions = regions.map((r) => ({ geoCode: r.geoCode, geoName: r.geoName }));
    suggestionsLabel = "New here? Start by comparing regions:";
  } else if (valid.length === 1 && !isMismatched) {
    suggestions = await getPeerSuggestions(valid[0]);
    suggestionsLabel = `Compare ${valid[0].geoName} with a peer ${GEO_LEVEL_LABEL[valid[0].geoLevel].toLowerCase()} (most profiled BHWs first):`;
  }

  let columns: CompareColumnData[] = [];
  let summaryPlaces: CompareSummaryPlace[] = [];
  let reference: { label: string; values: CompareMetricValues } | null = null;
  if (canCompare) {
    const [loaded, nationalOverview, nationalCounts] = await Promise.all([
      Promise.all(
        valid.map(async (geo) => {
          const [overview, counts, demographics, training, certification, honorarium] =
            await Promise.all([
              getBhwOverview(geo.geoCode, geo.geoLevel),
              getBhwCounts(geo.geoCode, geo.geoLevel),
              Promise.all(
                DEFAULT_BREAKDOWNS.map(async (dimension) => ({
                  dimension,
                  rows: await getDemographics(geo.geoCode, geo.geoLevel, [dimension]),
                })),
              ),
              getTrainingCoverage(geo.geoCode, geo.geoLevel),
              getCertification(geo.geoCode, geo.geoLevel),
              getHonorarium(geo.geoCode, geo.geoLevel),
            ]);
          return { geo, overview, counts, demographics, training, certification, honorarium };
        }),
      ),
      // National reference row for the head-to-head strip — the same "versus
      // what?" context every other page shows. Skipped when the compared level
      // IS national (nothing above it).
      levels[0] !== "national"
        ? getBhwOverview(NATIONAL_GEO_CODE, "national")
        : Promise.resolve(null),
      levels[0] !== "national" ? getBhwCounts(NATIONAL_GEO_CODE, "national") : Promise.resolve(null),
    ]);

    columns = loaded.map(({ geo, overview, counts, demographics, training, certification, honorarium }) => ({
      geoCode: geo.geoCode,
      geoName: geo.geoName,
      geoLevel: geo.geoLevel,
      counts,
      totalBhw: overview.totalBhw,
      validatedProfiles: overview.validatedProfiles,
      coveragePct: coverageForDisplay(overview),
      householdsPerBhw: overview.householdsPerBhw,
      demographics,
      training,
      certification,
      honorarium,
    }));

    // The summary strip reads the same overview/counts objects as the columns,
    // so the two can never disagree on a value.
    const metricValues = (
      overview: (typeof loaded)[number]["overview"],
      counts: (typeof loaded)[number]["counts"],
    ): CompareMetricValues => ({
      pct_accredited: counts?.pctAccredited ?? null,
      any_honorarium_pct: counts?.anyHonorariumPct ?? null,
      avg_active_years: counts?.avgActiveYears ?? null,
      households_per_bhw: overview.householdsPerBhw,
      coverage_pct: coverageForDisplay(overview),
      bhw_per_1000: overview.bhwPer1000,
    });

    summaryPlaces = loaded.map(({ geo, overview, counts }) => ({
      geoCode: geo.geoCode,
      geoName: geo.geoName,
      nTotal: overview.validatedProfiles,
      values: metricValues(overview, counts),
    }));

    if (nationalOverview) {
      reference = {
        label: "Philippines",
        values: metricValues(nationalOverview, nationalCounts),
      };
    }
  }

  const summaryCaption = canCompare
    ? `Validated profiles: ${summaryPlaces
        .map((p) => `${p.geoName} ${p.nTotal?.toLocaleString() ?? "—"}`)
        .join(" · ")} · 2025 snapshot`
    : "";

  // Title-slide facts for presentation mode (serializable, server → client).
  const deckMeta = {
    pageLabel: "Compare places",
    areaName: canCompare ? valid.map((g) => g.geoName).join(" vs ") : "Compare places",
    filterChips: canCompare ? valid.map((g) => GEO_LEVEL_LABEL[g.geoLevel]) : [],
    captionLine: "Side-by-side comparison · 2025 snapshot",
  };

  return (
    <PresentationProvider meta={deckMeta}>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Compare places</h1>

        <div className="flex flex-wrap items-end gap-4">
          <AddGeoSearch disabled={valid.length >= 4} />
          {canCompare && <IndicatorPicker />}
          {canCompare && <PresentButton variant="secondary" />}
        </div>

        <SelectedGeoChips
          places={valid.map((geo) => ({
            geoCode: geo.geoCode,
            geoName: geo.geoName,
            levelLabel: GEO_LEVEL_LABEL[geo.geoLevel],
          }))}
        />

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
              You&apos;ve selected a mix of levels (
              {levels.map((l) => GEO_LEVEL_LABEL[l]).join(", ")}
              ). Use the × on the chips above to remove places until only one level remains — e.g.
              compare two provinces, or two regions, but not a province against a region.
            </p>
          </div>
        )}

        {!isMismatched && valid.length < 2 && (
          <div className="flex flex-col gap-6 py-8">
            <div className="flex flex-col items-center gap-2 text-center text-muted">
              <p>Add at least two places of the same level to compare them side by side.</p>
              {valid.length === 1 && (
                <p className="text-sm">
                  {valid[0].geoName} is added — search above or pick a suggestion below to add one
                  more (up to 4 total).
                </p>
              )}
            </div>
            {suggestions.length > 0 && (
              <QuickAddChips label={suggestionsLabel} suggestions={suggestions} />
            )}
          </div>
        )}

        {canCompare && (
          <PresentationSlide id="head-to-head" title="Head to head">
            <CompareSummary places={summaryPlaces} reference={reference} caption={summaryCaption} />
          </PresentationSlide>
        )}

        {canCompare && (
          // The columns row presents as one slide — side by side is the honest
          // unit of comparison.
          <PresentationSlide id="comparison" title={valid.map((g) => g.geoName).join(" vs ")}>
            <div className="flex flex-col gap-6 sm:flex-row sm:gap-4 sm:overflow-x-auto sm:pb-4">
              {columns.map((col) => (
                <CompareColumn key={col.geoCode} data={col} indicator={filters.indicator} />
              ))}
            </div>
          </PresentationSlide>
        )}
      </div>
    </PresentationProvider>
  );
}
