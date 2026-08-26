import { describe, expect, it } from "vitest";
import { toUucPhcCounts, type Row } from "./uuc-phc";

/** National: 5,991 of the country's 41,958 barangays are on the 2025 list. */
const national: Row = {
  geo_code: "PH",
  geo_level: "national",
  n_listed: 5991,
  n_barangays: 41958,
};

/** MAYOYAO, Ifugao (1402706) — every one of its 27 barangays is on the list. */
const mayoyao: Row = {
  geo_code: "1402706",
  geo_level: "citymun",
  n_listed: 27,
  n_barangays: 27,
};

/** A city with barangays but none listed — a real row reading zero, not a missing row. */
const noneListed: Row = {
  geo_code: "1380601",
  geo_level: "citymun",
  n_listed: 0,
  n_barangays: 39,
};

describe("toUucPhcCounts", () => {
  it("derives the share from the dim_geo barangay denominator", () => {
    const c = toUucPhcCounts(national);
    expect(c.nListed).toBe(5991);
    expect(c.nBarangays).toBe(41958);
    // 5,991 / 41,958 = 14.28% → 14
    expect(c.sharePct).toBe(14);
    expect(c.fraction).toBeCloseTo(0.1428, 4);
  });

  it("reads a fully-listed area as 100%, filling the bar exactly once", () => {
    const c = toUucPhcCounts(mayoyao);
    expect(c.sharePct).toBe(100);
    expect(c.fraction).toBe(1);
  });

  it("distinguishes 'none listed' from 'no data': zero is a real share", () => {
    const c = toUucPhcCounts(noneListed);
    expect(c.nListed).toBe(0);
    expect(c.nBarangays).toBe(39);
    // Not null — the area was covered and none of its barangays are on the list.
    expect(c.sharePct).toBe(0);
    expect(c.fraction).toBe(0);
  });

  it("returns a null share, not a division by zero, when the area has no barangays", () => {
    const c = toUucPhcCounts({
      geo_code: "9999999",
      geo_level: "citymun",
      n_listed: 0,
      n_barangays: 0,
    });
    expect(c.sharePct).toBeNull();
    expect(c.fraction).toBe(0);
  });

  it("clamps the bar fraction at 1 even on impossible input", () => {
    // n_listed > n_barangays cannot happen (a listed barangay is one of the area's own, and the
    // load verifies it), but the bar must not overflow its track if the data ever says otherwise.
    const c = toUucPhcCounts({
      geo_code: "0000000",
      geo_level: "citymun",
      n_listed: 5,
      n_barangays: 3,
    });
    expect(c.fraction).toBe(1);
    expect(c.sharePct).toBe(167);
  });

  it("carries the geo identity through unchanged", () => {
    const c = toUucPhcCounts(mayoyao);
    expect(c.geoCode).toBe("1402706");
    expect(c.geoLevel).toBe("citymun");
  });
});
