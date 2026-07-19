import Link from "next/link";
import { FigureCard } from "@/components/narrative/figure-card";
import { BarChartClient } from "@/components/charts/bar-chart-client";
import type { DemographicRow } from "@/lib/db/indicators";
import type { DemographicDimension } from "@/lib/filters/schema";

const DIMENSION_LABEL: Record<DemographicDimension, string> = {
  sex: "Sex",
  age_band: "Age",
  civil_status: "Civil status",
  bloodtype: "Blood type",
  education: "Educational attainment",
  ip_status: "Indigenous people (IP) status",
};

function formatCategory(dimension: DemographicDimension, category: string): string {
  if (dimension === "ip_status") return category === "YES" ? "Yes" : "No";
  return category;
}

export function DemographicsFigure({
  dimension,
  rows,
  caption,
}: {
  dimension: DemographicDimension;
  rows: DemographicRow[];
  caption: string;
}) {
  const isSuppressed = rows.some((r) => r.isSuppressed);
  const rollup = rows.find((r) => r.isSuppressed && r.rollupGeoCode);

  const chartData = rows
    .filter((r) => !r.isSuppressed && r.pct !== null)
    .map((r) => ({ label: formatCategory(dimension, r.category), value: r.pct as number }));

  const topCategory = [...chartData].sort((a, b) => b.value - a.value)[0];

  return (
    <FigureCard
      title={DIMENSION_LABEL[dimension]}
      caption={caption}
      headline={
        isSuppressed
          ? "This breakdown is suppressed to protect individual privacy."
          : topCategory
            ? `${topCategory.label} is the largest group, at ${topCategory.value}%.`
            : "No data available for this breakdown."
      }
      technicalDetails={
        <>
          <p>Percentages are of the geo&apos;s total BHW count for this dimension.</p>
          {isSuppressed && (
            <p>
              Individual-level breakdowns are suppressed when a geo has fewer than 5 BHWs, to
              prevent re-identification.{" "}
              {rollup?.rollupGeoName && rollup.rollupGeoLevel && (
                <>
                  See the roll-up at{" "}
                  <Link
                    href={`/place/${rollup.rollupGeoLevel}/${rollup.rollupGeoCode}`}
                    className="underline hover:text-accent"
                  >
                    {rollup.rollupGeoName}
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </>
      }
    >
      {isSuppressed ? (
        <p className="rounded-md bg-surface px-4 py-6 text-center text-sm text-muted">
          Suppressed to protect privacy (n&lt;5)
        </p>
      ) : chartData.length > 0 ? (
        <BarChartClient data={chartData} xLabel="% of BHWs" valueSuffix="%" />
      ) : (
        <p className="text-sm text-muted">No data available.</p>
      )}
    </FigureCard>
  );
}
