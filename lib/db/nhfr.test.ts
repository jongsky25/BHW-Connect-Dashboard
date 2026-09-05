import { describe, expect, it } from "vitest";
import {
  licensingLabel,
  nhfrAreaHref,
  nhfrCaption,
  nhfrContextSentence,
  toNhfrCounts,
  type Row,
} from "./nhfr";

/**
 * National: the September 2026 snapshot's 44,799 facilities across 28,490 of 41,958 barangays.
 *
 * 28,490, not the 28,511 distinct barangay codes the export prints: 21 Sulu barangays appear
 * under both code vintages and resolve to one barangay each.
 */
const national: Row = {
  geo_code: "PH",
  geo_level: "national",
  n_facilities: 44799,
  n_government: 33524,
  n_private: 11275,
  n_barangay_health_station: 27186,
  n_rural_health_unit: 2745,
  n_hospital: 1358,
  n_birthing_home: 3565,
  total_bed_capacity: 120000,
  n_barangays_with_facility: 28490,
  n_barangays: 41958,
};

/** A city/municipality where every barangay has a facility. */
const fullyCovered: Row = {
  geo_code: "1402706",
  geo_level: "citymun",
  n_facilities: 30,
  n_government: 28,
  n_private: 2,
  n_barangay_health_station: 27,
  n_rural_health_unit: 1,
  n_hospital: 1,
  n_birthing_home: 1,
  total_bed_capacity: 25,
  n_barangays_with_facility: 27,
  n_barangays: 27,
};

/** A real row reading zero — an area with no facilities at all, not a missing row. */
const noneHere: Row = {
  ...fullyCovered,
  geo_code: "0102801",
  n_facilities: 0,
  n_government: 0,
  n_private: 0,
  n_barangay_health_station: 0,
  n_rural_health_unit: 0,
  n_hospital: 0,
  n_birthing_home: 0,
  total_bed_capacity: 0,
  n_barangays_with_facility: 0,
  n_barangays: 12,
};

describe("toNhfrCounts", () => {
  it("derives barangay coverage against the dim_geo denominator", () => {
    const c = toNhfrCounts(national);
    expect(c.nFacilities).toBe(44799);
    expect(c.nBarangaysWithFacility).toBe(28490);
    expect(c.nBarangays).toBe(41958);
    expect(c.coveragePct).toBe(68);
    expect(c.coverageFraction).toBeCloseTo(28490 / 41958);
  });

  it("reports full coverage without exceeding the bar", () => {
    const c = toNhfrCounts(fullyCovered);
    expect(c.coveragePct).toBe(100);
    expect(c.coverageFraction).toBe(1);
  });

  it("treats an area with no facilities as a real zero, not a gap", () => {
    const c = toNhfrCounts(noneHere);
    expect(c.nFacilities).toBe(0);
    expect(c.coveragePct).toBe(0);
    expect(c.coverageFraction).toBe(0);
  });

  it("returns a null share rather than dividing by a zero denominator", () => {
    const c = toNhfrCounts({ ...noneHere, n_barangays: 0 });
    expect(c.coveragePct).toBeNull();
    expect(c.coverageFraction).toBe(0);
  });

  it("clamps coverage that would overflow its track", () => {
    // Impossible by construction, but a bar that can overflow is worth making impossible.
    const c = toNhfrCounts({ ...fullyCovered, n_barangays_with_facility: 30, n_barangays: 27 });
    expect(c.coverageFraction).toBe(1);
  });

  it("carries the ownership split through unchanged", () => {
    const c = toNhfrCounts(national);
    expect(c.nGovernment + c.nPrivate).toBe(c.nFacilities);
  });
});

describe("nhfrAreaHref", () => {
  it("sends national to the section landing page", () => {
    expect(nhfrAreaHref("national", "PH")).toBe("/facilities");
  });

  it("builds the per-area route for every other level", () => {
    expect(nhfrAreaHref("region", "07")).toBe("/facilities/region/07");
    expect(nhfrAreaHref("citymun", "1402706")).toBe("/facilities/citymun/1402706");
  });
});

describe("licensingLabel", () => {
  it("never renders a blank status as unlicensed", () => {
    // 28,247 of 44,799 facilities have no status, overwhelmingly Barangay Health Stations, which
    // are not a licensed facility type. Blank means not stated.
    expect(licensingLabel(null)).toBe("Licence status not stated");
    expect(licensingLabel(null)).not.toMatch(/unlicensed/i);
  });

  it("renders the two stated values", () => {
    expect(licensingLabel("With License")).toBe("Licensed");
    expect(licensingLabel("Without License")).toBe("No current licence recorded");
  });
});

describe("nhfrCaption", () => {
  it("quotes the area's own N, not the national total", () => {
    expect(nhfrCaption(toNhfrCounts(fullyCovered), "Mayoyao, Ifugao")).toBe(
      "N = 30 health facilities · Mayoyao, Ifugao · NHFR, September 2026",
    );
  });

  it("degrades to a dash rather than a wrong number when the read failed", () => {
    expect(nhfrCaption(null, "Mayoyao, Ifugao")).toContain("N = —");
  });
});

describe("nhfrContextSentence", () => {
  it("says nothing when there is nothing to say", () => {
    expect(nhfrContextSentence(null)).toBeNull();
  });

  it("names facilities and barangays as its own universe", () => {
    const s = nhfrContextSentence(toNhfrCounts(fullyCovered));
    expect(s).toBe(
      "30 health facilities are on the DOH registry here, across 27 of this area's 27 barangays (NHFR, September 2026)",
    );
  });

  it("renders a zero positively rather than vanishing", () => {
    // A chip that disappeared at zero would be indistinguishable from one that failed to load.
    expect(nhfrContextSentence(toNhfrCounts(noneHere))).toBe(
      "No health facilities are on the DOH registry for this area (NHFR, September 2026)",
    );
  });

  it("agrees in number for a single facility", () => {
    const one = toNhfrCounts({ ...fullyCovered, n_facilities: 1, n_barangays_with_facility: 1 });
    expect(nhfrContextSentence(one)).toMatch(/^1 health facility is /);
  });
});
