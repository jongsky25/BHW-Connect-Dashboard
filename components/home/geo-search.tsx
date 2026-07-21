"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { logEvent } from "@/lib/usage/log-client";
import { formatCount } from "@/lib/format";

type GeoParentChain = { region?: string; province?: string; citymun?: string };

type GeoSearchResult = {
  geoCode: string;
  geoLevel: string;
  geoName: string;
  nTotal: number | null;
  parentChain?: GeoParentChain;
};

type Status = "idle" | "loading" | "done" | "error";

const GEO_LEVEL_LABEL: Record<string, string> = {
  national: "Country",
  region: "Region",
  province: "Province",
  citymun: "City/Municipality",
  barangay: "Barangay",
};

/** Example queries that demonstrate what the box accepts — a region nickname, a
 * province, and the hint that a barangay works too (typos tolerated). */
const EXAMPLE_QUERIES = ["Cebu", "CALABARZON", "Quezon City"];

const RECENTS_KEY = "bhw:recent-places";
const RECENTS_MAX = 5;

type RecentPlace = { geoCode: string; geoLevel: string; geoName: string };

function loadRecents(): RecentPlace[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.slice(0, RECENTS_MAX) as RecentPlace[]) : [];
  } catch {
    return [];
  }
}

/** Most-specific-first ancestor label, e.g. "Carcar City, Cebu" for a barangay.
 * Skips any ancestor equal to the place's own name (a region row lists itself as
 * its own region parent) and caps at two levels to stay on one line. */
function parentLabel(result: GeoSearchResult): string {
  const chain = result.parentChain ?? {};
  const parts = [chain.citymun, chain.province, chain.region].filter(
    (p): p is string => Boolean(p) && p !== result.geoName,
  );
  return parts.slice(0, 2).join(", ");
}

function dataLabel(nTotal: number | null): { text: string; hasData: boolean } {
  return nTotal !== null && nTotal > 0
    ? { text: `${formatCount(nTotal)} BHWs profiled`, hasData: true }
    : { text: "No profile data yet", hasData: false };
}

