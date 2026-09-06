/**
 * The facility point map's data, built from three things the city/municipality page already has:
 * its barangays (from `dim_geo`), its barangay centroids (from the boundary pipeline), and its
 * facility list (from `fact_nhfr_facility`).
 *
 * **One point per barangay, not one per facility.** The registry has no lat/long, so every
 * facility in a barangay would be drawn at the *same* coordinate — twelve identical dots claiming
 * twelve distinct locations, which is a claim the data cannot support and which no amount of
 * clustering makes true. So a point is a barangay, sized by how many facilities are registered
 * there, and the map's question becomes one the data can actually answer: **which barangays have
 * facilities, and which have none.**
 *
 * That is why barangays with **zero** facilities are plotted too. `agg_nhfr_counts` already puts
 * the coverage figure on the page ("28,490 of 41,958 barangays have at least one facility"); this
 * is the same figure with the empty ones in their actual places, which is the only thing a map
 * adds over the bar.
 *
 * Pure and dependency-free so it can be unit-tested directly (BUILD_PLAN.md §5 — the mappers are
 * where the correctness lives).
 */

/** One plotted barangay. */
export type BarangayPoint = {
  geoCode: string;
  geoName: string;
  nFacilities: number;
  lon: number;
  lat: number;
};

export type FacilityPointData = {
  /** Plotted barangays, most facilities first so the big circles are drawn under the small ones. */
  points: BarangayPoint[];
  /** Largest `nFacilities` among the points; 0 when every barangay is empty. */
  maxFacilities: number;
  /** Plotted barangays with at least one facility. */
  nBarangaysWithFacility: number;
  /** Plotted barangays with none — the finding this map exists to show. */
  nBarangaysWithoutFacility: number;
  /** Barangays of this city/municipality with no centroid in the boundary source. */
  nBarangaysNotPlaced: number;
  /**
   * Facilities the map does not account for, from `expectedFacilities` minus what the points add
   * up to. One number covering every way a facility can fall off this map — no barangay code in
   * the source (108 rows nationally), a barangay code that is not one of this area's, a barangay
   * with no centroid, or a facility list that hit its query bound — because to a reader they are
   * the same fact: the dots do not add up to the total, and by this much.
   */
  nFacilitiesNotPlaced: number;
};

type BarangayInput = { geoCode: string; geoName: string };
type FacilityInput = { barangayGeoCode: string | null };

/**
 * Builds the point layer for one city/municipality.
 *
 * `expectedFacilities` is the area's authoritative count from `agg_nhfr_counts`, not
 * `facilities.length` — the two differ exactly when something is missing, and that difference is
 * the number worth printing.
 */
export function buildFacilityPoints({
  barangays,
  centroids,
  facilities,
  expectedFacilities,
}: {
  barangays: BarangayInput[];
  centroids: Map<string, [number, number]>;
  facilities: FacilityInput[];
  expectedFacilities: number;
}): FacilityPointData {
  const countByBarangay = new Map<string, number>();
  for (const facility of facilities) {
    if (!facility.barangayGeoCode) continue;
    countByBarangay.set(
      facility.barangayGeoCode,
      (countByBarangay.get(facility.barangayGeoCode) ?? 0) + 1,
    );
  }

  const points: BarangayPoint[] = [];
  let nBarangaysNotPlaced = 0;
  for (const barangay of barangays) {
    const centroid = centroids.get(barangay.geoCode);
    if (!centroid) {
      nBarangaysNotPlaced += 1;
      continue;
    }
    points.push({
      geoCode: barangay.geoCode,
      geoName: barangay.geoName,
      nFacilities: countByBarangay.get(barangay.geoCode) ?? 0,
      lon: centroid[0],
      lat: centroid[1],
    });
  }

  // Descending, so the largest circles paint first and the small ones stay clickable on top of
  // them. Ties keep a stable, name-independent order via the code.
  points.sort((a, b) => b.nFacilities - a.nFacilities || a.geoCode.localeCompare(b.geoCode));

  const nFacilitiesPlaced = points.reduce((sum, p) => sum + p.nFacilities, 0);
  const withFacility = points.filter((p) => p.nFacilities > 0).length;

  return {
    points,
    maxFacilities: points.length > 0 ? points[0].nFacilities : 0,
    nBarangaysWithFacility: withFacility,
    nBarangaysWithoutFacility: points.length - withFacility,
    nBarangaysNotPlaced,
    // Clamped at 0: a negative shortfall would mean the points outnumber the aggregate, which is
    // a data bug rather than something to render as "-3 facilities not shown".
    nFacilitiesNotPlaced: Math.max(0, expectedFacilities - nFacilitiesPlaced),
  };
}

/**
 * Circle radius in px for a barangay with `n` facilities, given the area's largest count.
 *
 * Area-proportional (radius ∝ √n), which is the encoding that does not exaggerate — a barangay
 * with four facilities gets four times the ink of one with one, not sixteen times. Empty
 * barangays get a fixed small dot: they are a category, not a zero on the same scale, and they
 * render hollow so "none here" never reads as "a very small number here".
 */
export const EMPTY_POINT_RADIUS = 2.5;
const MIN_RADIUS = 4;
const MAX_RADIUS = 16;

export function pointRadius(n: number, max: number): number {
  if (n <= 0) return EMPTY_POINT_RADIUS;
  if (max <= 1) return MIN_RADIUS;
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt((n - 1) / (max - 1));
}
