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

describe("slugify", () => {
  it("makes a filename-safe slug", () => {
    expect(slugify("% Accredited", "Zamboanga del Sur")).toBe("accredited-zamboanga-del-sur");
  });
});
