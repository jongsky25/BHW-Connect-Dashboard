"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryStates } from "nuqs";
import { filterParsers } from "@/lib/filters/codec";
import { FigureCard } from "@/components/narrative/figure-card";
import { FigureView } from "@/components/charts/figure-view";
import { MapLegend } from "@/components/maps/map-legend";
import { useExploreNav } from "@/components/explore/explore-nav";
import { computeQuantileBins } from "@/lib/charts/color-scale";
import { MIN_LEADER_N } from "@/lib/analysis/thresholds";
import {
  MAP_BASE_INDICATOR_OPTIONS,
  TRAINING_OPTION,
  formatIndicatorValue,
  type MapIndicatorMeta,
} from "@/lib/analysis/map-indicators";
import { logEvent } from "@/lib/usage/log-client";
import {
  mapIndicatorTopicSlug,
  trainingMapIndicator,
  type GeoLevel,
  type MapIndicator,
} from "@/lib/filters/schema";

const ChoroplethMap = dynamic(
  () => import("@/components/maps/choropleth-map").then((m) => m.ChoroplethMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-80 w-full animate-pulse rounded-md border border-border bg-surface" />
    ),
  },
);

/** One child geo with its value already resolved for the active indicator. */
export type ChildIndicator = {
  geoCode: string;
  geoName: string;
  value: number | null;
  nTotal: number | null;
};

export type TrainingTopicOption = { slug: string; label: string };

