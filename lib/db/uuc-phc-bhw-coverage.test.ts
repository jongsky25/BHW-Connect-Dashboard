import { describe, expect, it } from "vitest";
import {
  coverageDirection,
  sizeExplanation,
  toUucBhwCoverage,
  type Row,
} from "./uuc-phc-bhw-coverage";

/**
 * The national row as `agg_bhw_by_uuc_status` holds it: 5,987 listed barangays against 35,971
 * others, 48,480 BHWs and 2,438,331 households on the listed side and 258,339 / 25,401,705 on the
 * other, with 16 BHWs and 6,061 households in neither because StepZero carries them above
 * barangay grain only.
 */
const national: Row = {
  geo_code: "PH",
  geo_level: "national",
  n_barangays_listed: 5987,
  n_barangays_other: 35971,
  n_listed_with_data: 5987,
  n_other_with_data: 35971,
  n_listed_no_bhw: 100,
  n_other_no_bhw: 945,
  listed_n_bhw: 48480,
  other_n_bhw: 258339,
  listed_households: 2438331,
  other_households: 25401705,
  listed_registered_universe: 40000,
  other_registered_universe: 220000,
  listed_n_profiled: 30000,
  other_n_profiled: 200000,
  unallocated_n_bhw: 16,
  unallocated_households: 6061,
  listed_is_suppressed: false,
  other_is_suppressed: false,
};

function rowWith(overrides: Partial<Row>): Row {
  return { ...national, ...overrides };
}

describe("toUucBhwCoverage", () => {
  it("derives households per BHW on each side rather than reading a stored ratio", () => {
    const c = toUucBhwCoverage(national);
    expect(c.comparison.kind).toBe("comparable");
    if (c.comparison.kind !== "comparable") return;
    expect(c.comparison.listed.householdsPerBhw).toBe(50.3);
    expect(c.comparison.other.householdsPerBhw).toBe(98.3);
  });

  it("carries the unallocated residual through instead of absorbing it", () => {
    // listed + other + unallocated is the area's own published StepZero row, exactly. Dropping the
    // residual would make the page's arithmetic disagree with every other surface on the site.
    const c = toUucBhwCoverage(national);
    expect(c.unallocatedNBhw).toBe(16);
    expect(c.unallocatedHouseholds).toBe(6061);
  });

  it("derives the per-barangay figures the headline needs to be read against", () => {
    const c = toUucBhwCoverage(national);
    if (c.comparison.kind !== "comparable") throw new Error("expected comparable");
    // 2,438,331 / 5,987 vs 25,401,705 / 35,971 — listed barangays are the smaller ones, which is
    // most of why their households-per-BHW is lower.
    expect(c.comparison.listed.householdsPerBarangay).toBe(407.3);
    expect(c.comparison.other.householdsPerBarangay).toBe(706.2);
    expect(c.comparison.listed.bhwPerBarangay).toBe(8.1);
    expect(c.comparison.other.bhwPerBarangay).toBe(7.2);
  });

  it("computes profiling coverage off the registered universe, as getBhwOverview does", () => {
    const c = toUucBhwCoverage(national);
    if (c.comparison.kind !== "comparable") throw new Error("expected comparable");
    expect(c.comparison.listed.profilingCoveragePct).toBe(75);
    expect(c.comparison.other.profilingCoveragePct).toBe(90.9);
  });

  it("keeps a decimal on profiling coverage, because the row exists to show a difference", () => {
    // Live, the two sides are 96.9% and 97.5%. Rounded to whole percent both read 97% and the row
    // — whose only job is to show whether the profiling confound is real here — says nothing.
    const c = toUucBhwCoverage(
      rowWith({
        listed_n_profiled: 42604,
        listed_registered_universe: 43964,
        other_n_profiled: 228313,
        other_registered_universe: 234264,
      }),
    );
    if (c.comparison.kind !== "comparable") throw new Error("expected comparable");
    expect(c.comparison.listed.profilingCoveragePct).toBe(96.9);
    expect(c.comparison.other.profilingCoveragePct).toBe(97.5);
  });

  it("reads an area with nothing listed as nothing listed, never as suppressed", () => {
    // NCR: a real 0 of 1,675. "None of this area's barangays are on the list" and "too few to
    // show" are opposite messages, and collapsing them is the failure this ordering prevents.
    const c = toUucBhwCoverage(
      rowWith({
        geo_code: "13",
        geo_level: "region",
        n_barangays_listed: 0,
        n_listed_with_data: 0,
        n_listed_no_bhw: 0,
        listed_n_bhw: 0,
        listed_households: 0,
        listed_registered_universe: 0,
        listed_n_profiled: 0,
      }),
    );
    expect(c.comparison.kind).toBe("nothing-listed");
  });

  it("reads an area where every barangay is listed as having no other group", () => {
    // MAYOYAO: 27 of 27. There is no comparison to draw, and a zeroed "other" side would render
    // as an area with no households and no BHWs rather than as an area with no other barangays.
    const c = toUucBhwCoverage(
      rowWith({
        geo_code: "1402706",
        geo_level: "citymun",
        n_barangays_listed: 27,
        n_barangays_other: 0,
        n_listed_with_data: 27,
        n_other_with_data: 0,
        other_n_bhw: 0,
        other_households: 0,
        other_registered_universe: 0,
        other_n_profiled: 0,
      }),
    );
    expect(c.comparison.kind).toBe("all-listed");
  });

  it("reports a suppressed side as suppressed and hands back no figures for it", () => {
    const c = toUucBhwCoverage(
      rowWith({
        geo_level: "citymun",
        n_barangays_listed: 3,
        n_listed_with_data: 3,
        listed_n_bhw: null,
        listed_households: null,
        listed_registered_universe: null,
        listed_n_profiled: null,
        listed_is_suppressed: true,
      }),
    );
    expect(c.comparison).toEqual({ kind: "suppressed", suppressedSide: "listed" });
  });

  it("suppresses the other side too, when it is the small one", () => {
    // A town with 25 of 27 barangays listed: the *unlisted* two are the group too small to render.
    const c = toUucBhwCoverage(
      rowWith({
        geo_level: "citymun",
        n_barangays_listed: 25,
        n_barangays_other: 2,
        n_listed_with_data: 25,
        n_other_with_data: 2,
        other_n_bhw: null,
        other_households: null,
        other_registered_universe: null,
        other_n_profiled: null,
        other_is_suppressed: true,
      }),
    );
    expect(c.comparison).toEqual({ kind: "suppressed", suppressedSide: "other" });
  });

  it("says nothing rather than dividing by zero when a side has no BHWs at all", () => {
    const c = toUucBhwCoverage(
      rowWith({ geo_level: "citymun", listed_n_bhw: 0, n_listed_with_data: 6, n_listed_no_bhw: 6 }),
    );
    if (c.comparison.kind !== "comparable") throw new Error("expected comparable");
    expect(c.comparison.listed.householdsPerBhw).toBeNull();
    expect(c.comparison.listed.nNoBhw).toBe(6);
  });
});

