"use client";

import { useState } from "react";
import { BarChartClient } from "@/components/charts/bar-chart-client";
import { FigureTable } from "@/components/charts/figure-table";
import { Modal } from "@/components/ui/modal";
import { ViewToggle, type ViewMode } from "@/components/ui/view-toggle";
import type { BarDatum } from "@/lib/charts/bar-chart";

/**
 * Chart/table toggle + "Enlarge" wrapper around a figure's data. Keeps the
 * inline view compact and moves the enlarged figure into a shared <Modal>,
 * both driven by the same view state so switching stays in sync.
 */
export function FigureView({
  data,
  title,
  xLabel,
  yLabel,
  valueSuffix,
  valueFormatter,
}: {
  data: BarDatum[];
  /** Modal title. */
  title: string;
  xLabel?: string;
  yLabel?: string;
  valueSuffix?: string;
  valueFormatter?: (n: number) => string;
}) {
  const [mode, setMode] = useState<ViewMode>("chart");
  const [enlarged, setEnlarged] = useState(false);

  const format = valueFormatter ?? ((n: number) => n.toLocaleString());
  const tableFormat = (n: number) => `${format(n)}${valueSuffix ?? ""}`;

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
        <BarChartClient data={data} xLabel={xLabel} yLabel={yLabel} valueSuffix={valueSuffix} valueFormat={format} />
      ) : (
        <FigureTable
          data={data}
          labelHeader={yLabel ?? "Category"}
          valueHeader={xLabel ?? "Value"}
          valueFormatter={tableFormat}
        />
      )}

      <Modal open={enlarged} onClose={() => setEnlarged(false)} title={title}>
        <div className="mb-3">
          <ViewToggle value={mode} onChange={setMode} />
        </div>
        {mode === "chart" ? (
          <BarChartClient data={data} xLabel={xLabel} yLabel={yLabel} valueSuffix={valueSuffix} valueFormat={format} />
        ) : (
          <FigureTable
            data={data}
            labelHeader={yLabel ?? "Category"}
            valueHeader={xLabel ?? "Value"}
            valueFormatter={tableFormat}
          />
        )}
      </Modal>
    </div>
  );
}
