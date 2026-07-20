import * as Plot from "@observablehq/plot";
import { accent } from "./palette";

export type BarDatum = { label: string; value: number };

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
  } = {},
): Plot.PlotOptions {
  const suffix = options.valueSuffix ?? "";
  const format = options.valueFormat ?? ((n: number) => n.toLocaleString());
  return {
    marginLeft: 160,
    width: 640,
    height: Math.max(80, data.length * 32 + 20),
    x: { label: options.xLabel ?? null, grid: true, nice: true },
    y: { label: options.yLabel ?? null },
    marks: [
      Plot.barX(data, { y: "label", x: "value", fill: accent, sort: { y: "-x" } }),
      Plot.text(data, {
        y: "label",
        x: "value",
        text: (d: BarDatum) => `${format(d.value)}${suffix}`,
        dx: 6,
        textAnchor: "start",
        sort: { y: "-x" },
      }),
      Plot.ruleX([0]),
    ],
  };
}
