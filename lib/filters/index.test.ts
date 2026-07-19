import { describe, expect, it } from "vitest";
import { loadFilterState, serializeFilterState } from "./codec";
import { NATIONAL_GEO_CODE } from "./schema";

describe("filter codec", () => {
  it("round-trips a full filter state through URL <-> state", () => {
    const original = {
      geoLevel: "province" as const,
      geoCode: "050400000",
      indicator: "training" as const,
      compareGeos: ["050400000", "137400000"],
      breakdowns: ["sex" as const, "age_band" as const],
    };

    const url = serializeFilterState("/explore", original);
    const params = new URL(url, "http://localhost").searchParams;
    const parsed = loadFilterState(params);

    expect(parsed).toEqual(original);

    // Second pass: re-serializing the parsed state reproduces an equivalent URL.
    const roundTripUrl = serializeFilterState("/explore", parsed);
    const roundTripParams = new URL(roundTripUrl, "http://localhost").searchParams;
    expect(loadFilterState(roundTripParams)).toEqual(original);
  });

  it("round-trips the default (national) state with no params", () => {
    const parsed = loadFilterState(new URLSearchParams());
    expect(parsed.geoLevel).toBe("national");
    expect(parsed.geoCode).toBe(NATIONAL_GEO_CODE);
    expect(parsed.indicator).toBeNull();
    expect(parsed.compareGeos).toBeNull();
    expect(parsed.breakdowns).toBeNull();
  });

  it("falls back to the national view for an invalid geoLevel, never throwing", () => {
    const parsed = loadFilterState(new URLSearchParams("geoLevel=not-a-real-level&geoCode=123"));
    expect(parsed.geoLevel).toBe("national");
    // geoCode itself is just a string at the codec layer (existence is checked against
    // the DB by lib/db, not here), so a syntactically valid value passes through.
    expect(parsed.geoCode).toBe("123");
  });

  it("falls back for an invalid indicator instead of crashing", () => {
    const parsed = loadFilterState(new URLSearchParams("indicator=not-a-real-indicator"));
    expect(parsed.indicator).toBeNull();
  });

  it("falls back for an invalid breakdown entry within an otherwise valid array", () => {
    const parsed = loadFilterState(new URLSearchParams("breakdowns=sex,not-a-real-dimension"));
    // nuqs drops entries that fail to parse rather than throwing.
    expect(parsed.breakdowns).toEqual(["sex"]);
  });

  it("never throws on garbage input", () => {
    expect(() =>
      loadFilterState(
        new URLSearchParams("geoLevel=%00&geoCode=&indicator=[object Object]&compareGeos=,,,"),
      ),
    ).not.toThrow();
  });
});
