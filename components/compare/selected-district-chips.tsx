"use client";

import { useFilterState } from "@/lib/filters/use-filter-state";

export type SelectedDistrict = { districtCode: string; districtName: string };

/**
 * D3.3 — the district-compare analog of `SelectedGeoChips`: removable chips, always present so
 * there's a removal surface even before two districts are picked. Operates on `?districts=`,
 * never `?geos=` (guardrail 7 — a district isn't a `dim_geo` row).
 */
export function SelectedDistrictChips({ districts }: { districts: SelectedDistrict[] }) {
  const [filters, setFilters] = useFilterState();

  if (districts.length === 0) return null;

  function remove(districtCode: string) {
    const next = (filters.compareDistricts ?? []).filter((c) => c !== districtCode);
    setFilters({ compareDistricts: next.length > 0 ? next : null });
  }

  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Districts selected for comparison">
      {districts.map((d) => (
        <li
          key={d.districtCode}
          className="flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-3 pr-1 text-sm"
        >
          <span className="font-medium">{d.districtName}</span>
          <span className="text-xs text-muted">District</span>
          <button
            type="button"
            onClick={() => remove(d.districtCode)}
            aria-label={`Remove ${d.districtName} from the comparison`}
            className="flex h-8 w-8 items-center justify-center rounded-full text-base text-muted hover:bg-background hover:text-accent"
          >
            ×
          </button>
        </li>
      ))}
      {districts.length >= 2 && (
        <li>
          <button
            type="button"
            onClick={() => setFilters({ compareDistricts: null })}
            className="text-xs text-muted underline hover:text-accent"
          >
            Clear all
          </button>
        </li>
      )}
    </ul>
  );
}
