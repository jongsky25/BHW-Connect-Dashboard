import { FigureCard } from "@/components/narrative/figure-card";
import { FigureView } from "@/components/charts/figure-view";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import type { HonorariumRow } from "@/lib/db/indicators";

const PAYER_LABEL: Record<string, string> = {
  region: "Region",
  province: "Province",
  citymun: "City/Municipality",
  barangay: "Barangay",
};

export function HonorariumFigure({ rows, caption }: { rows: HonorariumRow[]; caption: string }) {
  const chartData = rows
    .filter((r) => r.pctReceiving !== null)
    .map((r) => ({ label: PAYER_LABEL[r.payerLevel] ?? r.payerLevel, value: r.pctReceiving as number }));

  const topPayer = [...chartData].sort((a, b) => b.value - a.value)[0];

  return (
    <FigureCard
      title="Honorarium, by paying level"
      caption={caption}
      headline={
        topPayer
          ? `Most honorarium here is paid at the ${topPayer.label.toLowerCase()} level (${topPayer.value}% of BHWs).`
          : "No honorarium data available."
      }
      technicalDetails={
        <p>
          A BHW may receive <GlossaryTerm slug="honorarium">honorarium</GlossaryTerm> from more
          than one administrative level; percentages are independent per level, not mutually
          exclusive.
        </p>
      }
    >
      {chartData.length > 0 ? (
        <FigureView
          title="Honorarium, by paying level"
          data={chartData}
          xLabel="% of BHWs receiving"
          yLabel="Paying level"
          valueSuffix="%"
        />
      ) : (
        <p className="text-sm text-muted">No data available.</p>
      )}
    </FigureCard>
  );
}
