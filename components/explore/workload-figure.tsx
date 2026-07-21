import { FigureCard } from "@/components/narrative/figure-card";
import { RangeChartClient } from "@/components/charts/range-chart-client";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import type { WorkloadRow } from "@/lib/db/derived-figures";
import type { RangeDatum } from "@/lib/charts/range-chart";
import type { GeoLevel } from "@/lib/filters/schema";

const fmtHh = (n: number | null): string => (n === null ? "—" : Math.round(n).toLocaleString());

/**
 * Workload distribution (E3.4): how many households each BHW is assigned, shown
 * as a p10–p90 spread with the median marked, plus the share of all assigned
 * households covered by the busiest 10% of BHWs. Built at
 * national/region/province/citymun; a barangay falls back to its citymun ancestor
 * (labeled). Distribution suppressed for geos with fewer than 5 reporting BHWs.
 */
export function WorkloadFigure({
  row,
  caption,
  geoLevel,
  fallbackCitymunName,
}: {
  row: WorkloadRow | null;
  caption: string;
  geoLevel: GeoLevel;
  fallbackCitymunName?: string | null;
}) {
  const scopeSuffix = fallbackCitymunName ? ` (shown for ${fallbackCitymunName})` : "";
  const title = `Household workload${scopeSuffix}`;

  if (!row || row.isSuppressed || row.median === null) {
    return (
      <FigureCard
        title={title}
        caption={caption}
        headline={
          geoLevel === "barangay" && !row
            ? "Workload figures aren't available at the barangay level."
            : row?.isSuppressed
              ? "Too few BHWs report a household count here to show a distribution."
              : "No household-workload data for this area."
        }
        technicalDetails={
          <p>
            The workload distribution is built down to the city/municipality level and hidden where
            fewer than 5 BHWs report an assigned-household count. Barangay pages show their
            city/municipality&apos;s figure instead.
          </p>
        }
      >
        <p className="text-sm text-muted">No data available.</p>
      </FigureCard>
    );
  }

  // p10..p90 mapped onto the range chart's min..max slots (labeled honestly in
  // technical details as the 10th–90th percentile, not literal extremes).
  const chartData: RangeDatum[] = [
    {
      label: "Households per BHW",
      min: row.p10 as number,
      p25: row.p25 as number,
      median: row.median as number,
      p75: row.p75 as number,
      max: row.p90 as number,
    },
  ];

  const headline =
    row.busiestDecileShare !== null
      ? `The busiest 10% of BHWs here cover ${Math.round(row.busiestDecileShare)}% of all assigned households; the typical BHW covers ${fmtHh(row.median)}.`
      : `The typical BHW here covers ${fmtHh(row.median)} households.`;

  return (
    <FigureCard
      title={title}
      caption={caption}
      headline={headline}
      technicalDetails={
        <>
          <p>
            The bar spans the 10th to 90th percentile of assigned households per BHW; the shaded box
            is the 25th–75th percentile (the middle half), and the tick marks the median. Based on{" "}
            {row.nBhw.toLocaleString()} BHWs reporting a household count (mean {fmtHh(row.mean)}).
          </p>
          <p>
            &ldquo;Busiest 10%&rdquo; is the share of all assigned households that fall to the
            highest-caseload tenth of BHWs — a concentration measure: 10% is perfectly even, higher
            means load piles onto fewer workers. Households are self-reported; a{" "}
            <GlossaryTerm slug="households_per_bhw">households-per-BHW</GlossaryTerm> average for the
            whole area is shown separately in the summary strip.
          </p>
        </>
      }
    >
      <RangeChartClient data={chartData} xLabel="Assigned households" yLabel="" valueFormat="count" />

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted">Lowest tenth (p10)</dt>
          <dd className="font-medium">{fmtHh(row.p10)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Median</dt>
          <dd className="font-medium">{fmtHh(row.median)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Busiest tenth (p90)</dt>
          <dd className="font-medium">{fmtHh(row.p90)}</dd>
        </div>
      </dl>
    </FigureCard>
  );
}
