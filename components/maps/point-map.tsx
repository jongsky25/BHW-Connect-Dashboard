"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { accent, muted } from "@/lib/charts/palette";
import { pointRadius, type BarangayPoint } from "@/lib/geo/facility-points";

type GeoJson = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: "Point"; coordinates: [number, number] };
  }[];
};

function toGeoJson(points: BarangayPoint[], maxFacilities: number): GeoJson {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      properties: {
        geo_code: p.geoCode,
        name: p.geoName,
        n: p.nFacilities,
        __r: pointRadius(p.nFacilities, maxFacilities),
      },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  };
}

/**
 * Point map of one city/municipality's barangays, each sized by how many health facilities are
 * registered there, hollow where there are none.
 *
 * **A dot is a barangay, never a facility.** The NHFR registry carries no coordinates, so this
 * plots the barangay's own representative point (`ingestion/build_barangay_centroids.py`) and
 * labels it with a count. The wrapper that renders this says so on the page in words; this
 * component's job is to not quietly imply otherwise — which is why one barangay is one dot, and
 * why the dots are never jittered into a fake spread.
 *
 * Divergent from `ChoroplethMap` on purpose rather than by extension: circle paint driven by a
 * per-feature radius instead of `fill`/`line` paint driven by quantile bins, no drill-down (there
 * is no barangay route — `/facilities/barangay/*` 404s by design), and no selection state. What it
 * does share is the a11y posture: the canvas is decorative (`aria-hidden`, BUILD_PLAN §4.3), the
 * facility list beside it is the accessible equivalent, every injected control is taken out of the
 * tab order, and gestures cooperate so a scroll over the map still scrolls the page.
 *
 * The city/municipality outline is drawn from the boundary files the app already ships
 * (`public/geo/citymun/<province>.json`) purely so the dots have a shape to sit in; when that file
 * has no polygon for this area — the HUC/NCR gaps in `docs/BOUNDARY_RECONCILIATION.md` — the dots
 * render on their own rather than the map failing. That outline is heavily simplified (0.1% of its
 * vertices) while the centroids come from the unsimplified barangay polygons, so a coastal or
 * peninsular barangay's point can sit a little *outside* the drawn edge. The outline is context,
 * not a claim about where the boundary runs, and moving points to fit a simplified line would be
 * the wrong repair.
 */