describe("coverageDirection", () => {
  it("calls the national picture 'thicker' — listed barangays carry fewer households per BHW", () => {
    // The plan's title question asks whether BHWs are thinner where communities are unserved.
    // Nationally the answer is the opposite, which is exactly why the surface reports the
    // exception rather than the average.
    expect(coverageDirection(toUucBhwCoverage(national).comparison)).toBe("thicker");
  });

  it("calls the reverse case 'thinner' — the reportable exception", () => {
    const c = toUucBhwCoverage(rowWith({ listed_n_bhw: 20000 }));
    expect(coverageDirection(c.comparison)).toBe("thinner");
  });

  it("calls an exact tie 'even' rather than picking a side", () => {
    const c = toUucBhwCoverage(
      rowWith({
        listed_households: 1000,
        listed_n_bhw: 100,
        other_households: 5000,
        other_n_bhw: 500,
      }),
    );
    expect(coverageDirection(c.comparison)).toBe("even");
  });

  it("has no direction to report when the comparison cannot be drawn", () => {
    for (const row of [
      rowWith({ n_barangays_listed: 0, listed_n_bhw: 0, listed_households: 0 }),
      rowWith({ n_barangays_other: 0, other_n_bhw: 0, other_households: 0 }),
      rowWith({
        n_listed_with_data: 2,
        listed_n_bhw: null,
        listed_households: null,
        listed_registered_universe: null,
        listed_n_profiled: null,
        listed_is_suppressed: true,
      }),
    ]) {
      expect(coverageDirection(toUucBhwCoverage(row).comparison)).toBeNull();
    }
  });
});

describe("sizeExplanation", () => {
  it("shows that the gap is barangay size, not BHW deployment", () => {
    // The whole reason this function exists: nationally, listed barangays hold 0.58× the
    // households of the others while carrying 1.13× the BHWs each. Households per BHW is halved
    // mostly because the barangays are smaller — a fact the headline alone hides, and the one
    // thing that stops "unserved areas are better covered" being read as a finding.
    const s = sizeExplanation(toUucBhwCoverage(national).comparison);
    expect(s).not.toBeNull();
    expect(s?.householdsPerBarangayRatio).toBeCloseTo(0.58, 2);
    expect(s?.bhwPerBarangayRatio).toBeCloseTo(1.13, 2);
  });

  it("is null wherever the comparison itself is", () => {
    const c = toUucBhwCoverage(
      rowWith({ n_barangays_listed: 0, listed_n_bhw: 0, listed_households: 0 }),
    );
    expect(sizeExplanation(c.comparison)).toBeNull();
  });

  it("is null rather than infinite when the other side has no barangay-level figure", () => {
    const c = toUucBhwCoverage(rowWith({ other_n_bhw: 0 }));
    expect(sizeExplanation(c.comparison)).toBeNull();
  });
});
