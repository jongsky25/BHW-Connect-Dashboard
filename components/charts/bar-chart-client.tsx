"use client";

import { useEffect, useRef } from "react";
import { horizontalBarSpec, type BarDatum } from "@/lib/charts/bar-chart";

export function BarChartClient({
  data,
  xLabel,
  yLabel,
  valueSuffix,
  valueFormat,
}: {
  data: BarDatum[];
  xLabel?: string;
  yLabel?: string;
  valueSuffix?: string;
  valueFormat?: (n: number) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let plot: (SVGSVGElement | HTMLElement) & { remove: () => void };
    let cancelled = false;

    import("@observablehq/plot").then((Plot) => {
      if (cancelled || !containerRef.current) return;
      plot = Plot.plot(horizontalBarSpec(data, { xLabel, yLabel, valueSuffix, valueFormat }));
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
  }, [data, xLabel, yLabel, valueSuffix, valueFormat]);

  const format = valueFormat ?? ((n: number) => n.toLocaleString());

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`${xLabel ?? "Chart"}: ${data.map((d) => `${d.label} ${format(d.value)}${valueSuffix ?? ""}`).join(", ")}`}
      className="overflow-x-auto"
    />
  );
}
