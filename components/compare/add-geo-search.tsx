"use client";

import { useEffect, useRef, useState } from "react";
import { useFilterState } from "@/lib/filters/use-filter-state";

type GeoHit = { kind: "geo"; geoCode: string; geoLevel: string; geoName: string; nTotal: number | null };
/** D3.3 — a district hit from `/api/geo/search`, addable to the district-vs-district compare set
 * (`?districts=`) — never mixed with `?geos=` (a district isn't a `dim_geo` row, guardrail 7). */
type DistrictHit = {
  kind: "district";
  districtCode: string;
  districtName: string;
  bhwTotal: number | null;
};
type GeoSearchResult = GeoHit | DistrictHit;

/**
 * Same debounced search as the home page's "find my barangay" box, but selecting a result appends
 * it to the compare set instead of navigating away — `?geos=` for a place, `?districts=` for a
 * district (D3.3). Adding one kind clears the other: the two never mix on one comparison (a
 * district isn't a `dim_geo` row to compare against a place, guardrail 7), mirroring how mismatched
 * geo levels are already disallowed on this page.
 */
export function AddGeoSearch({ disabled }: { disabled?: boolean }) {
  const [filters, setFilters] = useFilterState();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const currentRequest = ++requestId.current;
    const timeout = setTimeout(async () => {
      if (!trimmed) {
        setResults([]);
        setHasSearched(false);
        return;
      }
      try {
        const res = await fetch(`/api/geo/search?q=${encodeURIComponent(trimmed)}`);
        if (currentRequest !== requestId.current) return;
        const body = await res.json();
        setResults(body.results ?? []);
        setHasSearched(true);
      } catch {
        if (currentRequest === requestId.current) {
          setResults([]);
          setHasSearched(true);
        }
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  function addResult(result: GeoSearchResult) {
    if (result.kind === "district") {
      const current = filters.compareDistricts ?? [];
      if (current.includes(result.districtCode) || current.length >= 4) return;
      setFilters({ compareDistricts: [...current, result.districtCode], compareGeos: null });
    } else {
      const current = filters.compareGeos ?? [];
      if (current.includes(result.geoCode) || current.length >= 4) return;
      setFilters({ compareGeos: [...current, result.geoCode], compareDistricts: null });
    }
    setQuery("");
    setResults([]);
    setHasSearched(false);
  }

  return (
    <div className="relative w-full max-w-sm">
      <label htmlFor="add-geo-search-input" className="sr-only">
        Add a place to compare
      </label>
      <input
        id="add-geo-search-input"
        type="search"
        autoComplete="off"
        disabled={disabled}
        placeholder={disabled ? "Remove a place to add another (max 4)" : "Add a place to compare…"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus:border-accent disabled:opacity-50"
      />
      {hasSearched && !disabled && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-background shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No matching places found.</li>
          ) : (
            results.map((r) => (
              <li key={r.kind === "district" ? r.districtCode : r.geoCode}>
                <button
                  type="button"
                  onClick={() => addResult(r)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface"
                >
                  <span>{r.kind === "district" ? r.districtName : r.geoName}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {r.kind === "district" ? "District" : r.geoLevel}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
