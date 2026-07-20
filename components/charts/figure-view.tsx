"use client";

import { useState } from "react";
import { BarChartClient } from "@/components/charts/bar-chart-client";
import { ColorSwatches } from "@/components/charts/color-swatches";
import { FigureTable } from "@/components/charts/figure-table";
import { Modal } from "@/components/ui/modal";
import { ViewToggle, type ViewMode } from "@/components/ui/view-toggle";
import type { BarDatum } from "@/lib/charts/bar-chart";
import { accent } from "@/lib/charts/palette";
import { formatterFor, type ValueFormatKind } from "@/lib/format";

/**
 * Chart/table toggle + "Enlarge" wrapper around a figure's data. Keeps the
 * inline view compact and moves the enlarged figure into a shared <Modal>,
 * both driven by the same view state so switching stays in sync.
 *
 * `valueFormat` is a named kind (not a function): the figures that render
 * this are Server Components, and functions can't cross the Server -> Client
 * Component boundary, so the formatter is resolved locally instead.
 */
export function FigureView({
  data,
  title,
  caption,
  xLabel,
  yLabel,
  valueSuffix,
  valueFormat,
}: {
  data: BarDatum[];
  /** Modal title. */
  title: string;
  /** WPSAR-style Person/Place/Time line shown in the enlarged modal —
   * matches the same caption already shown on the figure's FigureCard. */
  caption?: string;
  xLabel?: string;
  yLabel?: string;
  valueSuffix?: string;
  valueFormat?: ValueFormatKind;
}) {
  const [mode, setMode] = useState<ViewMode>("chart");
  const [enlarged, setEnlarged] = useState(false);
  const [color, setColor] = useState(accent);

  const format = formatterFor(valueFormat);
  const tableFormat = (n: number) => `${format(n)}${valueSuffix ?? ""}`;
  // "amount" (e.g. peso averages) can't be turned into a "% of total" — the
  // honorarium-amount figure's averages aren't additive across payer levels —
  // so that table keeps a single sortable value column instead of No./%.
  const valueKind: "count" | "percent" | "amount" =
    valueFormat === "peso" ? "amount" : valueFormat === "percent" || valueSuffix === "%" ? "percent" : "count";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <ViewToggle value={mode} onChange={setMode} />
        <button
          type="button"
          onClick={() => setEnlarged(true)}
          className="text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
        >
          Enlarge ⤢
        </button>
      </div>

      {mode === "chart" ? (
        <BarChartClient
          data={data}
          xLabel={xLabel}
          yLabel={yLabel}
          valueSuffix={valueSuffix}
          valueFormat={format}
          fill={color}
        />
      ) : (
        <FigureTable
          data={data}
          labelHeader={yLabel ?? "Category"}
          valueHeader={xLabel ?? "Value"}
          valueFormatter={tableFormat}
          valueKind={valueKind}
        />
      )}

      <Modal open={enlarged} onClose={() => setEnlarged(false)} title={title} caption={caption}>
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <ViewToggle value={mode} onChange={setMode} />
          {mode === "chart" && <ColorSwatches value={color} onChange={setColor} />}
        </div>
        {mode === "chart" ? (
          <div className="flex flex-1 items-center justify-center">
            <BarChartClient
              data={data}
              xLabel={xLabel}
              yLabel={yLabel}
              valueSuffix={valueSuffix}
              valueFormat={format}
              barHeight={56}
              fill={color}
            />
          </div>
        ) : (
          <FigureTable
            data={data}
            labelHeader={yLabel ?? "Category"}
            valueHeader={xLabel ?? "Value"}
            valueFormatter={tableFormat}
            valueKind={valueKind}
          />
        )}
      </Modal>
    </div>
  );
}
