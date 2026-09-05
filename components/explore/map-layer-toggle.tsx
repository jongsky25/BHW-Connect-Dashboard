"use client";

import { useFilterState } from "@/lib/filters/use-filter-state";
import { useExploreNav } from "@/components/explore/explore-nav";
import { logEvent } from "@/lib/usage/log-client";
import type { MapLayer } from "@/lib/filters/schema";

/**
 * D3.3 — "/explore: district as ... a map layer." National-level-only toggle between the existing
 * region choropleth (`GeoComparisonFigure`) and the legislative-district choropleth
 * (`DistrictMapFigure`, D3.2's boundaries). A district doesn't nest inside a region the way a
 * child geo does (plan §1), so this switches which figure renders rather than adding a "district"
 * rung to the existing geoLevel drill-down.
 */
export function MapLayerToggle({ active }: { active: MapLayer }) {
  const { startTransition } = useExploreNav();
  const [, setFilters] = useFilterState({ startTransition });

  function change(next: MapLayer) {
    logEvent("map_indicator_change", { meta: { mapLayer: next } });
    setFilters({ mapLayer: next });
  }

  return (
    <div className="flex w-fit items-center gap-1 rounded-md border border-border bg-surface p-1 text-sm">
      <button
        type="button"
        onClick={() => change("geo")}
        aria-pressed={active === "geo"}
        className={`rounded px-3 py-1 ${active === "geo" ? "bg-background font-medium shadow-sm" : "text-muted hover:text-foreground"}`}
      >
        By region
      </button>
      <button
        type="button"
        onClick={() => change("district")}
        aria-pressed={active === "district"}
        className={`rounded px-3 py-1 ${active === "district" ? "bg-background font-medium shadow-sm" : "text-muted hover:text-foreground"}`}
      >
        By legislative district
      </button>
    </div>
  );
}