export function GeoSearch({
  variant = "hero",
  mode = "place",
}: {
  variant?: "hero" | "compact";
  /** Where a selection navigates. `place` → the geo's place page (default, used
   * on Home/place). `explore` → stays on `/explore` with the geo applied as
   * filter params, so the Explore sidebar search browses in place (E1.6). */
  mode?: "place" | "explore";
}) {
  const router = useRouter();
  const hrefFor = (geoLevel: string, geoCode: string) =>
    mode === "explore"
      ? `/explore?geoLevel=${geoLevel}&geoCode=${geoCode}`
      : `/place/${geoLevel}/${geoCode}`;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoSearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recents, setRecents] = useState<RecentPlace[]>([]);
  const requestId = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const trimmed = query.trim();

  // Recent places are client-only (localStorage), loaded after mount so server
  // and first client render match. The load is deferred to a timeout so the
  // state update happens outside the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    const t = setTimeout(() => setRecents(loadRecents()), 0);
    return () => clearTimeout(t);
  }, []);

  function rememberRecent(result: GeoSearchResult) {
    const entry: RecentPlace = {
      geoCode: result.geoCode,
      geoLevel: result.geoLevel,
      geoName: result.geoName,
    };
    const next = [entry, ...recents.filter((r) => r.geoCode !== entry.geoCode)].slice(
      0,
      RECENTS_MAX,
    );
    setRecents(next);
    try {
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (private mode / quota) — recents are best-effort.
    }
  }

  useEffect(() => {
    const currentRequest = ++requestId.current;

    // All state updates run inside the (asynchronous) timeout callback, never in
    // the effect body — synchronous setState in an effect triggers cascading
    // renders (react-hooks/set-state-in-effect). Empty query resets on the next
    // tick; a real query debounces 250 ms, then shows the spinner and fetches.
    const timeout = setTimeout(
      async () => {
        if (!trimmed) {
          setResults([]);
          setStatus("idle");
          setActiveIndex(-1);
          return;
        }

        setStatus("loading");
        try {
          const res = await fetch(`/api/geo/search?q=${encodeURIComponent(trimmed)}`);
          if (currentRequest !== requestId.current) return;
          const body = await res.json();
          const next: GeoSearchResult[] = body.results ?? [];
          setResults(next);
          setStatus("done");
          // Auto-highlight the top result so Enter selects it and screen readers
          // announce an active option immediately.
          setActiveIndex(next.length > 0 ? 0 : -1);
          logEvent("search", { meta: { query: trimmed, resultCount: next.length } });
        } catch {
          if (currentRequest === requestId.current) {
            setResults([]);
            setStatus("error");
            setActiveIndex(-1);
          }
        }
      },
      trimmed ? 250 : 0,
    );

    return () => clearTimeout(timeout);
  }, [trimmed]);

  // Close the dropdown on any click outside the widget.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const listVisible = open && trimmed.length > 0;
  const hintsVisible = open && trimmed.length === 0 && variant === "hero";
  const optionId = (i: number) => `${listId}-opt-${i}`;

  function navigateTo(result: GeoSearchResult) {
    rememberRecent(result);
    setOpen(false);
    router.push(hrefFor(result.geoLevel, result.geoCode));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!listVisible || results.length === 0) {
      // With no open list, Enter still submits to the best match once one loads.
      if (event.key === "Enter" && results.length > 0) {
        event.preventDefault();
        navigateTo(results[Math.max(0, activeIndex)]);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      navigateTo(results[activeIndex >= 0 ? activeIndex : 0]);
    }
  }

  return (
    <div ref={containerRef} className={`relative w-full ${variant === "hero" ? "max-w-md" : ""}`}>
      <label htmlFor="geo-search-input" className="sr-only">
        Find your barangay, city, province, or region
      </label>

      <div className="relative">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          id="geo-search-input"
          type="search"
          role="combobox"
          aria-expanded={listVisible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            listVisible && activeIndex >= 0 && results.length > 0
              ? optionId(activeIndex)
              : undefined
          }
          autoComplete="off"
          placeholder="Find your barangay, city, province, or region"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`w-full rounded-md border border-border bg-background pl-9 pr-4 shadow-sm focus:border-accent ${
            variant === "hero" ? "py-2.5 text-sm" : "py-2 text-sm"
          }`}
        />
        {status === "loading" && (
          <span
            role="status"
            aria-label="Searching"
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-border border-t-accent"
          />
        )}
      </div>

      <p className="sr-only" role="status">
        {status === "loading"
          ? "Searching…"
          : status === "error"
            ? "Search failed. Check your connection."
            : status === "done"
              ? `${results.length} result${results.length === 1 ? "" : "s"} found`
              : ""}
      </p>

      {listVisible && (
        <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-md border border-border bg-background text-left shadow-lg">
          {status === "error" ? (
            <p className="px-4 py-3 text-sm text-muted">
              Couldn&apos;t search — check your connection and try again.
            </p>
          ) : status === "loading" && results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">No matching places found.</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Search results">
              {results.map((result, i) => {
                const parents = parentLabel(result);
                const data = dataLabel(result.nTotal);
                return (
                  <li
                    key={result.geoCode}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                  >
                    <Link
                      href={hrefFor(result.geoLevel, result.geoCode)}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => {
                        rememberRecent(result);
                        setOpen(false);
                      }}
                      className={`flex items-start justify-between gap-3 px-4 py-2.5 text-sm ${
                        i === activeIndex ? "bg-surface" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{result.geoName}</span>
                        {parents && (
                          <span className="block truncate text-xs text-muted">{parents}</span>
                        )}
                        <span
                          className={`block text-xs ${data.hasData ? "text-muted" : "text-muted/70"}`}
                        >
                          {data.text}
                        </span>
                      </span>
                      <span className="shrink-0 pt-0.5 text-xs text-muted">
                        {GEO_LEVEL_LABEL[result.geoLevel] ?? result.geoLevel}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {hintsVisible && (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-md border border-border bg-background p-3 text-left shadow-lg">
          {recents.length > 0 && (
            <div className="mb-3 border-b border-border pb-3">
              <p className="text-xs text-muted">Recent places:</p>
              <ul className="mt-1">
                {recents.map((recent) => (
                  <li key={recent.geoCode}>
                    <Link
                      href={hrefFor(recent.geoLevel, recent.geoCode)}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between gap-3 rounded px-1 py-1.5 text-sm hover:bg-surface"
                    >
                      <span className="truncate">{recent.geoName}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {GEO_LEVEL_LABEL[recent.geoLevel] ?? recent.geoLevel}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted">Try searching for a place:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setQuery(example);
                  setOpen(true);
                }}
                className="rounded-full border border-border px-3 py-1 text-xs hover:border-accent hover:bg-surface"
              >
                {example}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Not sure of the spelling?{" "}
            <Link
              href="/explore"
              className="underline hover:text-accent"
              onClick={() => setOpen(false)}
            >
              Browse by location
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
