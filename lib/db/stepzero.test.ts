import { describe, expect, it } from "vitest";
import { bhwPer1000ResidentsFor, coverageForDisplay } from "./stepzero";

describe("bhwPer1000ResidentsFor", () => {
  it("computes a rounded per-1,000-residents rate", () => {
    expect(bhwPer1000ResidentsFor(3068, 306_835)).toBe(10);
  });

  it("rounds to one decimal place", () => {
    expect(bhwPer1000ResidentsFor(1, 3_000)).toBe(0.3);
  });

  it("returns null when population is missing", () => {
    expect(bhwPer1000ResidentsFor(100, null)).toBeNull();
  });

  it("returns null when totalBhw is missing", () => {
    expect(bhwPer1000ResidentsFor(null, 1000)).toBeNull();
  });

  it("returns null when population is zero", () => {
    expect(bhwPer1000ResidentsFor(100, 0)).toBeNull();
  });
});

describe("coverageForDisplay", () => {
  it("passes through a normal ratio", () => {
    expect(coverageForDisplay({ profilingCoveragePct: 74, coverageExceedsBase: false })).toBe(74);
  });

  it("caps at 100 when profiled counts exceed the registered base", () => {
    expect(coverageForDisplay({ profilingCoveragePct: 460, coverageExceedsBase: true })).toBe(100);
  });

  it("returns null when there is nothing to compute a ratio from", () => {
    expect(coverageForDisplay({ profilingCoveragePct: null, coverageExceedsBase: false })).toBeNull();
  });
});
