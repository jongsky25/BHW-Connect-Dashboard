"use client";

import dynamic from "next/dynamic";
import { FigureCard } from "@/components/narrative/figure-card";
import { BarChartClient } from "@/components/charts/bar-chart-client";
import type { GeoLevel } from "@/lib/filters/schema";

const ChoroplethMap = dynamic(
  () => import("@/components/maps/choropleth-map").then((m) => m.ChoroplethMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-80 w-full animate-pulse rounded-md border border-border bg-surface" />
    ),
  },
);

export type ChildIndicator = { geoCode: string; geoName: string; pctAccredited: number | null };

export function GeoComparisonFigure({
  geojsonUrl,
  childLevel,
  childLevelLabel,
  items,
  caption,
}: {
  geojsonUrl: string | null;
  childLevel: GeoLevel;
  childLevelLabel: string;
  items: ChildIndicator[];
  caption: string;
}) {
  const chartData = items
    .filter((c) => c.pctAccredited !== null)
    .map((c) => ({ label: c.geoName, value: c.pctAccredited as number }))
    .sort((a, b) => b.value - a.value);

  return (
    <FigureCard
      title={`Accreditation by ${childLevelLabel.toLowerCase()}`}
      caption={caption}
      headline={
        chartData.length > 0
          ? `${chartData[0].label} has the highest accreditation rate, at ${chartData[0].value}%.`
          : "No comparison data available."
      }
      technicalDetails={
        <p>
          Click a shaded area on the map, or a bar in the list, to drill into that{" "}
          {childLevelLabel.toLowerCase()}. Areas with no shaded boundary aren&apos;t missing data —
          see the ranked list below the map, and{" "}
          <a href="/data-quality" className="underline hover:text-accent">
            data quality
          </a>{" "}
          for known boundary-source gaps.
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        {geojsonUrl && (
          <ChoroplethMap
            geojsonUrl={geojsonUrl}
            childLevel={childLevel}
            values={items.map((c) => ({ geoCode: c.geoCode, value: c.pctAccredited }))}
          />
        )}
        {chartData.length > 0 ? (
          <BarChartClient
            data={chartData}
            xLabel="% accredited"
            yLabel={childLevelLabel}
            valueSuffix="%"
          />
        ) : (
          <p className="text-sm text-muted">No data available.</p>
        )}
      </div>
    </FigureCard>
  );
}
