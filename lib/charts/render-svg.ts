import "server-only";
import { horizontalBarSpec, type BarDatum } from "./bar-chart";
import { styleAxisTitles } from "./style-axis";

/**
 * Server-side counterpart to components/charts/bar-chart-client.tsx — same
 * chart-spec function (`horizontalBarSpec`), same visual, but rendered with
 * a lightweight virtual DOM (`linkedom`) instead of the browser, so exports
 * (PNG/PPTX) show the identical chart a user saw on screen. `@observablehq/plot`
 * only needs a `document` implementing enough of the DOM API to build an SVG.
 */
export async function renderBarChartSvg(
  data: BarDatum[],
  options: { xLabel?: string; yLabel?: string; valueSuffix?: string } = {},
): Promise<{ svg: string; width: number; height: number }> {
  const [{ parseHTML }, Plot] = await Promise.all([import("linkedom"), import("@observablehq/plot")]);
  const { document } = parseHTML("<!DOCTYPE html><html><body></body></html>");

  const spec = horizontalBarSpec(data, options);
  const node = Plot.plot({ ...spec, document });
  // Match the on-screen chart: bold/enlarge the axis titles.
  styleAxisTitles(node);

  return {
    svg: node.outerHTML,
    width: Number(spec.width ?? 640),
    height: Number(spec.height ?? 200),
  };
}
