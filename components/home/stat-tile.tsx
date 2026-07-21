"use client";

import { type ReactNode, useState } from "react";
import { BarChartClient } from "@/components/charts/bar-chart-client";
import { ColorSwatches } from "@/components/charts/color-swatches";
import { FigureTable } from "@/components/charts/figure-table";
import { Modal } from "@/components/ui/modal";
import { ViewToggle, type ViewMode } from "@/components/ui/view-toggle";
import type { BarDatum } from "@/lib/charts/bar-chart";
import { usePaletteAccent } from "@/lib/charts/use-palette-accent";
import { formatterFor, type ValueFormatKind } from "@/lib/format";

export type StatTileDetail = {
  label: string;
  value: string;
};

export type StatEnlarge = {
  /** Modal title. */
  title: string;
  /** WPSAR-style Person/Place/Time line, e.g. "N = 270,917 validated
   * profiles · Philippines · 2025 snapshot" — matches the figure-card
   * convention used everywhere else in the app. */
  caption: string;
  chartData: BarDatum[];
  xLabel?: string;
  yLabel?: string;
  /** Named formatter kind, not a function — app/page.tsx is a Server
   * Component and functions can't cross the Server -> Client Component
   * boundary, so the formatter is resolved locally from this string. */
  valueFormat?: ValueFormatKind;
};

/** Shared chart/table modal body for a KPI card's enlarged breakdown — used by
 * both StatTile and StatHero so the two card types enlarge identically. */
export function StatEnlargeModal({
  enlarge,
  open,
  onClose,
}: {
  enlarge: StatEnlarge;
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ViewMode>("chart");
  // Default the bar color to the live palette accent so the chart tracks the
  // appearance setting; an explicit swatch pick overrides it.
  const paletteAccent = usePaletteAccent();
  const [override, setOverride] = useState<string | null>(null);
  const color = override ?? paletteAccent;
  const format = formatterFor(enlarge.valueFormat);
  const valueKind: "count" | "percent" | "amount" =
    enlarge.valueFormat === "peso" ? "amount" : enlarge.valueFormat === "percent" ? "percent" : "count";

  return (
    <Modal open={open} onClose={onClose} title={enlarge.title} caption={enlarge.caption}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <ViewToggle value={mode} onChange={setMode} />
        {mode === "chart" && <ColorSwatches value={color} onChange={setOverride} />}
      </div>
      {mode === "chart" ? (
        <div className="flex flex-1 items-center justify-center">
          <BarChartClient
            data={enlarge.chartData}
            xLabel={enlarge.xLabel}
            yLabel={enlarge.yLabel}
            valueFormat={format}
            barHeight={56}
            fill={color}
          />
        </div>
      ) : (
        <FigureTable
          data={enlarge.chartData}
          labelHeader={enlarge.yLabel ?? "Category"}
          valueHeader={enlarge.xLabel ?? "Value"}
          valueFormatter={format}
          valueKind={valueKind}
        />
      )}
    </Modal>
  );
}

export function StatTile({
  label,
  value,
  caption,
  context,
  details,
  visual,
  enlarge,
}: {
  label: string;
  value: string;
  caption: string;
  /** Optional adequacy/regional-spread/DOH-caveat line(s) rendered under the
   * caption (Increment 4's "no naked numbers" rollout for `/bhw`) — plain
   * `text-xs text-muted` lines, matching `FigureBenchmark`'s footnote styling. */
  context?: ReactNode;
  /** Optional breakdown shown as plain text below the visual (no expansion — always visible). */
  details?: StatTileDetail[];
  /** One small, non-interactive inline visual (donut / gauge / bars) rendered under the value. */
  visual?: ReactNode;
  /** When set, the card becomes clickable and opens a chart/table modal of the breakdown. */
  enlarge?: StatEnlarge;
}) {
  const [open, setOpen] = useState(false);

  const body = (
    <>
      <p className="mt-1 text-4xl font-semibold tracking-tight">{value}</p>
      {visual && <div className="mt-3">{visual}</div>}
      <p className="mt-2 text-xs text-muted">{caption}</p>
      {context}
      {details && details.length > 0 && (
        <dl className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
          {details.map((d) => (
            <div key={d.label} className="flex items-center justify-between gap-3">
              <dt className="text-muted">{d.label}</dt>
              <dd className="font-medium">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );

  if (!enlarge) {
    return (
      <div className="rounded-lg border border-border bg-background p-4 sm:p-5">
        <p className="text-base text-muted">{label}</p>
        {body}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-accent sm:p-5"
      >
        <span className="flex items-center justify-between text-base text-muted">
          {label}
          <span className="text-xs text-muted" aria-hidden="true">
            Enlarge ⤢
          </span>
        </span>
        {body}
      </button>
      <StatEnlargeModal enlarge={enlarge} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
