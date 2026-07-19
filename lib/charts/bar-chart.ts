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
  options: { xLabel?: string; valueSuffix?: string } = {},
): Plot.PlotOptions {
  const suffix = options.valueSuffix ?? "";
  return {
    marginLeft: 160,
    width: 640,
    height: Math.max(80, data.length * 32 + 20),
    x: { label: options.xLabel ?? null, grid: true, nice: true },
    y: { label: null },
    marks: [
      Plot.barX(data, { y: "label", x: "value", fill: accent, sort: { y: "-x" } }),
      Plot.text(data, {
        y: "label",
        x: "value",
        text: (d: BarDatum) => `${d.value}${suffix}`,
        dx: 6,
        textAnchor: "start",
        sort: { y: "-x" },
      }),
      Plot.ruleX([0]),
    ],
  };
}
