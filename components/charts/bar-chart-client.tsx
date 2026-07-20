"use client";

import { useEffect, useRef, useState } from "react";
import { horizontalBarSpec, type BarDatum } from "@/lib/charts/bar-chart";

export function BarChartClient({
  data,
  xLabel,
  yLabel,
  valueSuffix,
  valueFormat,
  width,
  barHeight,
  fill,
}: {
  data: BarDatum[];
  xLabel?: string;
  yLabel?: string;
  valueSuffix?: string;
  valueFormat?: (n: number) => string;
  /** Fixed plot width in px. Omit to fill the container's width instead —
   * used by the enlarged modal so the chart uses all available space rather
   * than a hardcoded value that leaves the rest of the modal empty. */
  width?: number;
  /** Px height per bar row, passed through to horizontalBarSpec. */
  barHeight?: number;
  /** Bar fill color (hex), set by the chart's recolor swatch control. */
  fill?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>();

  // Track the container's width so the chart can fill it exactly (no fixed
  // width left over as dead space) when the caller doesn't force one.
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
        horizontalBarSpec(data, { xLabel, yLabel, valueSuffix, valueFormat, width: plotWidth, barHeight, fill }),
      );
      // The wrapping div already carries role="img" + a full text aria-label
      // (below); Plot's internal <g aria-label="..."> marks on plain <g>
      // elements otherwise trip aria-prohibited-attr, so hide the SVG itself
      // from the accessibility tree rather than exposing it redundantly.
      plot.setAttribute("aria-hidden", "true");
      containerRef.current.replaceChildren(plot);
    });

    return () => {
      cancelled = true;
      plot?.remove();
    };
  }, [data, xLabel, yLabel, valueSuffix, valueFormat, plotWidth, barHeight, fill]);

  const format = valueFormat ?? ((n: number) => n.toLocaleString());

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`${xLabel ?? "Chart"}: ${data.map((d) => `${d.label} ${format(d.value)}${valueSuffix ?? ""}`).join(", ")}`}
      className="w-full overflow-x-auto"
    />
  );
}
