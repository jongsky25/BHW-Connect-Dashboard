"use client";

import { logEvent } from "@/lib/usage/log-client";
import type { DistrictExportIndicator } from "@/lib/exports/figure-data";

const FORMATS = [
  { format: "csv", label: "CSV" },
  { format: "xlsx", label: "XLSX" },
  { format: "png", label: "PNG" },
  { format: "pptx", label: "PPTX" },
] as const;

/**
 * D3.3 — the district analog of `ExportMenu`: same four formats through the same `/api/export/*`
 * routes, keyed by `districtCode` instead of `geoCode`/`geoLevel` (a district isn't a `dim_geo`
 * row, plan §1) and limited to the 3 indicators `agg_bhw_by_district` carries.
 */
export function DistrictExportMenu({
  districtCode,
  indicator,
}: {
  districtCode: string;
  indicator: DistrictExportIndicator;
}) {
  const params = new URLSearchParams({ districtCode, indicator });

  return (
    <div className="flex shrink-0 items-center gap-1 text-xs text-muted">
      <span className="sr-only">Export this figure as</span>
      {FORMATS.map(({ format, label }, i) => (
        <span key={format}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <a
            href={`/api/export/${format}?${params.toString()}`}
            onClick={() => logEvent("export", { meta: { format, indicator, districtCode } })}
            className="px-1 underline-offset-2 hover:text-accent hover:underline"
          >
            {label}
          </a>
        </span>
      ))}
    </div>
  );
}
