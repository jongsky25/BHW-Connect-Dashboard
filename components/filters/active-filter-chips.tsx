"use client";

import { useFilterState } from "@/lib/filters/use-filter-state";
import { NATIONAL_GEO_CODE, type GeoLevel } from "@/lib/filters/schema";
import { useExploreNav } from "@/components/explore/explore-nav";

export type BreadcrumbStep = { label: string; geoLevel: GeoLevel; geoCode: string };

export function ActiveFilterChips({ steps }: { steps: BreadcrumbStep[] }) {
  const { startTransition } = useExploreNav();
  const [filters, setFilters] = useFilterState({ startTransition });
  const hasActiveFilters =
    filters.geoCode !== NATIONAL_GEO_CODE || (filters.breakdowns?.length ?? 0) > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => (
        <button
          key={step.geoCode}
          type="button"
          onClick={() => setFilters({ geoLevel: step.geoLevel, geoCode: step.geoCode })}
          className={`rounded-full border border-border px-3 py-1 text-xs hover:bg-surface ${
            index === steps.length - 1 ? "bg-accent-subtle font-medium text-accent" : ""
          }`}
        >
          {step.label}
        </button>
      ))}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={() =>
            setFilters({ geoLevel: "national", geoCode: NATIONAL_GEO_CODE, breakdowns: null })
          }
          className="rounded-full px-3 py-1 text-xs text-muted underline hover:text-accent"
        >
          Reset
        </button>
      )}
    </div>
  );
}
