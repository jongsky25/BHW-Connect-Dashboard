import { describe, expect, it } from "vitest";
import { getPlaceLocator } from "./locator";
import type { GeoAncestors } from "@/lib/db/geo";

// Exercises getPlaceLocator against the real public/geo/* files committed by
// ingestion/reconcile_boundaries.py — pinning the contract between the
// boundary pipeline (file layout, geo_code properties) and the locator.
// Runs from the repo root (vitest's cwd), same as the Next.js server.

const ancestors = (over: Partial<GeoAncestors>): GeoAncestors => ({
  region: null,
  province: null,
  citymun: null,
  ...over,
});

const geo = (geoCode: string, geoLevel: "region" | "province" | "citymun" | "barangay") => ({
  geoCode,
  geoLevel,
  geoName: geoCode,
});

const region03 = {
  geoCode: "03",
  geoLevel: "region" as const,
  geoName: "Central Luzon",
  incomeClass: null,
};
const pampanga = {
  geoCode: "03054",
  geoLevel: "province" as const,
  geoName: "Pampanga",
  incomeClass: null,
};
const apalit = {
  geoCode: "0305402",
  geoLevel: "citymun" as const,
  geoName: "Apalit",
  incomeClass: null,
};

const region17 = {
  geoCode: "17",
  geoLevel: "region" as const,
  geoName: "MIMAROPA",
  incomeClass: null,
};
const palawan = {
  geoCode: "17053",
  geoLevel: "province" as const,
  geoName: "Palawan",
  incomeClass: null,
};
const aborlan = {
  geoCode: "1705301",
  geoLevel: "citymun" as const,
  geoName: "Aborlan",
  incomeClass: null,
};

describe("getPlaceLocator (real public/geo files)", () => {
  it("renders a region within the country", async () => {
    const locator = await getPlaceLocator(geo("01", "region"), ancestors({}));
    expect(locator).not.toBeNull();
    expect(locator!.highlightPath).not.toBe("");
    expect(locator!.contextPath.length).toBeGreaterThan(1000); // whole-archipelago context
    expect(locator!.highlightIsParent).toBe(false);
  });

  it("renders NIR (region 18), reconstructed into the national file from its provinces", async () => {
    const locator = await getPlaceLocator(geo("18", "region"), ancestors({}));
    expect(locator).not.toBeNull();
    expect(locator!.highlightPath).not.toBe("");
    expect(locator!.highlightIsParent).toBe(false);
  });

  it("renders a province within its region", async () => {
    const locator = await getPlaceLocator(
      geo("03054", "province"),
      ancestors({ region: region03 }),
    );
    expect(locator).not.toBeNull();
    expect(locator!.highlightPath).not.toBe("");
  });

  it("returns null for an HUC pseudo-province with no source boundary", async () => {
    expect(
      await getPlaceLocator(geo("03301", "province"), ancestors({ region: region03 })),
    ).toBeNull();
  });

  it("renders a citymun within its province", async () => {
    const locator = await getPlaceLocator(
      geo("0305402", "citymun"),
      ancestors({ region: region03, province: pampanga }),
    );
    expect(locator).not.toBeNull();
    expect(locator!.highlightPath).not.toBe("");
  });

  it("highlights the parent citymun for a barangay", async () => {
    const locator = await getPlaceLocator(
      geo("030540201", "barangay"),
      ancestors({ region: region03, province: pampanga, citymun: apalit }),
    );
    expect(locator).not.toBeNull();
    expect(locator!.highlightIsParent).toBe(true);
    expect(locator!.highlightName).toBe("Apalit");
  });

  it("renders a citymun whose province file contains a null-geometry sibling (Palawan, #60)", async () => {
    // public/geo/citymun/17053.json ships the Kalayaan citymun (1705321) with a
    // null geometry. Before the fix this crashed every citymun/barangay page
    // under Palawan (and 4 other provinces) with "Cannot read properties of
    // null (reading 'type')". A normal sibling must still render its locator.
    const locator = await getPlaceLocator(
      geo("1705301", "citymun"), // Aborlan
      ancestors({ region: region17, province: palawan }),
    );
    expect(locator).not.toBeNull();
    expect(locator!.highlightPath).not.toBe("");
  });

  it("returns null (not a crash) for the null-geometry citymun's own page (Kalayaan, #60)", async () => {
    const locator = await getPlaceLocator(
      geo("1705321", "citymun"),
      ancestors({ region: region17, province: palawan }),
    );
    expect(locator).toBeNull();
  });

  it("renders a barangay under a null-geometry province file without crashing (#60)", async () => {
    // Barangay pages highlight their parent citymun from the same province file.
    const locator = await getPlaceLocator(
      geo("170530100", "barangay"),
      ancestors({ region: region17, province: palawan, citymun: aborlan }),
    );
    expect(locator).not.toBeNull();
    expect(locator!.highlightIsParent).toBe(true);
  });

  it("skips the national level", async () => {
    expect(await getPlaceLocator(geo("PH", "national" as never), ancestors({}))).toBeNull();
  });

  it("keeps the inline payload thumbnail-sized even for the whole country", async () => {
    const locator = await getPlaceLocator(geo("01", "region"), ancestors({}));
    expect(locator!.contextPath.length + locator!.highlightPath.length).toBeLessThan(60_000);
  });
});
