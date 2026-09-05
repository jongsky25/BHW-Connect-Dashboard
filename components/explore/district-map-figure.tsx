"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useFilterState } from "@/lib/filters/use-filter-state";
import { FigureCard } from "@/components/narrative/figure-card";
import { FigureView } from "@/components/charts/figure-view";
import { MapLegend } from "@/components/maps/map-legend";
import { useExploreNav } from "@/components/explore/explore-nav";
import { computeQuantileBins } from "@/lib/charts/color-scale";
import { MIN_LEADER_N } from "@/lib/analysis/thresholds";
import {
  DISTRICT_MAP_INDICATOR_OPTIONS,
  MAP_BASE_INDICATOR_META,
  formatIndicatorValue,
} from "@/lib/analysis/map-indicators";
import { logEvent } from "@/lib/usage/log-client";
import type { DistrictMapIndicator } from "@/lib/filters/schema";

const ChoroplethMap = dynamic(
  () => import("@/components/maps/choropleth-map").then((m) => m.ChoroplethMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-80 w-full animate-pulse rounded-md border border-border bg-surface" />
    ),
  },
);

export type DistrictMapDatum = {
  districtCode: string;
  districtName: string;
  pctAccredited: number | null;
  avgActiveYears: number | null;
  anyHonorariumPct: number | null;
  nTotal: number | null;
};

function valueFor(d: DistrictMapDatum, indicator: DistrictMapIndicator): number | null {
  switch (indicator) {
    case "pct_accredited":
      return d.pctAccredited;
    case "avg_active_years":
      return d.avgActiveYears;
    case "any_honorarium_pct":
      return d.anyHonorariumPct;
  }
}

/**
 * D3.3 — "/explore: district as ... a map layer." A national-level choropleth over
 * `public/geo/districts.json` (D3.2's dissolved boundaries — 189 of 250 districts get a polygon;
 * the rest render hatched with this same ranked-list fallback, same convention as every other
 * boundary gap in the app), colored by one of the 3 figures `agg_bhw_by_district` (D3.1) actually
 * carries. Selecting a district opens its own `/districts/[code]` receipt page rather than
 * drilling into another /explore view — a district isn't a geo_level to drill into (plan §1), and
 * its own page is already the fuller profile (D3.3's other change).
 */
