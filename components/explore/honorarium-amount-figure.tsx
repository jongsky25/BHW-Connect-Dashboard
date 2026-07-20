import { FigureCard } from "@/components/narrative/figure-card";
import { FigureView } from "@/components/charts/figure-view";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import type { HonorariumRow } from "@/lib/db/indicators";
import { formatPeso } from "@/lib/format";

const PAYER_LABEL: Record<string, string> = {
  region: "Region",
  province: "Province",
  citymun: "City/Municipality",
  barangay: "Barangay",
};

const PAYER_ORDER = ["region", "province", "citymun", "barangay"];

/**
 * Average monthly honorarium *amount* by paying level — the companion to
 * HonorariumFigure (which shows % receiving). Reads `avgMonthlyAmount`, which
 * `getHonorarium` already returns but no figure charted before.
 */
export function HonorariumAmountFigure({ rows, caption }: { rows: HonorariumRow[]; caption: string }) {
  const byLevel = new Map(rows.map((r) => [r.payerLevel, r]));
  const chartData = PAYER_ORDER.map((l) => byLevel.get(l))
    .filter((r): r is HonorariumRow => !!r && r.avgMonthlyAmount !== null)
    .map((r) => ({
      label: PAYER_LABEL[r.payerLevel] ?? r.payerLevel,
      value: Math.round(r.avgMonthlyAmount as number),
    }));

  const barangay = byLevel.get("barangay");

  return (
    <FigureCard
      title="Average honorarium amount, by paying level"
      caption={caption}
      headline={
        barangay?.avgMonthlyAmount != null
          ? `Barangays — where the most BHWs are paid — give ${formatPeso(barangay.avgMonthlyAmount)} per month on average.`
          : chartData.length > 0
            ? "Average monthly honorarium varies widely by paying level."
            : "No honorarium amount data available."
      }
      technicalDetails={
        <>
          <p>
            Average monthly <GlossaryTerm slug="honorarium">honorarium</GlossaryTerm> among BHWs who
            receive one from that level, normalized to a monthly figure. A BHW may receive from more
            than one level, so these averages are not additive across levels.
          </p>
          <p>
            An average can be pulled up by a few high payers; a fuller distribution — annual
            minimum/median/maximum and each BHW&apos;s cumulative total across all levels — is a
            planned follow-up.
          </p>
        </>
      }
    >
      {chartData.length > 0 ? (
        <FigureView
          title="Average honorarium amount, by paying level"
          caption={caption}
          data={chartData}
          xLabel="Average ₱ per month"
          yLabel="Paying level"
          valueFormat="peso"
        />
      ) : (
        <p className="text-sm text-muted">No data available.</p>
      )}
    </FigureCard>
  );
}
