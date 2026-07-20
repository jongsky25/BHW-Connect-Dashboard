import { FigureCard } from "@/components/narrative/figure-card";
import { RangeChartClient } from "@/components/charts/range-chart-client";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import type { HonorariumRow } from "@/lib/db/indicators";
import type { RangeDatum } from "@/lib/charts/range-chart";
import { formatPesoFloor100 } from "@/lib/format";

const PAYER_LABEL: Record<string, string> = {
  region: "Region",
  province: "Province",
  citymun: "City/Municipality",
  barangay: "Barangay",
};

const PAYER_ORDER = ["region", "province", "citymun", "barangay"];

/**
 * Distribution of honorarium amounts by paying level — min/p25/median/p75/max,
 * shown as a box-and-whisker chart plus a companion stats table. Companion to
 * HonorariumAmountFigure (which shows only the average, which a few high
 * payers can pull up). See docs/HONORARIUM_ANALYSIS_SCOPE.md item A.
 */
export function HonorariumDistributionFigure({
  rows,
  caption,
}: {
  rows: HonorariumRow[];
  caption: string;
}) {
  const byLevel = new Map(rows.map((r) => [r.payerLevel, r]));
  const orderedRows = PAYER_ORDER.map((l) => byLevel.get(l)).filter((r): r is HonorariumRow => !!r);

  const chartData: RangeDatum[] = orderedRows
    .filter(
      (r) =>
        !r.isSuppressed &&
        r.minAmount !== null &&
        r.p25Amount !== null &&
        r.medianAmount !== null &&
        r.p75Amount !== null &&
        r.maxAmount !== null,
    )
    .map((r) => ({
      label: PAYER_LABEL[r.payerLevel] ?? r.payerLevel,
      min: r.minAmount as number,
      p25: r.p25Amount as number,
      median: r.medianAmount as number,
      p75: r.p75Amount as number,
      max: r.maxAmount as number,
    }));

  const anySuppressed = orderedRows.some((r) => r.isSuppressed);
  const barangay = byLevel.get("barangay");

  return (
    <FigureCard
      title="Honorarium distribution, by paying level"
      caption={caption}
      headline={
        barangay && !barangay.isSuppressed && barangay.medianAmount != null
          ? `Barangay honorarium ranges from ${formatPesoFloor100(barangay.minAmount)} to ${formatPesoFloor100(barangay.maxAmount)} a month, with a median of ${formatPesoFloor100(barangay.medianAmount)}.`
          : chartData.length > 0
            ? "Honorarium amounts vary widely within each paying level, not just between them."
            : "No honorarium distribution data available."
      }
      technicalDetails={
        <>
          <p>
            Each row spans the minimum-to-maximum monthly{" "}
            <GlossaryTerm slug="honorarium">honorarium</GlossaryTerm> among BHWs who receive one
            from that level; the shaded box covers the 25th-75th percentile (the middle half of
            recipients), and the tick marks the median. Unlike a single average, this shows how much
            amounts actually vary — a few high payers can pull an average up without most recipients
            seeing anywhere near that amount.
          </p>
          <p>
            Amounts under ₱100/month are shown as &quot;&lt;₱100&quot; rather than an exact figure —
            these are genuine reported values, not suppressed, just too small a token amount to
            usefully compare down to the peso.
          </p>
          {anySuppressed && (
            <p>
              Distribution values are hidden (shown as an em dash in the table) for any paying level
              with fewer than 5 recipients at this geography, to prevent re-identification. The
              percent receiving and average amount stay visible, since those are far less disclosive
              at small n.
            </p>
          )}
        </>
      }
    >
      {chartData.length > 0 ? (
        <RangeChartClient
          data={chartData}
          xLabel="Monthly ₱"
          yLabel="Paying level"
          valueFormat="pesoFloor100"
        />
      ) : (
        <p className="text-sm text-muted">No data available.</p>
      )}

      {orderedRows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface">
              <tr>
                <th className="px-4 py-3 font-medium">Paying level</th>
                <th className="px-4 py-3 font-medium">Min</th>
                <th className="px-4 py-3 font-medium">P25</th>
                <th className="px-4 py-3 font-medium">Median</th>
                <th className="px-4 py-3 font-medium">P75</th>
                <th className="px-4 py-3 font-medium">Max</th>
                <th className="px-4 py-3 font-medium">Avg</th>
              </tr>
            </thead>
            <tbody>
              {orderedRows.map((r) => (
                <tr
                  key={r.payerLevel}
                  className="border-b border-border last:border-0 hover:bg-surface"
                >
                  <td className="px-4 py-3">{PAYER_LABEL[r.payerLevel] ?? r.payerLevel}</td>
                  <td className="px-4 py-3">{formatPesoFloor100(r.minAmount)}</td>
                  <td className="px-4 py-3">{formatPesoFloor100(r.p25Amount)}</td>
                  <td className="px-4 py-3">{formatPesoFloor100(r.medianAmount)}</td>
                  <td className="px-4 py-3">{formatPesoFloor100(r.p75Amount)}</td>
                  <td className="px-4 py-3">{formatPesoFloor100(r.maxAmount)}</td>
                  <td className="px-4 py-3">{formatPesoFloor100(r.avgMonthlyAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FigureCard>
  );
}