export function GeoComparisonFigure({
  geojsonUrl,
  childLevel,
  childLevelLabel,
  items,
  caption,
  activeIndicator,
  meta,
  trainingTopics,
}: {
  geojsonUrl: string | null;
  childLevel: GeoLevel;
  childLevelLabel: string;
  items: ChildIndicator[];
  caption: string;
  /** Indicator the server resolved `items`' values for — keeps values, headline
   * and caption consistent even while a switcher change is mid-flight. */
  activeIndicator: MapIndicator;
  meta: MapIndicatorMeta;
  trainingTopics: TrainingTopicOption[];
}) {
  const { startTransition } = useExploreNav();
  const [, setFilters] = useQueryStates(filterParsers, {
    shallow: false,
    history: "push",
    startTransition,
  });

  const [selectedGeoCode, setSelectedGeoCode] = useState<string | null>(null);
  const [hoveredGeoCode, setHoveredGeoCode] = useState<string | null>(null);
  // Sample the hover-tooltip event once per pageview (E0.6) — the raw stream
  // would be far too chatty to be useful.
  const hoverLoggedRef = useRef(false);

  const childLabel = childLevelLabel.toLowerCase();
  const suffix = meta.suffix;
  const byCode = useMemo(() => new Map(items.map((c) => [c.geoCode, c])), [items]);

  const withData = useMemo(() => items.filter((c) => c.value !== null), [items]);
  const bins = useMemo(() => computeQuantileBins(withData.map((c) => c.value)), [withData]);

  const hasSmallN = useMemo(
    () => items.some((c) => c.value !== null && c.nTotal !== null && c.nTotal < MIN_LEADER_N),
    [items],
  );
  const hasNoData = useMemo(() => items.some((c) => c.value === null), [items]);

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

  const drill = useCallback(
    (code: string) => {
      logEvent("map_drill", { geoCode: code, meta: { childLevel } });
      setSelectedGeoCode(null);
      setFilters({ geoLevel: childLevel, geoCode: code });
    },
    [childLevel, setFilters],
  );

  const select = useCallback(
    (code: string | null) => {
      setSelectedGeoCode(code);
      if (code) logEvent("map_select", { geoCode: code, meta: { childLevel } });
    },
    [childLevel],
  );

  const handleHover = useCallback((code: string | null) => {
    setHoveredGeoCode(code);
    if (code && !hoverLoggedRef.current) {
      hoverLoggedRef.current = true;
      logEvent("map_hover_tooltip", { geoCode: code });
    }
  }, []);

  const changeIndicator = useCallback(
    (next: MapIndicator) => {
      setSelectedGeoCode(null);
      logEvent("map_indicator_change", { meta: { indicator: next, childLevel } });
      setFilters({ mapIndicator: next });
    },
    [childLevel, setFilters],
  );

  // The switcher reflects the server-resolved `activeIndicator` (the value the
  // map/list are actually showing), so a picked indicator, its values, and the
  // control stay consistent — they update together when the RSC round-trip lands
  // (the top progress bar signals the in-between). This also keeps a stale
  // `training:` permalink that fell back to accreditation from showing a topic
  // the map isn't rendering.
  const controlTopicSlug = mapIndicatorTopicSlug(activeIndicator);
  const controlIsTraining = controlTopicSlug !== null;
  const baseSelectValue: string = controlIsTraining ? TRAINING_OPTION : activeIndicator;
  const hasTopics = trainingTopics.length > 0;

  const onBaseChange = useCallback(
    (value: string) => {
      if (value === TRAINING_OPTION) {
        if (!hasTopics) return;
        // Keep the current topic if one is already selected, else the first.
        const slug = controlTopicSlug ?? trainingTopics[0].slug;
        changeIndicator(trainingMapIndicator(slug));
      } else {
        changeIndicator(value as MapIndicator);
      }
    },
    [changeIndicator, controlTopicSlug, hasTopics, trainingTopics],
  );

  // Transient selection/hover reset on navigation via a remount `key` in the
  // page (fresh mount = fresh state) rather than a state-syncing effect.

  // Esc dismisses the selection mini-card (the mouse/touch path is a background
  // click, handled inside the map).
  useEffect(() => {
    if (!selectedGeoCode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedGeoCode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedGeoCode]);

  const selected = selectedGeoCode ? byCode.get(selectedGeoCode) : undefined;
  const selectedSmallN =
    selected != null &&
    selected.nTotal != null &&
    selected.nTotal < MIN_LEADER_N &&
    selected.value !== null;

  const scaleDisclosure =
    bins.length > 0
      ? `Color bins are ${bins.length === 5 ? "quintiles" : `${bins.length} ranges`} across the ${withData.length} ${childLabel}${withData.length === 1 ? "" : "s"} shown.`
      : null;

  const captionLine = [caption, meta.denominator, scaleDisclosure].filter(Boolean).join(" · ");

  const title = `${meta.label} by ${childLabel}`;

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
          Pick an indicator to recolor the map and re-sort the list. Hover a shaded area for its
          value, click to select it, then click again (or use &ldquo;Open&rdquo;) to drill in.
          Desaturated, dashed areas have fewer than {MIN_LEADER_N} profiled BHWs, so their rate is
          unstable. Areas with no shaded boundary aren&apos;t missing data — see the ranked list
          below the map, and{" "}
          <a href="/data-quality" className="underline hover:text-accent">
            data quality
          </a>{" "}
          for known boundary-source gaps.
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Indicator
            <select
              value={baseSelectValue}
              onChange={(e) => onBaseChange(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            >
              {MAP_BASE_INDICATOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
              <option value={TRAINING_OPTION} disabled={!hasTopics}>
                Training coverage{hasTopics ? "" : " (unavailable)"}
              </option>
            </select>
          </label>

          {controlIsTraining && hasTopics && (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Topic
              <select
                value={controlTopicSlug ?? trainingTopics[0].slug}
                onChange={(e) => changeIndicator(trainingMapIndicator(e.target.value))}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                {trainingTopics.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {geojsonUrl && (
          <div className="relative">
            <ChoroplethMap
              geojsonUrl={geojsonUrl}
              childLevel={childLevel}
              data={items.map((c) => ({
                geoCode: c.geoCode,
                geoName: c.geoName,
                value: c.value,
                nTotal: c.nTotal,
              }))}
              bins={bins}
              valueSuffix={suffix}
              minLeaderN={MIN_LEADER_N}
              selectedGeoCode={selectedGeoCode}
              hoveredGeoCode={hoveredGeoCode}
              onHoverGeo={handleHover}
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
                      {selected.nTotal !== null
                        ? ` · ${selected.nTotal.toLocaleString()} profiled`
                        : ""}
                    </p>
                    {selectedSmallN && (
                      <p className="mt-1 text-xs text-warning">
                        Only {selected.nTotal?.toLocaleString()} BHWs profiled — rate is unstable.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedGeoCode(null)}
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
        )}

        {geojsonUrl && (bins.length > 0 || hasNoData) && (
          <MapLegend
            bins={bins}
            valueSuffix={suffix}
            hasNoData={hasNoData}
            hasSmallN={hasSmallN}
          />
        )}

        {chartData.length > 0 ? (
          <FigureView
            title={title}
            data={chartData}
            xLabel={meta.axisLabel}
            yLabel={childLevelLabel}
            valueSuffix={suffix}
            hoveredGeoCode={hoveredGeoCode}
            onHoverGeoCode={setHoveredGeoCode}
          />
        ) : (
          <p className="text-sm text-muted">No data available.</p>
        )}
      </div>
    </FigureCard>
  );
}
