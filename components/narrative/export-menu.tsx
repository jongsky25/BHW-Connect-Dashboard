"use client";

import { logEvent } from "@/lib/usage/log-client";
import type { DemographicDimension, GeoLevel, Indicator } from "@/lib/filters/schema";

const FORMATS = [
  { format: "csv", label: "CSV" },
  { format: "xlsx", label: "XLSX" },
  { format: "png", label: "PNG" },
  { format: "pptx", label: "PPTX" },
] as const;

/**
 * The export affordance every FigureCard's contract calls for (§4.2) — plain
 * links to api/export/*, built from the same filter params the figure itself
 * was rendered with, so what downloads always matches what's on screen.
 */
export function ExportMenu({
  geoCode,
  geoLevel,
  indicator,
  dimension,
}: {
  geoCode: string;
  geoLevel: GeoLevel;
  indicator: Indicator;
  dimension?: DemographicDimension;
}) {
  const params = new URLSearchParams({ geoCode, geoLevel, indicator });
  if (dimension) params.set("dimension", dimension);

  return (
    <div className="flex shrink-0 items-center gap-1 text-xs text-muted">
      <span className="sr-only">Export this figure as</span>
      {FORMATS.map(({ format, label }, i) => (
        <span key={format}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <a
            href={`/api/export/${format}?${params.toString()}`}
            onClick={() =>
              logEvent("export", { geoCode, meta: { format, indicator, dimension, geoLevel } })
            }
            className="px-1 underline-offset-2 hover:text-accent hover:underline"
          >
            {label}
          </a>
        </span>
      ))}
    </div>
  );
}
