import * as Plot from "@observablehq/plot";
import { accent } from "./palette";

export type BarDatum = { label: string; value: number; count?: number };

/**
 * Horizontal bar chart spec, shared between the client-rendered explore
 * figures and (increment 1.8) server-side PNG export — same spec-building
 * code, same visual, so an exported chart matches what a user saw on screen.
 */
export function horizontalBarSpec(
  data: BarDatum[],
  options: {
    xLabel?: string;
    yLabel?: string;
    valueSuffix?: string;
    /** Formats the bar's value label. Defaults to a thousands-separated number
     * (`toLocaleString`) so labels never render as raw digits (e.g. `5,000`, not `5000`). */
    valueFormat?: (n: number) => string;
    /** Plot width in px. Defaults to the inline-figure width; the enlarged
     * modal (near-full-page, see components/ui/modal.tsx) passes a larger value. */
    width?: number;
    /** Px height per bar row. Defaults to the inline-figure spacing; the
     * enlarged modal passes a taller value so bars use the extra room. */
    barHeight?: number;
    /** Bar fill color (hex). Defaults to the palette accent; overridden by the
     * chart's recolor swatch control. */
    fill?: string;
  } = {},
): Plot.PlotOptions {
  const suffix = options.valueSuffix ?? "";
  const format = options.valueFormat ?? ((n: number) => n.toLocaleString());
  const fill = options.fill ?? accent;
  const width = options.width ?? 640;
  // On narrow (mobile) widths the fixed desktop margins would eat most of the
  // plot, leaving the bars themselves squished into a sliver. Scale the label
  // gutter and per-row height down so the chart stays readable — this matters
  // most in the enlarged modal, which fills a ~96vw phone screen.
  const compact = width < 520;
  const longestLabel = Math.max(0, ...data.map((d) => d.label.length));
  // Plot draws the (rotated) y-axis title in a fixed vertical strip at the far
  // left, but sizes no margin for it — so reserve a ~22px gutter whenever a
  // yLabel is set. Without it, short tick labels (e.g. "Paid"/"Unpaid") extend
  // left to the frame edge and overlap the title.
  const titleGutter = options.yLabel != null ? 22 : 0;
  // Reserve just enough of the left gutter for the longest y-axis label, but
  // cap it so a narrow plot still leaves usable room for the bars. Add the
  // title gutter on top so the tick labels always clear the axis title.
  const marginLeft = titleGutter + Math.min(compact ? 128 : 200, Math.max(56, longestLabel * 7 + 14));
  const barHeight = Math.min(options.barHeight ?? 32, compact ? 40 : 200);
  return {
    marginLeft,
    // Reserve room for the value label drawn past the end of the longest
    // bar — without it, a wide value (e.g. "201,653") can clip against the
    // plot's right edge on a narrow/responsive width.
    marginRight: compact ? 44 : 56,
    width,
    height: Math.max(80, data.length * barHeight + 20),
    x: { label: options.xLabel ?? null, grid: true, nice: true },
    y: { label: options.yLabel ?? null },
    marks: [
      // Base bars render slightly dimmed; the pointerY overlay below brings
      // the hovered row back to full opacity so it visually pops.
      Plot.barX(data, { y: "label", x: "value", fill, fillOpacity: 0.85, sort: { y: "-x" } }),
      Plot.barX(data, Plot.pointerY({ y: "label", x: "value", fill, fillOpacity: 1 })),
      Plot.text(data, {
        y: "label",
        x: "value",
        text: (d: BarDatum) => `${format(d.value)}${suffix}`,
        dx: 6,
        textAnchor: "start",
        sort: { y: "-x" },
      }),
      Plot.tip(
        data,
        Plot.pointerY({
          y: "label",
          x: "value",
          title: (d: BarDatum) => `${d.label}: ${format(d.value)}${suffix}`,
        }),
      ),
      Plot.ruleX([0]),
    ],
  };
}
