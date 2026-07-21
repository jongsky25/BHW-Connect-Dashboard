"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryStates } from "nuqs";
import { filterParsers } from "@/lib/filters/codec";

type GeoSearchResult = { geoCode: string; geoLevel: string; geoName: string; nTotal: number | null };

/**
 * Same debounced search as the home page's "find my barangay" box, but
 * selecting a result appends it to the compare set (?geos=) instead of
 * navigating to a place page.
 */
export function AddGeoSearch({ disabled }: { disabled?: boolean }) {
  const [filters, setFilters] = useQueryStates(filterParsers, { shallow: false, history: "push" });
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

  function addGeo(geoCode: string) {
    const current = filters.compareGeos ?? [];
    if (current.includes(geoCode) || current.length >= 4) return;
    setFilters({ compareGeos: [...current, geoCode] });
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
              <li key={r.geoCode}>
                <button
                  type="button"
                  onClick={() => addGeo(r.geoCode)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface"
                >
                  <span>{r.geoName}</span>
                  <span className="shrink-0 text-xs text-muted">{r.geoLevel}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
