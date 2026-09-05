import { describe, expect, it } from "vitest";
import { MAX_DECK_SLIDES, parseExportDeckQuery, parseExportQuery, slugify } from "./query";

const url = (qs: string) => `http://localhost/api/export/pptx?${qs}`;

describe("parseExportDeckQuery", () => {
  /** Every existing export link uses `indicator=`; the deck parameter must not break them. */
  it("reads a single `indicator` as a one-slide deck", () => {
    const parsed = parseExportDeckQuery(
      url("geoCode=PH&geoLevel=national&indicator=accreditation"),
    );
    expect(parsed.success && parsed.data.indicators).toEqual(["accreditation"]);
  });

  it("reads a comma-separated `indicators` list", () => {
    const parsed = parseExportDeckQuery(
      url("geoCode=PH&geoLevel=national&indicators=accreditation,training,honorarium"),
    );
    expect(parsed.success && parsed.data.indicators).toEqual([
      "accreditation",
      "training",
      "honorarium",
    ]);
  });

  it("de-duplicates and ignores blank entries", () => {
    const parsed = parseExportDeckQuery(
      url("geoCode=PH&geoLevel=national&indicators=training,,training,accreditation"),
    );
    expect(parsed.success && parsed.data.indicators).toEqual(["training", "accreditation"]);
  });

  // The cap is a timeout budget: every slide rasterises its own PNG on the request path.
  it("refuses more slides than the render budget allows", () => {
    const many = Array.from({ length: MAX_DECK_SLIDES + 1 }, (_, i) => `x${i}`).join(",");
    expect(
      parseExportDeckQuery(url(`geoCode=PH&geoLevel=national&indicators=${many}`)).success,
    ).toBe(false);
  });

  it("refuses an indicator that is not in the enum", () => {
    expect(
      parseExportDeckQuery(url("geoCode=PH&geoLevel=national&indicators=accreditation,drop-table"))
        .success,
    ).toBe(false);
  });

  it("refuses a request with no indicator at all", () => {
    expect(parseExportDeckQuery(url("geoCode=PH&geoLevel=national")).success).toBe(false);
  });

  it("leaves the single-figure parser untouched", () => {
    const parsed = parseExportQuery(url("geoCode=PH&geoLevel=national&indicator=training"));
    expect(parsed.success && parsed.data.indicator).toBe("training");
  });
});

/** D3.3 — a `districtCode` request never carries geoCode/geoLevel and is limited to the 3
 * indicators `agg_bhw_by_district` actually has. */
describe("district export requests (D3.3)", () => {
  it("parses a single-figure district request", () => {
    const parsed = parseExportQuery(url("districtCode=leyte-1&indicator=accreditation"));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("district");
      expect(parsed.data).toMatchObject({ districtCode: "leyte-1", indicator: "accreditation" });
    }
  });

  it("refuses an indicator outside the district figure set, even though it's a valid place indicator", () => {
    expect(parseExportQuery(url("districtCode=leyte-1&indicator=training")).success).toBe(false);
  });

  it("refuses a district request missing an indicator", () => {
    expect(parseExportQuery(url("districtCode=leyte-1")).success).toBe(false);
  });

  it("parses a district deck request", () => {
    const parsed = parseExportDeckQuery(
      url("districtCode=leyte-1&indicators=accreditation,service_years,honorarium"),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === "district") {
      expect(parsed.data.districtCode).toBe("leyte-1");
      expect(parsed.data.indicators).toEqual(["accreditation", "service_years", "honorarium"]);
    }
  });

  it("never mixes districtCode with geoCode/geoLevel — presence of districtCode always selects the district schema", () => {
    const parsed = parseExportQuery(
      url("districtCode=leyte-1&indicator=accreditation&geoCode=PH&geoLevel=national"),
    );
    expect(parsed.success && parsed.data.kind).toBe("district");
    expect(parsed.success && "geoCode" in parsed.data).toBe(false);
  });
});

describe("slugify", () => {
  it("makes a filename-safe slug", () => {
    expect(slugify("% Accredited", "Zamboanga del Sur")).toBe("accredited-zamboanga-del-sur");
  });
});
