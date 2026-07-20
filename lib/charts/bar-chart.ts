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
  const barHeight = options.barHeight ?? 32;
  return {
    marginLeft: 160,
    // Reserve room for the value label drawn past the end of the longest
    // bar — without it, a wide value (e.g. "201,653") can clip against the
    // plot's right edge on a narrow/responsive width.
    marginRight: 56,
    width: options.width ?? 640,
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
