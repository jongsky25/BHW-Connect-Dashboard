import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GeoLevel } from "@/lib/filters/schema";
import type { GeoAncestors } from "@/lib/db/geo";

/** GeoJSON subset actually present in public/geo/* (see ingestion/reconcile_boundaries.py). */
type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type BoundaryCollection = {
  features: { properties: { geo_code?: string }; geometry: Geometry }[];
};

export type LocatorMap = {
  /** `0 0 W H`, longer edge scaled to LONG_EDGE. */
  viewBox: string;
  /** All sibling polygons in the context file, as one SVG path. */
  contextPath: string;
  /** The highlighted geo's polygon(s). Empty when it collapsed below pixel size. */
  highlightPath: string;
  /** Ring marker at the highlight's center, when the polygon is too small to see. */
  marker: { cx: number; cy: number } | null;
};

export type PlaceLocator = LocatorMap & {
  /** Name of the geo the highlight outlines. */
  highlightName: string;
  /** True on barangay pages, where the parent citymun is highlighted instead
   * (barangay boundaries aren't in the boundary pipeline). */
  highlightIsParent: boolean;
};

/** Longer edge of the viewBox, in SVG user units. */
const LONG_EDGE = 200;
/** Context rings whose bounding box is under this (px) are dropped — invisible
 * islets that would only bloat the inline SVG. Highlight rings are never dropped. */
const MIN_CONTEXT_RING_PX = 2;
/** Below this highlight size (px, longer edge) a ring marker is added so the
 * place stays findable in the thumbnail. */
const MARKER_THRESHOLD_PX = 8;

function ringsOf(geometry: Geometry): number[][][] {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function extend(b: Bounds, x: number, y: number) {
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y;
  if (y > b.maxY) b.maxY = y;
}

function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

/**
 * Projects a boundary FeatureCollection into a small inline-SVG locator:
 * every feature drawn as muted context, the `highlightCode` feature drawn
 * in accent on top. Pure — fs/IO lives in {@link getPlaceLocator}.
 *
 * Equirectangular projection with a cos(mid-latitude) x-correction is plenty
 * at thumbnail scale; coordinates are rounded to integers and consecutive
 * duplicates dropped, which cuts the whole-country context from ~600 KB of
 * GeoJSON to ~44 KB of path data.
 */
export function buildLocatorMap(
  collection: BoundaryCollection,
  highlightCode: string,
): LocatorMap | null {
  const highlightFeatures = collection.features.filter(
    (f) => f.properties.geo_code === highlightCode,
  );
  if (highlightFeatures.length === 0) return null;

  const lonLat = emptyBounds();
  for (const feature of collection.features) {
    for (const ring of ringsOf(feature.geometry)) {
      for (const [x, y] of ring) extend(lonLat, x, y);
    }
  }
  if (lonLat.minX > lonLat.maxX) return null;

  const kx = Math.cos((((lonLat.minY + lonLat.maxY) / 2) * Math.PI) / 180);
  const spanX = (lonLat.maxX - lonLat.minX) * kx || 1e-9;
  const spanY = lonLat.maxY - lonLat.minY || 1e-9;
  const scale = LONG_EDGE / Math.max(spanX, spanY);
  const width = Math.max(1, Math.round(spanX * scale));
  const height = Math.max(1, Math.round(spanY * scale));

  const project = ([x, y]: number[]): [number, number] => [
    (x - lonLat.minX) * kx * scale,
    (lonLat.maxY - y) * scale,
  ];

  const ringToPath = (ring: number[][], dropTiny: boolean): string => {
    const pts: [number, number][] = [];
    for (const position of ring) {
      const [px, py] = project(position).map(Math.round) as [number, number];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== px || last[1] !== py) pts.push([px, py]);
    }
    if (pts.length < 4) return "";
    if (dropTiny) {
      const b = emptyBounds();
      for (const [px, py] of pts) extend(b, px, py);
      if (b.maxX - b.minX < MIN_CONTEXT_RING_PX && b.maxY - b.minY < MIN_CONTEXT_RING_PX) return "";
    }
    return `M${pts.map((p) => p.join(" ")).join("L")}Z`;
  };

  let contextPath = "";
  for (const feature of collection.features) {
    if (feature.properties.geo_code === highlightCode) continue;
    for (const ring of ringsOf(feature.geometry)) contextPath += ringToPath(ring, true);
  }

  let highlightPath = "";
  const highlightBounds = emptyBounds();
  for (const feature of highlightFeatures) {
    for (const ring of ringsOf(feature.geometry)) {
      highlightPath += ringToPath(ring, false);
      for (const position of ring) {
        const [px, py] = project(position);
        extend(highlightBounds, px, py);
      }
    }
  }
  if (highlightBounds.minX > highlightBounds.maxX) return null;

  const highlightSpan = Math.max(
    highlightBounds.maxX - highlightBounds.minX,
    highlightBounds.maxY - highlightBounds.minY,
  );
  const marker =
    highlightSpan < MARKER_THRESHOLD_PX
      ? {
          cx: Math.round((highlightBounds.minX + highlightBounds.maxX) / 2),
          cy: Math.round((highlightBounds.minY + highlightBounds.maxY) / 2),
        }
      : null;

  return { viewBox: `0 0 ${width} ${height}`, contextPath, highlightPath, marker };
}

