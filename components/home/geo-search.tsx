"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logEvent } from "@/lib/usage/log-client";

type GeoSearchResult = {
  geoCode: string;
  geoLevel: string;
  geoName: string;
  nTotal: number | null;
};

const GEO_LEVEL_LABEL: Record<string, string> = {
  national: "Country",
  region: "Region",
  province: "Province",
  citymun: "City/Municipality",
  barangay: "Barangay",
};

export function GeoSearch() {
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
        logEvent("search", { meta: { query: trimmed, resultCount: (body.results ?? []).length } });
      } catch {
        if (currentRequest === requestId.current) {
          setResults([]);
          setHasSearched(true);
        }
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="w-full max-w-md">
      <label htmlFor="geo-search-input" className="sr-only">
        Find your barangay, city, province, or region
      </label>
      <input
        id="geo-search-input"
        type="search"
        autoComplete="off"
        placeholder="Find your barangay, city, province, or region"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm shadow-sm focus:border-accent"
      />

      <p className="sr-only" role="status">
        {hasSearched
          ? `${results.length} result${results.length === 1 ? "" : "s"} found`
          : ""}
      </p>

      {hasSearched && (
        <ul className="mt-1 overflow-hidden rounded-md border border-border bg-background text-left shadow-lg">
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">No matching places found.</li>
          ) : (
            results.map((result) => (
              <li key={result.geoCode}>
                <Link
                  href={`/place/${result.geoLevel}/${result.geoCode}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface"
                >
                  <span>{result.geoName}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {GEO_LEVEL_LABEL[result.geoLevel] ?? result.geoLevel}
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