export function PointMap({
  points,
  maxFacilities,
  outlineUrl,
  outlineGeoCode,
}: {
  points: BarangayPoint[];
  maxFacilities: number;
  outlineUrl: string | null;
  outlineGeoCode: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | undefined>(undefined);
  const [mapReady, setMapReady] = useState(false);

  const geojson = useMemo(() => toGeoJson(points, maxFacilities), [points, maxFacilities]);
  // Latest-value ref so the one-time init effect's `load` handler reads the current features
  // without re-initializing the map on every render (ChoroplethMap's `dataRef` precedent).
  const geojsonRef = useRef(geojson);
  useEffect(() => {
    geojsonRef.current = geojson;
  });

  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;

    Promise.all([
      import("maplibre-gl"),
      // A missing or unparseable outline is cosmetic, so it resolves to null rather than
      // rejecting and taking the whole map with it.
      outlineUrl
        ? fetch(outlineUrl)
            .then((r) => r.json())
            .catch(() => null)
        : Promise.resolve(null),
    ]).then(([{ default: maplibregl }, outline]) => {
      if (cancelled || !containerRef.current) return;

      const outlineFeatures = (
        (outline?.features ?? []) as { properties?: { geo_code?: string }; geometry: unknown }[]
      ).filter((f) => f.properties?.geo_code === outlineGeoCode && f.geometry);

      map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {},
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#f6f7f8" } },
          ],
        },
        center: [122, 12],
        zoom: 4.2,
        attributionControl: false,
        // Ctrl/Cmd+wheel to zoom, two-finger touch pan — a plain wheel/one-finger drag scrolls
        // the page instead of being trapped (E0.3).
        cooperativeGestures: true,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.getCanvas().tabIndex = -1;

      map.on("load", () => {
        if (!map) return;

        if (outlineFeatures.length > 0) {
          map.addSource("outline", {
            type: "geojson",
            data: { type: "FeatureCollection", features: outlineFeatures } as never,
          });
          map.addLayer({
            id: "outline-fill",
            type: "fill",
            source: "outline",
            paint: { "fill-color": "#ffffff", "fill-opacity": 0.9 },
          });
          map.addLayer({
            id: "outline-line",
            type: "line",
            source: "outline",
            paint: { "line-color": "#c8cfd3", "line-width": 1 },
          });
        }

        map.addSource("barangays", {
          type: "geojson",
          data: geojsonRef.current as never,
          promoteId: "geo_code",
        });
        // Two layers, not one paint expression: an empty barangay is a different *kind* of thing
        // from a barangay with one facility, and a hollow ring says that where a very small
        // filled dot would read as "almost none" (BUILD_PLAN §5 — no meaning by color alone;
        // fill vs. outline is the second channel).
        map.addLayer({
          id: "barangay-empty",
          type: "circle",
          source: "barangays",
          filter: ["==", ["get", "n"], 0],
          paint: {
            "circle-radius": ["get", "__r"],
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": muted,
            "circle-stroke-width": 1,
            "circle-stroke-opacity": 0.7,
          },
        });
        map.addLayer({
          id: "barangay-facilities",
          type: "circle",
          source: "barangays",
          filter: [">", ["get", "n"], 0],
          paint: {
            "circle-radius": ["get", "__r"],
            "circle-color": accent,
            "circle-opacity": 0.65,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1,
          },
        });

        const bounds = new maplibregl.LngLatBounds();
        for (const feature of geojsonRef.current.features) {
          bounds.extend(feature.geometry.coordinates);
        }
        for (const feature of outlineFeatures) {
          const coords = JSON.stringify(
            (feature.geometry as { coordinates: unknown }).coordinates,
          ).match(/-?\d+\.\d+/g);
          if (!coords) continue;
          for (let i = 0; i < coords.length - 1; i += 2) {
            bounds.extend([Number(coords[i]), Number(coords[i + 1])]);
          }
        }
        const fitAll = () => {
          if (map && !bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 32, maxZoom: 13, animate: false });
          }
        };
        fitAll();

        // "Reset view" control — re-runs the initial fitBounds (E0.3).
        const ResetControl = class {
          _container?: HTMLDivElement;
          onAdd() {
            const el = document.createElement("div");
            el.className = "maplibregl-ctrl maplibregl-ctrl-group";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.tabIndex = -1;
            btn.title = "Reset view";
            btn.setAttribute("aria-label", "Reset view");
            btn.textContent = "⤢";
            btn.style.fontSize = "14px";
            btn.addEventListener("click", () => fitAll());
            el.appendChild(btn);
            this._container = el;
            return el;
          }
          onRemove() {
            this._container?.remove();
          }
        };
        map.addControl(new ResetControl(), "top-right");

        // Keep every injected control out of the tab order — the container is aria-hidden, so a
        // focusable descendant would trip aria-hidden-focus.
        containerRef.current?.querySelectorAll("button, a").forEach((el) => {
          (el as HTMLElement).tabIndex = -1;
        });

        const LAYERS = ["barangay-facilities", "barangay-empty"];

        const showTooltip = (
          point: { x: number; y: number },
          properties: Record<string, unknown>,
        ) => {
          const tip = tooltipRef.current;
          if (!tip) return;
          const n = Number(properties.n ?? 0);
          const lines = [
            String(properties.name ?? ""),
            n === 0
              ? "No registered health facility"
              : `${n.toLocaleString()} health ${n === 1 ? "facility" : "facilities"} registered here`,
          ];
          tip.replaceChildren(
            ...lines.map((text, i) => {
              const div = document.createElement("div");
              div.textContent = text;
              if (i === 0) div.style.fontWeight = "600";
              else div.style.opacity = "0.85";
              return div;
            }),
          );
          tip.style.display = "block";
          const rect = containerRef.current?.getBoundingClientRect();
          const maxX = (rect?.width ?? 320) - 12;
          tip.style.left = `${Math.min(point.x + 12, maxX)}px`;
          tip.style.top = `${point.y + 12}px`;
        };
        const hideTooltip = () => {
          if (tooltipRef.current) tooltipRef.current.style.display = "none";
        };

        for (const layer of LAYERS) {
          map.on("mouseenter", layer, () => {
            if (map) map.getCanvas().style.cursor = "pointer";
          });
          map.on("mousemove", layer, (e) => {
            const properties = e.features?.[0]?.properties;
            if (properties) showTooltip(e.point, properties);
          });
          map.on("mouseleave", layer, () => {
            if (map) map.getCanvas().style.cursor = "";
            hideTooltip();
          });
        }
        // Touch has no hover: a tap on a dot reads it out, a tap elsewhere dismisses. Same flow,
        // and harmless on mouse.
        map.on("click", (e) => {
          if (!map) return;
          const hit = map.queryRenderedFeatures(e.point, { layers: LAYERS })[0];
          if (hit?.properties) showTooltip(e.point, hit.properties);
          else hideTooltip();
        });

        setMapReady(true);
      });
    });

    return () => {
      cancelled = true;
      setMapReady(false);
      mapRef.current = undefined;
      map?.remove();
    };
  }, [outlineUrl, outlineGeoCode]);

  // Repaint without re-initializing when the points change (a client-side navigation between two
  // city/municipality pages reuses this component). Gated on a signature so an unrelated
  // re-render doesn't trigger a needless `setData` — ChoroplethMap's precedent.
  const pointSignature = useMemo(
    () => JSON.stringify([maxFacilities, points.map((p) => [p.geoCode, p.nFacilities])]),
    [points, maxFacilities],
  );
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource("barangays") as { setData?: (data: unknown) => void } | undefined;
    source?.setData?.(geojsonRef.current);
  }, [pointSignature, mapReady]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        aria-hidden="true"
        className="h-80 w-full overflow-hidden rounded-md border border-border presentation:h-[60vh]"
      />
      <div
        ref={tooltipRef}
        aria-hidden="true"
        className="pointer-events-none absolute z-10 hidden max-w-[220px] rounded-md border border-border bg-background px-2 py-1 text-xs shadow-md"
        style={{ display: "none" }}
      />
    </div>
  );
}
