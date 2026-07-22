"use client";

import { useFilterState } from "@/lib/filters/use-filter-state";

export type QuickAddSuggestion = { geoCode: string; geoName: string };

/**
 * One-click "add to comparison" chips, so the empty and one-place states offer
 * a concrete next step instead of only a search box: regions to start from when
 * nothing is selected, and the selected place's largest same-level peers when
 * one is — same-level by construction, so a suggestion can never trip the
 * mixed-level guard.
 */
export function QuickAddChips({
  label,
  suggestions,
}: {
  label: string;
  suggestions: QuickAddSuggestion[];
}) {
  const [filters, setFilters] = useFilterState();
  const current = filters.compareGeos ?? [];
  const available = suggestions.filter((s) => !current.includes(s.geoCode));

  if (available.length === 0 || current.length >= 4) return null;

  function add(geoCode: string) {
    if (current.includes(geoCode) || current.length >= 4) return;
    setFilters({ compareGeos: [...current, geoCode] });
  }

  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      <ul className="mt-1.5 flex flex-wrap gap-2">
        {available.map((s) => (
          <li key={s.geoCode}>
            <button
              type="button"
              onClick={() => add(s.geoCode)}
              className="rounded-full border border-border bg-background px-3 py-1 text-sm hover:border-accent hover:text-accent"
            >
              + {s.geoName}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
