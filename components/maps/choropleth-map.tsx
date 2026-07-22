"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { colorForValue, NO_DATA_COLOR, type ColorBin } from "@/lib/charts/color-scale";
import { accent } from "@/lib/charts/palette";
import type { GeoLevel } from "@/lib/filters/schema";

export type ChoroplethDatum = {
  geoCode: string;
  geoName: string;
  value: number | null;
  nTotal: number | null;
};

function formatValue(value: number, suffix: string): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString()}${suffix}`;
}

type GeoFeature = { properties: Record<string, unknown> };
type GeoJson = { features: GeoFeature[] };

/**
 * Paint each child polygon's fill color + small-N flag from the current data and
 * quantile bins, mutating `geojson.features[i].properties` in place. Called once
 * before the source is added, then again (with a `setData`) whenever the active
 * indicator changes — the map is otherwise stuck on the colors baked in at load.
 */
function paintFeatures(
  geojson: GeoJson,
  data: ChoroplethDatum[],
  bins: ColorBin[],
  minLeaderN: number,
) {
  const dataMap = new Map(data.map((d) => [d.geoCode, d]));
  for (const feature of geojson.features) {
    const code = feature.properties.geo_code as string;
    const datum = dataMap.get(code);
    const value = datum?.value;
    const smallN = datum != null && datum.nTotal != null && datum.nTotal < minLeaderN;
    feature.properties.__color =
      value === undefined || value === null ? NO_DATA_COLOR : colorForValue(value, bins);
    feature.properties.__smallN = smallN && value !== undefined && value !== null;
  }
}

/**
 * Choropleth of a geo's direct children. The canvas is decorative
 * (`aria-hidden`) — the ranked list beside it is the accessible equivalent
 * (BUILD_PLAN §4.3) — so every control this map injects (nav, reset, and the
 * map canvas itself) is made non-focusable, and the interactive drill path
 * lives in the parent's real-DOM mini-card and ranked list.
 *
 * Colors come from the shared quantile `bins` (E0.1) so the legend and the map
 * paint identical ranges. Click *selects* (not navigates); the parent renders a
 * mini-card and a second click / the mini-card's "Open" button drills (E0.2).
 * Small-N children (`nTotal < minLeaderN`) render desaturated with a dashed
 * outline (E0.5). Hover round-trips with the ranked list via `hoveredGeoCode`
 * (E0.4).
 */
export function ChoroplethMap({
  geojsonUrl,
  childLevel,
  data,
  bins,
  valueSuffix = "",
  minLeaderN,
  selectedGeoCode,
  hoveredGeoCode,
  onHoverGeo,
  onSelectGeo,
  onDrill,
}: {
  geojsonUrl: string;
  childLevel: GeoLevel;
  data: ChoroplethDatum[];
  bins: ColorBin[];
  valueSuffix?: string;
  minLeaderN: number;
  selectedGeoCode: string | null;
  hoveredGeoCode: string | null;
  onHoverGeo: (code: string | null) => void;
  onSelectGeo: (code: string | null) => void;
  onDrill: (code: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | undefined>(undefined);
  // The loaded GeoJSON, kept so the recolor effect can repaint its features and
  // `setData` when the active indicator changes without re-initializing the map.
  const geojsonRef = useRef<GeoJson | null>(null);
  // Current child data keyed by code, so the tooltip reads live values after an
  // indicator change (the map init closure would otherwise capture stale data).
  const dataMapRef = useRef(new Map<string, ChoroplethDatum>());
  const [mapReady, setMapReady] = useState(false);

  // Latest-prop refs so the one-time init effect's map handlers always read
  // current values without re-initializing the map on every render.
  const dataRef = useRef(data);
  const binsRef = useRef(bins);
  const suffixRef = useRef(valueSuffix);
  const minNRef = useRef(minLeaderN);
  const selectedRef = useRef(selectedGeoCode);
  const onHoverRef = useRef(onHoverGeo);
  const onSelectRef = useRef(onSelectGeo);
  const onDrillRef = useRef(onDrill);
  useEffect(() => {
    dataRef.current = data;
    binsRef.current = bins;
    suffixRef.current = valueSuffix;
    minNRef.current = minLeaderN;
    selectedRef.current = selectedGeoCode;
    onHoverRef.current = onHoverGeo;
    onSelectRef.current = onSelectGeo;
    onDrillRef.current = onDrill;
    dataMapRef.current = new Map(data.map((d) => [d.geoCode, d]));
  });

  // Track feature-state we've set so it can be cleared without a full sweep.
  const lastHoverAppliedRef = useRef<string | null>(null);
  const lastSelectAppliedRef = useRef<string | null>(null);
  // Hovered code the map itself last reported, so mousemove only fires the
  // parent callback when the polygon under the cursor actually changes.
  const lastReportedHoverRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;

    Promise.all([import("maplibre-gl"), fetch(geojsonUrl).then((r) => r.json())]).then(
      ([{ default: maplibregl }, geojson]) => {
        if (cancelled || !containerRef.current) return;

        geojsonRef.current = geojson;
        paintFeatures(geojson, dataRef.current, binsRef.current, minNRef.current);

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
          // Ctrl/Cmd+wheel to zoom, two-finger touch pan — a plain wheel/one-
          // finger drag scrolls the page instead of being trapped (E0.3).
          cooperativeGestures: true,
        });
        mapRef.current = map;

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

        map.getCanvas().tabIndex = -1;

        map.on("load", () => {
          if (!map) return;
          map.addSource("geo", { type: "geojson", data: geojson, promoteId: "geo_code" });
          map.addLayer({
            id: "geo-fill",
            type: "fill",
            source: "geo",
            paint: {
              "fill-color": ["get", "__color"],
              // Desaturate small-N polygons (E0.5).
              "fill-opacity": ["case", ["==", ["get", "__smallN"], true], 0.4, 0.9],
            },
          });
          map.addLayer({
            id: "geo-outline",
            type: "line",
            source: "geo",
            paint: { "line-color": "#ffffff", "line-width": 1 },
          });
          // Dashed outline for small-N children.
          map.addLayer({
            id: "geo-outline-smalln",
            type: "line",
            source: "geo",
            filter: ["==", ["get", "__smallN"], true],
            paint: { "line-color": "#94a3b8", "line-width": 1, "line-dasharray": [2, 2] },
          });
          // Hover / selection highlight, driven by feature-state (E0.4/E0.2).
          map.addLayer({
            id: "geo-highlight",
            type: "line",
            source: "geo",
            paint: {
              "line-color": accent,
              "line-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                3,
                ["boolean", ["feature-state", "hovered"], false],
                2,
                0,
              ],
            },
          });

          const bounds = new maplibregl.LngLatBounds();
          for (const feature of geojson.features) {
            // Some boundary features carry a null geometry (e.g. the Kalayaan /
            // Spratly Islands citymun) — skip them rather than crash on `.coordinates`.
            if (!feature.geometry) continue;
            const coords = JSON.stringify(feature.geometry.coordinates).match(/-?\d+\.\d+/g);
            if (!coords) continue;
            for (let i = 0; i < coords.length - 1; i += 2) {
              bounds.extend([Number(coords[i]), Number(coords[i + 1])]);
            }
          }
          const fitAll = () => {
            if (map && !bounds.isEmpty()) map.fitBounds(bounds, { padding: 20, animate: false });
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

          // Keep every injected control out of the tab order — the container is
          // aria-hidden, so a focusable descendant would trip aria-hidden-focus.
          containerRef.current?.querySelectorAll("button, a").forEach((el) => {
            (el as HTMLElement).tabIndex = -1;
          });

          map.on("mouseenter", "geo-fill", () => {
            if (map) map.getCanvas().style.cursor = "pointer";
          });
          map.on("mousemove", "geo-fill", (e) => {
            const code = e.features?.[0]?.properties?.geo_code as string | undefined;
            const tip = tooltipRef.current;
            if (!code || !tip || !map) return;
            if (code !== lastReportedHoverRef.current) {
              lastReportedHoverRef.current = code;
              onHoverRef.current(code);
            }
            const datum = dataMapRef.current.get(code);
            const name = datum?.geoName ?? code;
            const parts: string[] = [name];
            if (datum?.value == null) {
              parts.push("No data — see ranked list");
            } else {
              parts.push(
                `${formatValue(datum.value, suffixRef.current)}${datum.nTotal != null ? ` · ${datum.nTotal.toLocaleString()} profiled` : ""}`,
              );
              if (datum.nTotal != null && datum.nTotal < minNRef.current) {
                parts.push(
                  `Only ${datum.nTotal.toLocaleString()} BHWs profiled — rate is unstable.`,
                );
              }
            }
            tip.replaceChildren(
              ...parts.map((text, i) => {
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
            tip.style.left = `${Math.min(e.point.x + 12, maxX)}px`;
            tip.style.top = `${e.point.y + 12}px`;
          });
          map.on("mouseleave", "geo-fill", () => {
            if (map) map.getCanvas().style.cursor = "";
            if (tooltipRef.current) tooltipRef.current.style.display = "none";
            if (lastReportedHoverRef.current !== null) {
              lastReportedHoverRef.current = null;
              onHoverRef.current(null);
            }
          });

          // Single click handler: select, drill-on-second-click, or dismiss on
          // background click (E0.2). One flow for mouse and touch.
          map.on("click", (e) => {
            if (!map) return;
            const hits = map.queryRenderedFeatures(e.point, { layers: ["geo-fill"] });
            const code = hits[0]?.properties?.geo_code as string | undefined;
            if (!code) {
              onSelectRef.current(null);
              return;
            }
            if (code === selectedRef.current) onDrillRef.current(code);
            else onSelectRef.current(code);
          });

          setMapReady(true);
        });
      },
    );

    return () => {
      cancelled = true;
      setMapReady(false);
      lastHoverAppliedRef.current = null;
      lastSelectAppliedRef.current = null;
      lastReportedHoverRef.current = null;
      geojsonRef.current = null;
      mapRef.current = undefined;
      map?.remove();
    };
  }, [geojsonUrl, childLevel]);

  // Recolor the polygons when the active indicator changes (new `data`/`bins`)
  // without re-initializing the map. A value/bins signature gates the effect so
  // an unrelated re-render (e.g. hover state) doesn't trigger a needless
  // `setData` — the actual bug fix: the map was otherwise stuck on the colors
  // baked in at load, so switching indicators only re-sorted the ranked list.
  const paintSignature = useMemo(
    () => JSON.stringify([minLeaderN, bins, data.map((d) => [d.geoCode, d.value, d.nTotal])]),
    [data, bins, minLeaderN],
  );
  useEffect(() => {
    const map = mapRef.current;
    const geojson = geojsonRef.current;
    if (!map || !mapReady || !geojson) return;
    paintFeatures(geojson, dataRef.current, binsRef.current, minNRef.current);
    const source = map.getSource("geo") as { setData?: (data: unknown) => void } | undefined;
    source?.setData?.(geojson);
  }, [paintSignature, mapReady]);

  // Reflect hovered code (from map or ranked list) as a polygon outline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const prev = lastHoverAppliedRef.current;
    if (prev && prev !== hoveredGeoCode)
      map.setFeatureState({ source: "geo", id: prev }, { hovered: false });
    if (hoveredGeoCode)
      map.setFeatureState({ source: "geo", id: hoveredGeoCode }, { hovered: true });
    lastHoverAppliedRef.current = hoveredGeoCode;
  }, [hoveredGeoCode, mapReady]);

  // Reflect the selected code as a stronger outline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const prev = lastSelectAppliedRef.current;
    if (prev && prev !== selectedGeoCode)
      map.setFeatureState({ source: "geo", id: prev }, { selected: false });
    if (selectedGeoCode)
      map.setFeatureState({ source: "geo", id: selectedGeoCode }, { selected: true });
    lastSelectAppliedRef.current = selectedGeoCode;
  }, [selectedGeoCode, mapReady]);

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
