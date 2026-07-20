"use client";

import { useEffect, useRef } from "react";
import { horizontalRangeSpec, type RangeDatum } from "@/lib/charts/range-chart";
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
  const format = formatterFor(valueFormat);

  useEffect(() => {
    let plot: (SVGSVGElement | HTMLElement) & { remove: () => void };
    let cancelled = false;

    import("@observablehq/plot").then((Plot) => {
      if (cancelled || !containerRef.current) return;
      plot = Plot.plot(
        horizontalRangeSpec(data, { xLabel, yLabel, valueFormat: format, width, fill }),
      );
      // Same rationale as BarChartClient: the wrapping div already carries
      // role="img" + a full text aria-label, so hide the SVG from the a11y tree.
      plot.setAttribute("aria-hidden", "true");
      containerRef.current.replaceChildren(plot);
    });

    return () => {
      cancelled = true;
      plot?.remove();
    };
  }, [data, xLabel, yLabel, format, width, fill]);

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
      className="overflow-x-auto"
    />
  );
}
