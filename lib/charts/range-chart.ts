import * as Plot from "@observablehq/plot";
import { accent, muted } from "./palette";

export type RangeDatum = {
  label: string;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
};

/**
 * Horizontal box-and-whisker spec: a min-max whisker line, an IQR (p25-p75)
 * box, and a median tick — one row per category. Companion to
 * `horizontalBarSpec` for figures that need a distribution, not a single
 * value, per row (see components/explore/honorarium-distribution-figure.tsx).
 */
export function horizontalRangeSpec(
  data: RangeDatum[],
  options: {
    xLabel?: string;
    yLabel?: string;
    /** Formats the median value label drawn past the box. Defaults to a
     * thousands-separated number (`toLocaleString`). */
    valueFormat?: (n: number) => string;
    /** Plot width in px. Defaults to the inline-figure width; the enlarged
     * modal passes a larger value. */
    width?: number;
    /** Box fill color (hex). Defaults to the palette accent; overridden by
     * the chart's recolor swatch control. */
    fill?: string;
  } = {},
): Plot.PlotOptions {
  const format = options.valueFormat ?? ((n: number) => n.toLocaleString());
  const fill = options.fill ?? accent;
  const width = options.width ?? 640;
  // Same responsive gutter as horizontalBarSpec: on a narrow (mobile) width the
  // fixed 160px left margin would leave almost no room for the whisker plot.
  const compact = width < 520;
  const longestLabel = Math.max(0, ...data.map((d) => d.label.length));
  const marginLeft = Math.min(compact ? 128 : 200, Math.max(56, longestLabel * 7 + 14));
  return {
    marginLeft,
    marginRight: compact ? 44 : 56,
    width,
    height: Math.max(100, data.length * 40 + 20),
    x: { label: options.xLabel ?? null, grid: true, nice: true },
    y: { label: options.yLabel ?? null },
    marks: [
      // Whisker: full min-max span.
      Plot.ruleY(data, { y: "label", x1: "min", x2: "max", stroke: muted, strokeWidth: 1.5 }),
      // Box: interquartile range (p25-p75).
      Plot.barX(data, { y: "label", x1: "p25", x2: "p75", fill, fillOpacity: 0.85 }),
      // Median tick, drawn on top of the box.
      Plot.tickX(data, { y: "label", x: "median", stroke: "#ffffff", strokeWidth: 2 }),
      Plot.text(data, {
        y: "label",
        x: "max",
        text: (d: RangeDatum) => `median ${format(d.median)}`,
        dx: 6,
        textAnchor: "start",
      }),
      Plot.tip(
        data,
        Plot.pointerY({
          y: "label",
          x: "median",
          title: (d: RangeDatum) =>
            `${d.label}\nMin ${format(d.min)} · P25 ${format(d.p25)} · Median ${format(d.median)} · P75 ${format(d.p75)} · Max ${format(d.max)}`,
        }),
      ),
      Plot.ruleX([0]),
    ],
  };
}
