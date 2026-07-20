"use client";

import { useState } from "react";
import { FigureCard } from "@/components/narrative/figure-card";
import { FigureView } from "@/components/charts/figure-view";
import { ExportMenu } from "@/components/narrative/export-menu";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import { PeriodToggle, PERIOD_MONTHS, PERIOD_NOUN, type AmountPeriod } from "@/components/ui/period-toggle";
import type { HonorariumRow } from "@/lib/db/indicators";
import type { GeoLevel } from "@/lib/filters/schema";
import { formatPeso } from "@/lib/format";

const PAYER_LABEL: Record<string, string> = {
  region: "Region",
  province: "Province",
  citymun: "City/Municipality",
  barangay: "Barangay",
};

const PAYER_ORDER = ["region", "province", "citymun", "barangay"];

/**
 * Average honorarium *amount* by paying level — the companion to
 * HonorariumFigure (which shows % receiving). Reads `avgMonthlyAmount`, which
 * `getHonorarium` already returns but no figure charted before. The period
 * toggle scales the monthly average to a quarterly (×3) or annual (×12) figure.
 */
export function HonorariumAmountFigure({
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
  const [period, setPeriod] = useState<AmountPeriod>("monthly");
  const multiplier = PERIOD_MONTHS[period];
  const noun = PERIOD_NOUN[period];

  const byLevel = new Map(rows.map((r) => [r.payerLevel, r]));
  const chartData = PAYER_ORDER.map((l) => byLevel.get(l))
    .filter((r): r is HonorariumRow => !!r && r.avgMonthlyAmount !== null)
    .map((r) => ({
      label: PAYER_LABEL[r.payerLevel] ?? r.payerLevel,
      value: Math.round((r.avgMonthlyAmount as number) * multiplier),
    }));

  const barangay = byLevel.get("barangay");

  return (
    <FigureCard
      title="Average honorarium amount, by paying level"
      caption={caption}
      exportMenu={
        geoCode && geoLevel ? (
          <ExportMenu geoCode={geoCode} geoLevel={geoLevel} indicator="honorarium_amount" />
        ) : undefined
      }
      headline={
        barangay?.avgMonthlyAmount != null
          ? `Barangays — where the most BHWs are paid — give ${formatPeso(barangay.avgMonthlyAmount * multiplier)} per ${noun} on average.`
          : chartData.length > 0
            ? `Average ${period} honorarium varies widely by paying level.`
            : "No honorarium amount data available."
      }
      technicalDetails={
        <>
          <p>
            Average <GlossaryTerm slug="honorarium">honorarium</GlossaryTerm> among BHWs who
            receive one from that level. The underlying figure is a monthly average; quarterly and
            annual views scale it by 3 and 12. A BHW may receive from more than one level, so these
            averages are not additive across levels.
          </p>
          <p>
            An average can be pulled up by a few high payers — see the distribution figure below
            for the minimum, median, and maximum by paying level. Each BHW&apos;s cumulative
            honorarium total across every level they receive from is a separate, planned follow-up.
          </p>
        </>
      }
    >
      <div className="mb-3 flex items-center justify-end">
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>
      {chartData.length > 0 ? (
        <FigureView
          title="Average honorarium amount, by paying level"
          caption={caption}
          data={chartData}
          xLabel={`Average ₱ per ${noun}`}
          yLabel="Paying level"
          valueFormat="peso"
        />
      ) : (
        <p className="text-sm text-muted">No data available.</p>
      )}
    </FigureCard>
  );
}
