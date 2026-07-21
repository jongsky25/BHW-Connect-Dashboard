import type { ColorBin } from "@/lib/charts/color-scale";
import { NO_DATA_COLOR } from "@/lib/charts/color-scale";

function formatEdge(v: number, suffix: string): string {
  const rounded = Number.isInteger(v) ? v : Math.round(v * 10) / 10;
  return `${rounded.toLocaleString()}${suffix}`;
}

/**
 * Real-DOM legend for the choropleth map (E0.1). The map canvas is
 * `aria-hidden`, so this legend — rendered as ordinary DOM under it — is what
 * makes the color encoding accessible. One swatch per quantile bin with its
 * value range, plus the no-data swatch and (when relevant) the small-N marker.
 */
export function MapLegend({
  bins,
  valueSuffix = "",
  hasNoData,
  hasSmallN,
}: {
  bins: ColorBin[];
  valueSuffix?: string;
  hasNoData: boolean;
  hasSmallN: boolean;
}) {
  if (bins.length === 0 && !hasNoData) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {bins.map((bin, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
              style={{ backgroundColor: bin.color }}
            />
            <span>
              {formatEdge(bin.min, valueSuffix)}
              {bin.max > bin.min ? `–${formatEdge(bin.max, valueSuffix)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {hasSmallN && (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 shrink-0 rounded-sm border border-dashed border-muted opacity-50"
            style={{ backgroundColor: bins[0]?.color ?? NO_DATA_COLOR }}
          />
          <span>Few BHWs profiled — unstable</span>
        </span>
      )}
      {hasNoData && (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
            style={{ backgroundColor: NO_DATA_COLOR }}
          />
          <span>No boundary/data — see list</span>
        </span>
      )}
    </div>
  );
}
