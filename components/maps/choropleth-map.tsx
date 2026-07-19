"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { useQueryStates } from "nuqs";
import { filterParsers } from "@/lib/filters/codec";
import { colorForValue, NO_DATA_COLOR } from "@/lib/charts/color-scale";
import type { GeoLevel } from "@/lib/filters/schema";

export type ChoroplethDatum = { geoCode: string; value: number | null };

export function ChoroplethMap({
  geojsonUrl,
  childLevel,
  values,
}: {
  geojsonUrl: string;
  childLevel: GeoLevel;
  values: ChoroplethDatum[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setFilters] = useQueryStates(filterParsers, { shallow: false, history: "push" });

  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;

    const valueByCode = new Map(values.map((v) => [v.geoCode, v.value]));
    const numericValues = values.map((v) => v.value).filter((v): v is number => v !== null);
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);

    Promise.all([import("maplibre-gl"), fetch(geojsonUrl).then((r) => r.json())]).then(
      ([{ default: maplibregl }, geojson]) => {
        if (cancelled || !containerRef.current) return;

        for (const feature of geojson.features) {
          const code = feature.properties.geo_code;
          const value = valueByCode.get(code);
          feature.properties.__color =
            value === undefined || value === null ? NO_DATA_COLOR : colorForValue(value, min, max);
        }

        map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {},
            layers: [{ id: "background", type: "background", paint: { "background-color": "#f6f7f8" } }],
          },
          center: [122, 12],
          zoom: 4.2,
          attributionControl: false,
        });

        // This map is aria-hidden (decorative — the ranked list right below it
        // carries the same data accessibly), so its canvas must not be
        // reachable by keyboard either, or aria-hidden-focus is violated.
        map.getCanvas().tabIndex = -1;

        map.on("load", () => {
          if (!map) return;
          map.addSource("geo", { type: "geojson", data: geojson });
          map.addLayer({
            id: "geo-fill",
            type: "fill",
            source: "geo",
            paint: { "fill-color": ["get", "__color"], "fill-opacity": 0.9 },
          });
          map.addLayer({
            id: "geo-outline",
            type: "line",
            source: "geo",
            paint: { "line-color": "#ffffff", "line-width": 1 },
          });

          const bounds = new maplibregl.LngLatBounds();
          for (const feature of geojson.features) {
            const coords = JSON.stringify(feature.geometry.coordinates).match(/-?\d+\.\d+/g);
            if (!coords) continue;
            for (let i = 0; i < coords.length - 1; i += 2) {
              bounds.extend([Number(coords[i]), Number(coords[i + 1])]);
            }
          }
          if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 20, animate: false });

          map.on("mouseenter", "geo-fill", () => {
            if (map) map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "geo-fill", () => {
            if (map) map.getCanvas().style.cursor = "";
          });
          map.on("click", "geo-fill", (e) => {
            const code = e.features?.[0]?.properties?.geo_code;
            if (code) setFilters({ geoLevel: childLevel, geoCode: code });
          });
        });
      },
    );

    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojsonUrl, childLevel]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="h-80 w-full overflow-hidden rounded-md border border-border"
    />
  );
}
