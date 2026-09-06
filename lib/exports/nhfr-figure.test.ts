import { describe, expect, it } from "vitest";
import { toNhfrCounts, type NhfrChild, type NhfrFacility, type NhfrTypeCount, type Row } from "@/lib/db/nhfr";
import { composeNhfrFigureSvg, wrapNames, type NhfrFigureInput } from "./nhfr-figure";

/**
 * SVG does not wrap text: a line longer than the canvas runs off the edge silently, with no error
 * and no clipping to notice. The one-pager names a city's facilities this way, so this packing is
 * what keeps a large city on the page (uuc-phc-figure.test.ts's precedent).
 */
describe("wrapNames", () => {
  it("packs names onto as few lines as fit", () => {
    expect(wrapNames(["AAA", "BBB", "CCC"], 20)).toEqual(["AAA, BBB, CCC"]);
  });

  it("breaks to a new line rather than exceeding the width", () => {
    const lines = wrapNames(["AAAAA", "BBBBB", "CCCCC"], 13);
    expect(lines).toEqual(["AAAAA, BBBBB", "CCCCC"]);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(13);
  });

  it("keeps a name that is itself too long rather than dropping it", () => {
    const lines = wrapNames(["SHORT", "AN-EXTREMELY-LONG-FACILITY-NAME"], 10);
    expect(lines).toEqual(["SHORT", "AN-EXTREMELY-LONG-FACILITY-NAME"]);
  });

  it("returns nothing for no names", () => {
    expect(wrapNames([], 40)).toEqual([]);
  });

  it("never loses a name", () => {
    const names = Array.from({ length: 37 }, (_, i) => `FACILITY-${i}`);
    const rejoined = wrapNames(names, 45).join(", ").split(", ");
    expect(rejoined).toEqual(names);
  });
});

const nationalRow: Row = {
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

const citymunRow: Row = {
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

const zeroRow: Row = {
  ...citymunRow,
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

const NATIONAL_TYPES: NhfrTypeCount[] = [
  { facilityType: "Barangay Health Station", nFacilities: 27186, nGovernment: 27150, nPrivate: 36 },
  { facilityType: "Clinical Laboratory", nFacilities: 4349, nGovernment: 200, nPrivate: 4149 },
];

function baseInput(overrides: Partial<NhfrFigureInput> = {}): NhfrFigureInput {
  return {
    geoName: "Philippines",
    geoLevel: "national",
    generated: "2026-09-06",
    counts: toNhfrCounts(nationalRow),
    children: [],
    types: NATIONAL_TYPES,
    facilities: [],
    ...overrides,
  };
}

function facility(overrides: Partial<NhfrFacility> = {}): NhfrFacility {
  return {
    facilityCode: "DOH0000000000000001",
    facilityName: "Sample Hospital",
    facilityType: "Hospital",
    ownershipMajor: "Government",
    ownershipSub: null,
    barangayName: "Poblacion",
    bedCapacity: 25,
    licensingStatus: null,
    ...overrides,
  };
}

describe("composeNhfrFigureSvg", () => {
  it("never renders licensing as a compliance figure", () => {
    // Neither aggregate table carries a licensing column, so the sheet must never compute or
    // imply a "% licensed" figure — the same rule FacilityStats' docblock states for the page.
    // It does explain the rule in prose (hence "unlicensed" appears once, negated, in the
    // footer), but never as a computed number or percentage.
    const { svg } = composeNhfrFigureSvg(baseInput());
    expect(svg).not.toMatch(/%\s*licen[cs]ed/i);
    expect(svg).not.toMatch(/licen[cs]ed[^a-z]{0,10}[\d,]+/i);
    expect(svg).toMatch(/never means unlicensed/i);
  });

  it("states the omitted count and its facility total when the type table is capped", () => {
    const types: NhfrTypeCount[] = Array.from({ length: 25 }, (_, i) => ({
      facilityType: `Type ${i}`,
      nFacilities: 100 - i,
      nGovernment: 60,
      nPrivate: 40 - i,
    }));
    const { svg } = composeNhfrFigureSvg(baseInput({ types }));
    expect(svg).toMatch(/\+ 5 more types, [\d,]+ facilities between them\./);
  });

  it("orders the child table least-covered first, matching ChildBreakdown on screen", () => {
    const children: NhfrChild[] = [
      { ...toNhfrCounts(citymunRow), geoName: "High coverage", geoCode: "A", coveragePct: 90 },
      { ...toNhfrCounts(citymunRow), geoName: "Low coverage", geoCode: "B", coveragePct: 10 },
      { ...toNhfrCounts(citymunRow), geoName: "No denominator", geoCode: "C", coveragePct: null },
    ];
    const { svg } = composeNhfrFigureSvg(
      baseInput({ geoLevel: "region", children }),
    );
    const lowIdx = svg.indexOf("Low coverage");
    const highIdx = svg.indexOf("High coverage");
    const noneIdx = svg.indexOf("No denominator");
    expect(lowIdx).toBeGreaterThan(0);
    expect(lowIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(noneIdx);
  });

  it("treats an area with no facilities as a real zero, not missing data", () => {
    const { svg } = composeNhfrFigureSvg(
      baseInput({ geoName: "Nowhereville", counts: toNhfrCounts(zeroRow), types: [] }),
    );
    expect(svg).toContain(
      "No health facility in Nowhereville is on the DOH registry for this snapshot.",
    );
    expect(svg).not.toContain("NaN");
  });

  it("renders a null coverage share as a dash rather than dividing by a zero denominator", () => {
    const { svg } = composeNhfrFigureSvg(
      baseInput({ counts: toNhfrCounts({ ...zeroRow, n_barangays: 0 }) }),
    );
    expect(svg).toContain("No barangays recorded for this area.");
    expect(svg).not.toContain("NaN");
  });

  it("escapes a facility name and type that carry XML-significant characters", () => {
    const { svg } = composeNhfrFigureSvg(
      baseInput({
        geoLevel: "citymun",
        counts: toNhfrCounts(citymunRow),
        facilities: [facility({ facilityName: "Mother & Child Clinic", facilityType: "RHU <II>" })],
      }),
    );
    expect(svg).toContain("Mother &amp; Child Clinic");
    expect(svg).toContain("RHU &lt;II&gt;");
    expect(svg).not.toContain("Mother & Child Clinic (RHU <II>)");
  });

  it("names facilities other than barangay health stations, and states the station count", () => {
    const facilities = [
      facility({ facilityCode: "1", facilityName: "City Hospital", facilityType: "Hospital" }),
      facility({ facilityCode: "2", facilityName: "BHS Uno", facilityType: "Barangay Health Station" }),
      facility({ facilityCode: "3", facilityName: "BHS Dos", facilityType: "Barangay Health Station" }),
    ];
    const { svg } = composeNhfrFigureSvg(
      baseInput({ geoLevel: "citymun", counts: toNhfrCounts(citymunRow), facilities }),
    );
    expect(svg).toContain("City Hospital (Hospital)");
    expect(svg).not.toContain("BHS Uno");
    expect(svg).toContain("2 barangay health stations are not named individually above");
  });

  it("returns a stable filename built from the area name", () => {
    const { filenameParts } = composeNhfrFigureSvg(baseInput({ geoName: "Mayoyao" }));
    expect(filenameParts).toEqual(["Mayoyao", "health-facilities-2026-09"]);
  });
});
