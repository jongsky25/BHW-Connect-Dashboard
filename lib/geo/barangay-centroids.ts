import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Barangay centroids, read from the province files
 * `public/geo/barangay-centroids/<province geo_code>.json` that
 * `ingestion/build_barangay_centroids.py` writes.
 *
 * **These are barangay locations, not facility locations.** The NHFR export carries no lat/long,
 * only PSGC codes, so the only point the facility map can honestly draw is the barangay a
 * facility is registered in — see `docs/BARANGAY_CENTROID_RECONCILIATION.md`.
 *
 * The files are keyed by the full 10-digit barangay `geo_code` and hold `[lon, lat]` — no
 * GeoJSON envelope, because nothing fetches them from the browser: the server joins them to
 * facility counts and hands the map a small, already-joined array. That keeps the whole set to
 * ~1.5 MB instead of the ~6 MB the Feature wrapper would cost, and keeps the map's payload
 * proportional to the one city/municipality on screen rather than to its province.
 */
export type Centroid = [lon: number, lat: number];

/** `{ "<barangay geo_code>": [lon, lat] }` — the committed file's shape, exactly. */
type CentroidFile = Record<string, Centroid>;

const CENTROID_DIR = path.join(process.cwd(), "public", "geo", "barangay-centroids");

// Centroid files are immutable per deploy, so parses are cached for the lifetime of the server
// process. Failures cache as an empty map so a province with no file (the whole set is a build
// artefact that may legitimately not have been generated yet) isn't re-stat'd on every render.
// `lib/geo/locator.ts`'s `fileCache` precedent.
const fileCache = new Map<string, Promise<CentroidFile>>();

function loadProvinceFile(provinceCode: string): Promise<CentroidFile> {
  let entry = fileCache.get(provinceCode);
  if (!entry) {
    entry = readFile(path.join(CENTROID_DIR, `${provinceCode}.json`), "utf8")
      .then((raw) => JSON.parse(raw) as CentroidFile)
      .catch(() => ({}));
    fileCache.set(provinceCode, entry);
  }
  return entry;
}

/**
 * Centroids for every barangay of one province, keyed by barangay `geo_code`.
 *
 * Returns an empty map — never throws, never null — when the province has no file. A caller with
 * no centroids renders no map and says so; it never renders a map with silently missing dots.
 */
export async function getProvinceBarangayCentroids(
  provinceCode: string,
): Promise<Map<string, Centroid>> {
  const file = await loadProvinceFile(provinceCode);
  return new Map(Object.entries(file));
}
