"use client";

import { useEffect, useRef } from "react";
import { horizontalBarSpec, type BarDatum } from "@/lib/charts/bar-chart";

export function BarChartClient({
  data,
  xLabel,
  yLabel,
  valueSuffix,
}: {
  data: BarDatum[];
  xLabel?: string;
  yLabel?: string;
  valueSuffix?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let plot: (SVGSVGElement | HTMLElement) & { remove: () => void };
    let cancelled = false;

    import("@observablehq/plot").then((Plot) => {
      if (cancelled || !containerRef.current) return;
      plot = Plot.plot(horizontalBarSpec(data, { xLabel, yLabel, valueSuffix }));
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
  }, [data, xLabel, yLabel, valueSuffix]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`${xLabel ?? "Chart"}: ${data.map((d) => `${d.label} ${d.value}${valueSuffix ?? ""}`).join(", ")}`}
      className="overflow-x-auto"
    />
  );
}
