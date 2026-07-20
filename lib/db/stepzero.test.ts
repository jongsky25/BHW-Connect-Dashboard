import { describe, expect, it } from "vitest";
import { coverageForDisplay, householdsPerBhw } from "./stepzero";

describe("householdsPerBhw", () => {
  it("computes the rounded households-per-BHW ratio", () => {
    expect(householdsPerBhw(1_050, 4)).toBe(263);
  });

  it("returns null when households is missing", () => {
    expect(householdsPerBhw(null, 4)).toBeNull();
  });

  it("returns null when totalBhw is missing", () => {
    expect(householdsPerBhw(1_000, null)).toBeNull();
  });

  it("returns null when either input is zero", () => {
    expect(householdsPerBhw(0, 4)).toBeNull();
    expect(householdsPerBhw(1_000, 0)).toBeNull();
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
