"use client";

import { useEffect, useRef, useState } from "react";
import { horizontalRangeSpec, type RangeDatum } from "@/lib/charts/range-chart";
import { styleAxisTitles } from "@/lib/charts/style-axis";
import { usePaletteAccent } from "@/lib/charts/use-palette-accent";
import { formatterFor, type ValueFormatKind } from "@/lib/format";

/**
 * `valueFormat` is a named kind (not a function), same rationale as
 * FigureView/BarChartClient: the figures that render this are Server
 * Components, and functions can't cross the Server -> Client Component
 * boundary, so the formatter is resolved locally instead.
 */
export function RangeChartClient({
  data,
  xLabel,
  yLabel,
  valueFormat,
  width,
  fill,
}: {
  data: RangeDatum[];
  xLabel?: string;
  yLabel?: string;
  valueFormat?: ValueFormatKind;
  /** Plot width in px — the enlarged modal passes a larger value. */
  width?: number;
  /** Box fill color (hex), set by the chart's recolor swatch control. */
  fill?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>();
  const format = formatterFor(valueFormat);
  // Callers that don't recolor the box fall back to the live palette accent (a
  // concrete hex Plot can use) so the chart tracks the appearance setting.
  const paletteAccent = usePaletteAccent();
  const resolvedFill = fill ?? paletteAccent;

  // Track the container's width so the chart fills it (and stays readable on a
  // narrow mobile screen) instead of overflowing at a fixed 640px, unless the
  // caller forces an explicit width (e.g. the enlarged modal).
  useEffect(() => {
    if (width != null) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setMeasuredWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  const plotWidth = width ?? measuredWidth;

  useEffect(() => {
    if (plotWidth == null) return;
    let plot: (SVGSVGElement | HTMLElement) & { remove: () => void };
    let cancelled = false;

    import("@observablehq/plot").then((Plot) => {
      if (cancelled || !containerRef.current) return;
      plot = Plot.plot(
        horizontalRangeSpec(data, { xLabel, yLabel, valueFormat: format, width: plotWidth, fill: resolvedFill }),
      );
      // Bold/enlarge the axis titles so they read clearly against the tick labels.
      styleAxisTitles(plot);
      // Same rationale as BarChartClient: the wrapping div already carries
      // role="img" + a full text aria-label, so hide the SVG from the a11y tree.
      plot.setAttribute("aria-hidden", "true");
      containerRef.current.replaceChildren(plot);
    });

    return () => {
      cancelled = true;
      plot?.remove();
    };
  }, [data, xLabel, yLabel, format, plotWidth, resolvedFill]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`${xLabel ?? "Chart"}: ${data
        .map(
          (d) =>
            `${d.label} — min ${format(d.min)}, p25 ${format(d.p25)}, median ${format(d.median)}, p75 ${format(d.p75)}, max ${format(d.max)}`,
        )
        .join("; ")}`}
      className="w-full overflow-x-auto"
    />
  );
}