export function DistrictMapFigure({
  items,
  caption,
  activeIndicator,
}: {
  items: DistrictMapDatum[];
  caption: string;
  activeIndicator: DistrictMapIndicator;
}) {
  const { startTransition } = useExploreNav();
  const [, setFilters] = useFilterState({ startTransition });

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

  const meta = MAP_BASE_INDICATOR_META[activeIndicator];
  const suffix = meta.suffix;

  const resolved = useMemo(
    () =>
      items.map((d) => ({
        geoCode: d.districtCode,
        geoName: d.districtName,
        value: valueFor(d, activeIndicator),
        nTotal: d.nTotal,
      })),
    [items, activeIndicator],
  );

  const byCode = useMemo(() => new Map(resolved.map((c) => [c.geoCode, c])), [resolved]);
  const withData = useMemo(() => resolved.filter((c) => c.value !== null), [resolved]);
  const bins = useMemo(() => computeQuantileBins(withData.map((c) => c.value)), [withData]);
  const hasSmallN = useMemo(
    () => resolved.some((c) => c.value !== null && c.nTotal !== null && c.nTotal < MIN_LEADER_N),
    [resolved],
  );
  const hasNoData = useMemo(() => resolved.some((c) => c.value === null), [resolved]);

  const chartData = useMemo(
    () =>
      withData
        .map((c) => ({
          label: c.geoName,
          value: c.value as number,
          count: c.nTotal ?? undefined,
          geoCode: c.geoCode,
        }))
        .sort((a, b) => b.value - a.value),
    [withData],
  );

  const select = useCallback((code: string | null) => {
    setSelectedCode(code);
    if (code) logEvent("map_select", { meta: { childLevel: "district", districtCode: code } });
  }, []);

  const drill = useCallback((code: string) => {
    logEvent("map_drill", { meta: { childLevel: "district", districtCode: code } });
    setSelectedCode(null);
    window.location.assign(`/districts/${code}`);
  }, []);

  const changeIndicator = useCallback(
    (next: DistrictMapIndicator) => {
      setSelectedCode(null);
      logEvent("map_indicator_change", { meta: { indicator: next, childLevel: "district" } });
      setFilters({ districtMapIndicator: next });
    },
    [setFilters],
  );

  const selected = selectedCode ? byCode.get(selectedCode) : undefined;
  const selectedSmallN =
    selected != null &&
    selected.nTotal != null &&
    selected.nTotal < MIN_LEADER_N &&
    selected.value !== null;

  const scaleDisclosure =
    bins.length > 0
      ? `Color bins are ${bins.length === 5 ? "quintiles" : `${bins.length} ranges`} across the ${withData.length} district${withData.length === 1 ? "" : "s"} shown.`
      : null;

  const captionLine = [caption, meta.denominator, scaleDisclosure].filter(Boolean).join(" · ");
  const title = `${meta.label} by legislative district`;

  return (
    <FigureCard
      title={title}
      caption={captionLine}
      headline={
        chartData.length > 0
          ? `${chartData[0].label} has the highest ${meta.headlinePhrase}, at ${formatIndicatorValue(chartData[0].value, suffix)}.`
          : "No comparison data available."
      }
      technicalDetails={
        <p>
          Figures here are rolled up from the leaf grain (barangay), never from a member
          city/municipality&apos;s own row — see{" "}
          <Link href="/districts" className="underline hover:text-accent">
            /districts
          </Link>{" "}
          for the full mapping and its known gaps. Districts spanning a multi-district city with no
          barangay boundary in the source render hatched/grey; the ranked list below still covers
          every district.
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex w-fit flex-col gap-1 text-xs font-medium text-muted">
          Indicator
          <select
            value={activeIndicator}
            onChange={(e) => changeIndicator(e.target.value as DistrictMapIndicator)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {DISTRICT_MAP_INDICATOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="relative">
          <ChoroplethMap
            geojsonUrl="/geo/districts.json"
            childLevel="district"
            data={resolved}
            bins={bins}
            valueSuffix={suffix}
            minLeaderN={MIN_LEADER_N}
            selectedGeoCode={selectedCode}
            hoveredGeoCode={hoveredCode}
            onHoverGeo={setHoveredCode}
            onSelectGeo={select}
            onDrill={drill}
          />

          {selected && (
            <div className="absolute inset-x-2 bottom-2 z-10 rounded-md border border-border bg-background/95 p-3 shadow-lg backdrop-blur-sm sm:inset-x-auto sm:right-2 sm:max-w-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{selected.geoName}</p>
                  <p className="text-xs text-muted">
                    {selected.value !== null
                      ? `${formatIndicatorValue(selected.value, suffix)} · ${meta.label}`
                      : "No data"}
                    {selected.nTotal !== null ? ` · ${selected.nTotal.toLocaleString()} BHWs` : ""}
                  </p>
                  {selectedSmallN && (
                    <p className="mt-1 text-xs text-warning">
                      Only {selected.nTotal?.toLocaleString()} BHWs — rate is unstable.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => select(null)}
                  aria-label="Dismiss"
                  className="shrink-0 rounded p-1 text-muted hover:bg-surface hover:text-accent"
                >
                  ✕
                </button>
              </div>
              <button
                type="button"
                onClick={() => drill(selected.geoCode)}
                className="mt-2 w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90"
              >
                Open {selected.geoName} →
              </button>
            </div>
          )}
        </div>

        {(bins.length > 0 || hasNoData) && (
          <MapLegend bins={bins} valueSuffix={suffix} hasNoData={hasNoData} hasSmallN={hasSmallN} />
        )}

        {chartData.length > 0 ? (
          <FigureView
            title={title}
            data={chartData}
            xLabel={meta.axisLabel}
            yLabel="Legislative district"
            valueSuffix={suffix}
            hoveredGeoCode={hoveredCode}
            onHoverGeoCode={setHoveredCode}
          />
        ) : (
          <p className="text-sm text-muted">No data available.</p>
        )}
      </div>
    </FigureCard>
  );
}
