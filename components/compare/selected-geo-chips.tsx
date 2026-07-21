"use client";

import { useQueryStates } from "nuqs";
import { filterParsers } from "@/lib/filters/codec";

export type SelectedGeo = {
  geoCode: string;
  geoName: string;
  /** Human level label ("Province", "Region", …). */
  levelLabel: string;
};

/**
 * The compared places as removable chips. This is the page's one always-present
 * removal surface: it works in every state — including the mixed-level state,
 * where the figure columns (and their per-column Remove buttons) don't render,
 * which previously left "remove places until only one level remains" with no
 * control to do it.
 */
export function SelectedGeoChips({ places }: { places: SelectedGeo[] }) {
  const [filters, setFilters] = useQueryStates(filterParsers, { shallow: false, history: "push" });

  if (places.length === 0) return null;

  function remove(geoCode: string) {
    const next = (filters.compareGeos ?? []).filter((c) => c !== geoCode);
    setFilters({ compareGeos: next.length > 0 ? next : null });
  }

  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Places selected for comparison">
      {places.map((place) => (
        <li
          key={place.geoCode}
          className="flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-3 pr-1 text-sm"
        >
          <span className="font-medium">{place.geoName}</span>
          <span className="text-xs text-muted">{place.levelLabel}</span>
          <button
            type="button"
            onClick={() => remove(place.geoCode)}
            aria-label={`Remove ${place.geoName} from the comparison`}
            className="rounded-full px-1.5 py-0.5 text-muted hover:bg-background hover:text-accent"
          >
            ×
          </button>
        </li>
      ))}
      {places.length >= 2 && (
        <li>
          <button
            type="button"
            onClick={() => setFilters({ compareGeos: null })}
            className="text-xs text-muted underline hover:text-accent"
          >
            Clear all
          </button>
        </li>
      )}
    </ul>
  );
}
