import { describe, expect, it } from "vitest";
import {
  buildFacilityPoints,
  pointRadius,
  EMPTY_POINT_RADIUS,
  type BarangayPoint,
} from "./facility-points";

const barangays = [
  { geoCode: "0102801001", geoName: "Adams" },
  { geoCode: "0102801002", geoName: "Bagong Bayan" },
  { geoCode: "0102801003", geoName: "Calanaan" },
];

const centroids = new Map<string, [number, number]>([
  ["0102801001", [120.9, 18.45]],
  ["0102801002", [120.91, 18.46]],
  ["0102801003", [120.92, 18.47]],
]);

const codesOf = (points: BarangayPoint[]) => points.map((p) => p.geoCode);

describe("buildFacilityPoints", () => {
  it("counts facilities into their barangay's single point", () => {
    const data = buildFacilityPoints({
      barangays,
      centroids,
      facilities: [
        { barangayGeoCode: "0102801001" },
        { barangayGeoCode: "0102801001" },
        { barangayGeoCode: "0102801002" },
      ],
      expectedFacilities: 3,
    });

    expect(data.points).toHaveLength(3);
    expect(data.points.map((p) => p.nFacilities)).toEqual([2, 1, 0]);
    expect(data.maxFacilities).toBe(2);
    expect(data.nFacilitiesNotPlaced).toBe(0);
  });

  it("plots barangays with no facility, and counts them", () => {
    const data = buildFacilityPoints({
      barangays,
      centroids,
      facilities: [{ barangayGeoCode: "0102801001" }],
      expectedFacilities: 1,
    });

    expect(data.points).toHaveLength(3);
    expect(data.nBarangaysWithFacility).toBe(1);
    expect(data.nBarangaysWithoutFacility).toBe(2);
    // The empty ones are the finding, so they carry a real point rather than being filtered out.
    expect(codesOf(data.points)).toContain("0102801003");
  });

  it("drops barangays with no centroid and reports how many", () => {
    const data = buildFacilityPoints({
      barangays,
      centroids: new Map([["0102801001", [120.9, 18.45]]]),
      facilities: [{ barangayGeoCode: "0102801001" }, { barangayGeoCode: "0102801002" }],
      expectedFacilities: 2,
    });

    expect(codesOf(data.points)).toEqual(["0102801001"]);
    expect(data.nBarangaysNotPlaced).toBe(2);
    // The facility in the unplaceable barangay is not on the map, and says so.
    expect(data.nFacilitiesNotPlaced).toBe(1);
  });

  it("counts a facility with no barangay code as unplaced, never as an extra dot", () => {
    const data = buildFacilityPoints({
      barangays,
      centroids,
      facilities: [{ barangayGeoCode: null }, { barangayGeoCode: "0102801001" }],
      expectedFacilities: 2,
    });

    expect(data.points).toHaveLength(3);
    expect(data.points.reduce((sum, p) => sum + p.nFacilities, 0)).toBe(1);
    expect(data.nFacilitiesNotPlaced).toBe(1);
  });

  it("counts a facility in another area's barangay as unplaced", () => {
    const data = buildFacilityPoints({
      barangays,
      centroids,
      facilities: [{ barangayGeoCode: "9999999999" }],
      expectedFacilities: 1,
    });

    expect(data.points.every((p) => p.nFacilities === 0)).toBe(true);
    expect(data.nFacilitiesNotPlaced).toBe(1);
  });

  it("reports a truncated facility list as a shortfall against the aggregate", () => {
    // `expectedFacilities` is the authoritative count from agg_nhfr_counts; the list is bounded.
    const data = buildFacilityPoints({
      barangays,
      centroids,
      facilities: [{ barangayGeoCode: "0102801001" }],
      expectedFacilities: 40,
    });

    expect(data.nFacilitiesNotPlaced).toBe(39);
  });

  it("never reports a negative shortfall", () => {
    const data = buildFacilityPoints({
      barangays,
      centroids,
      facilities: [{ barangayGeoCode: "0102801001" }, { barangayGeoCode: "0102801002" }],
      expectedFacilities: 1,
    });

    expect(data.nFacilitiesNotPlaced).toBe(0);
  });

  it("orders points by facility count so small circles stay on top", () => {
    const data = buildFacilityPoints({
      barangays,
      centroids,
      facilities: [
        { barangayGeoCode: "0102801003" },
        { barangayGeoCode: "0102801003" },
        { barangayGeoCode: "0102801003" },
        { barangayGeoCode: "0102801002" },
      ],
      expectedFacilities: 4,
    });

    expect(codesOf(data.points)).toEqual(["0102801003", "0102801002", "0102801001"]);
  });

  it("handles a city/municipality with no facilities at all", () => {
    const data = buildFacilityPoints({
      barangays,
      centroids,
      facilities: [],
      expectedFacilities: 0,
    });

    expect(data.maxFacilities).toBe(0);
    expect(data.nBarangaysWithoutFacility).toBe(3);
    expect(data.nFacilitiesNotPlaced).toBe(0);
  });
});

describe("pointRadius", () => {
  it("gives empty barangays the fixed small dot, not a zero-radius one", () => {
    expect(pointRadius(0, 10)).toBe(EMPTY_POINT_RADIUS);
    expect(pointRadius(0, 0)).toBe(EMPTY_POINT_RADIUS);
  });

  it("scales with the square root of the count, so ink tracks the number", () => {
    const max = 17;
    const r1 = pointRadius(1, max);
    const r5 = pointRadius(5, max);
    const r17 = pointRadius(17, max);
    // Area above the floor is proportional to (n - 1): quadrupling that quadruples the area,
    // which doubles the radius above the floor.
    expect((r5 - r1) * 2).toBeCloseTo(r17 - r1, 6);
    expect(r1).toBeLessThan(r5);
    expect(r5).toBeLessThan(r17);
  });

  it("does not divide by zero when every barangay has the same single facility", () => {
    expect(Number.isFinite(pointRadius(1, 1))).toBe(true);
    expect(pointRadius(1, 1)).toBeGreaterThan(EMPTY_POINT_RADIUS);
  });
});