const GEO_DIR = path.join(process.cwd(), "public", "geo");

// Boundary files are immutable per deploy, so parses are cached for the
// lifetime of the server process (keyed by relative path; failures cache as
// null so a missing file isn't re-stat'd on every render).
const fileCache = new Map<string, Promise<BoundaryCollection | null>>();

function loadBoundaryFile(relPath: string): Promise<BoundaryCollection | null> {
  let entry = fileCache.get(relPath);
  if (!entry) {
    entry = readFile(path.join(GEO_DIR, relPath), "utf8")
      .then((raw) => JSON.parse(raw) as BoundaryCollection)
      .catch(() => null);
    fileCache.set(relPath, entry);
  }
  return entry;
}

/**
 * Locator-map thumbnail data for a place page: the place highlighted among
 * its siblings (region within the country, province within its region,
 * citymun within its province). Barangays highlight their parent citymun,
 * since barangay boundaries aren't part of the boundary pipeline.
 *
 * Returns null whenever a locator can't be drawn — national level, missing
 * ancestors, or a geo with no source boundary (HUC pseudo-provinces, NCR
 * districts; see docs/BOUNDARY_RECONCILIATION.md) — so callers just omit
 * the thumbnail rather than render a broken one.
 */
export async function getPlaceLocator(
  geo: { geoCode: string; geoLevel: GeoLevel; geoName: string },
  ancestors: GeoAncestors,
): Promise<PlaceLocator | null> {
  let relPath: string;
  let highlightCode: string;
  let highlightName = geo.geoName;
  let highlightIsParent = false;

  switch (geo.geoLevel) {
    case "region":
      relPath = "regions.json";
      highlightCode = geo.geoCode;
      break;
    case "province":
      if (!ancestors.region) return null;
      relPath = `provinces/${ancestors.region.geoCode}.json`;
      highlightCode = geo.geoCode;
      break;
    case "citymun":
      if (!ancestors.province) return null;
      relPath = `citymun/${ancestors.province.geoCode}.json`;
      highlightCode = geo.geoCode;
      break;
    case "barangay":
      if (!ancestors.province || !ancestors.citymun) return null;
      relPath = `citymun/${ancestors.province.geoCode}.json`;
      highlightCode = ancestors.citymun.geoCode;
      highlightName = ancestors.citymun.geoName;
      highlightIsParent = true;
      break;
    default:
      return null;
  }

  const collection = await loadBoundaryFile(relPath);
  if (!collection) return null;

  const map = buildLocatorMap(collection, highlightCode);
  if (!map) return null;

  return { ...map, highlightName, highlightIsParent };
}
