import { FigureCard } from "@/components/narrative/figure-card";
import { FigureView } from "@/components/charts/figure-view";
import { ExportMenu } from "@/components/narrative/export-menu";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import type { HonorariumRow } from "@/lib/db/indicators";
import type { GeoLevel } from "@/lib/filters/schema";

const PAYER_LABEL: Record<string, string> = {
  region: "Region",
  province: "Province",
  citymun: "City/Municipality",
  barangay: "Barangay",
};

export function HonorariumFigure({
  rows,
  caption,
  geoCode,
  geoLevel,
}: {
  rows: HonorariumRow[];
  caption: string;
  geoCode?: string;
  geoLevel?: GeoLevel;
}) {
  const chartData = rows
    .filter((r) => r.pctReceiving !== null)
    .map((r) => ({
      label: PAYER_LABEL[r.payerLevel] ?? r.payerLevel,
      value: r.pctReceiving as number,
      count: r.nReceiving ?? undefined,
    }));

  const topPayer = [...chartData].sort((a, b) => b.value - a.value)[0];
  const topPayerRow = [...rows]
    .filter((r) => r.pctReceiving !== null)
    .sort((a, b) => (b.pctReceiving as number) - (a.pctReceiving as number))[0];
  const topPayerCi =
    topPayerRow && topPayerRow.ciLow !== null && topPayerRow.ciHigh !== null
      ? `${topPayerRow.ciLow}–${topPayerRow.ciHigh}%`
      : null;

  return (
    <FigureCard
      title="Honorarium, by paying level"
      caption={caption}
      exportMenu={
        geoCode && geoLevel ? (
          <ExportMenu geoCode={geoCode} geoLevel={geoLevel} indicator="honorarium" />
        ) : undefined
      }
      headline={
        topPayer
          ? `Most honorarium here is paid at the ${topPayer.label.toLowerCase()} level (${topPayer.value}% of BHWs).`
          : "No honorarium data available."
      }
      technicalDetails={
        <p>
          A BHW may receive <GlossaryTerm slug="honorarium">honorarium</GlossaryTerm> from more than
          one administrative level; percentages are independent per level, not mutually exclusive.
          {topPayerCi && topPayer ? (
            <>
              {" "}
              The top level&apos;s {topPayer.value}% has a 95%{" "}
              <GlossaryTerm slug="confidence_interval">confidence interval</GlossaryTerm> of{" "}
              {topPayerCi}.
            </>
          ) : null}
        </p>
      }
    >
      {chartData.length > 0 ? (
        <FigureView
          title="Honorarium, by paying level"
          caption={caption}
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
