import { describe, expect, it } from "vitest";
import { loadFilterState, serializeFilterState } from "./codec";
import { NATIONAL_GEO_CODE, normalizeMapIndicator } from "./schema";

describe("filter codec", () => {
  it("round-trips a full filter state through URL <-> state", () => {
    const original = {
      geoLevel: "province" as const,
      geoCode: "050400000",
      indicator: "training" as const,
      mapIndicator: "households_per_bhw" as const,
      relX: "avg_active_years" as const,
      relY: "coverage_pct" as const,
      compareGeos: ["050400000", "137400000"],
      breakdowns: ["sex" as const, "age_band" as const],
    };

    const url = serializeFilterState("/explore", original);
    const params = new URL(url, "http://localhost").searchParams;
    const parsed = loadFilterState(params);

    expect(parsed).toEqual(original);
    // compareGeos reads/writes as ?geos= per BUILD_PLAN.md §7 1.7's URL spec.
    expect(params.has("geos")).toBe(true);
    expect(params.has("compareGeos")).toBe(false);

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
    expect(parsed.mapIndicator).toBe("pct_accredited");
    expect(parsed.relX).toBe("households_per_bhw");
    expect(parsed.relY).toBe("pct_accredited");
    expect(parsed.compareGeos).toBeNull();
    expect(parsed.breakdowns).toBeNull();
  });

  it("round-trips a per-topic training map indicator through the URL", () => {
    const url = serializeFilterState("/explore", {
      geoLevel: "region",
      geoCode: "040000000",
      mapIndicator: "training:maternal-health",
    });
    const params = new URL(url, "http://localhost").searchParams;
    expect(params.get("mapIndicator")).toBe("training:maternal-health");
    expect(loadFilterState(params).mapIndicator).toBe("training:maternal-health");
  });

  it("falls back to the default map indicator for unknown or malformed values", () => {
    expect(loadFilterState(new URLSearchParams("mapIndicator=not-real")).mapIndicator).toBe(
      "pct_accredited",
    );
    // A `training:` prefix with an invalid (non-kebab) slug degrades, never throws.
    expect(loadFilterState(new URLSearchParams("mapIndicator=training:Bad Slug")).mapIndicator).toBe(
      "pct_accredited",
    );
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
        new URLSearchParams("geoLevel=%00&geoCode=&indicator=[object Object]&geos=,,,"),
      ),
    ).not.toThrow();
  });
});

describe("normalizeMapIndicator", () => {
  it("passes through every base indicator", () => {
    for (const v of [
      "pct_accredited",
      "any_honorarium_pct",
      "households_per_bhw",
      "avg_active_years",
      "coverage_pct",
    ]) {
      expect(normalizeMapIndicator(v)).toBe(v);
    }
  });

  it("accepts a well-formed training slug", () => {
    expect(normalizeMapIndicator("training:maternal-health")).toBe("training:maternal-health");
    expect(normalizeMapIndicator("training:tb")).toBe("training:tb");
  });

  it("defaults for empty, unknown, or malformed input", () => {
    expect(normalizeMapIndicator(null)).toBe("pct_accredited");
    expect(normalizeMapIndicator(undefined)).toBe("pct_accredited");
    expect(normalizeMapIndicator("")).toBe("pct_accredited");
    expect(normalizeMapIndicator("bhw_per_1000")).toBe("pct_accredited");
    expect(normalizeMapIndicator("training:")).toBe("pct_accredited");
    expect(normalizeMapIndicator("training:Bad Slug")).toBe("pct_accredited");
    expect(normalizeMapIndicator("training:-leading")).toBe("pct_accredited");
  });
});
