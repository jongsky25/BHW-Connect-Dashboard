"use client";

import { useQueryStates } from "nuqs";
import { filterParsers } from "@/lib/filters/codec";
import { INDICATORS, type Indicator } from "@/lib/filters/schema";

// Labels for every value in INDICATORS — a missing entry would render a blank
// option, so the record is typed to force completeness.
const LABELS: Record<Indicator, string> = {
  accreditation: "Accreditation",
  service_years: "Average years of service",
  demographics: "Demographics",
  training: "Training coverage",
  certification: "Training & certification",
  honorarium: "Honorarium: who receives",
  honorarium_amount: "Honorarium: how much",
  honorarium_distribution: "Honorarium: distribution",
};

export function IndicatorPicker() {
  const [filters, setFilters] = useQueryStates(filterParsers, { shallow: false, history: "push" });

  return (
    <div>
      <label htmlFor="compare-indicator" className="block text-xs font-medium text-muted">
        Focus on
      </label>
      <select
        id="compare-indicator"
        value={filters.indicator ?? ""}
        onChange={(e) => setFilters({ indicator: e.target.value ? (e.target.value as never) : null })}
        className="mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        <option value="">All figures</option>
        {INDICATORS.map((i) => (
          <option key={i} value={i}>
            {LABELS[i]}
          </option>
        ))}
      </select>
    </div>
  );
}
