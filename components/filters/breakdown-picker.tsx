"use client";

import { useFilterState } from "@/lib/filters/use-filter-state";
import {
  DEFAULT_BREAKDOWNS,
  DEMOGRAPHIC_DIMENSIONS,
  type DemographicDimension,
} from "@/lib/filters/schema";

const LABELS: Record<DemographicDimension, string> = {
  sex: "Sex",
  age_band: "Age",
  civil_status: "Civil status",
  bloodtype: "Blood type",
  education: "Education",
  ip_status: "Indigenous people (IP) status",
};

export function BreakdownPicker() {
  const [filters, setFilters] = useFilterState();
  const active = filters.breakdowns ?? DEFAULT_BREAKDOWNS;

  function toggle(dimension: DemographicDimension) {
    const next = active.includes(dimension)
      ? active.filter((d) => d !== dimension)
      : [...active, dimension];
    setFilters({ breakdowns: next.length > 0 ? next : null });
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium text-muted">Add demographic figures</legend>
      <p className="-mt-1 mb-1 text-xs text-muted">
        Show extra breakdowns of the profiled BHWs here.
      </p>
      {DEMOGRAPHIC_DIMENSIONS.map((dimension) => (
        <label key={dimension} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active.includes(dimension)}
            onChange={() => toggle(dimension)}
            className="h-4 w-4 rounded border-border accent-accent"
          />
          {LABELS[dimension]}
        </label>
      ))}
    </fieldset>
  );
}
