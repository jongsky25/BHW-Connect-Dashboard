import { describe, expect, it } from "vitest";
import { step, toProfilingStatus, type Row } from "./profiling-status";

describe("step", () => {
  it("computes the rounded percentage of the denominator", () => {
    expect(step(50, 200)).toEqual({ count: 50, pct: 25, pctCapped: 25 });
  });

  it("caps pctCapped at 100 while keeping the raw pct when the count drifts above the base", () => {
    expect(step(120, 100)).toEqual({ count: 120, pct: 120, pctCapped: 100 });
  });

  it("returns null percentages when the denominator is zero", () => {
    expect(step(5, 0)).toEqual({ count: 5, pct: null, pctCapped: null });
  });
});

/** ABUYOG (0803701): 116/96/175 headcount, 211 drafted + 1 for_validation encoded. */
const abuyog: Row = {
  geo_code: "0803701",
  geo_level: "citymun",
  n_registered: 116,
  n_accredited: 96,
  n_unregistered: 175,
  n_total_bhw: 387,
  n_drafted: 211,
  n_for_validation: 1,
  n_back_to_encoder: 0,
  n_validated: 0,
  n_approved: 0,
};

/** JARO (0803723): mostly approved — exercises the far end of the funnel. */
const jaro: Row = {
  geo_code: "0803723",
  geo_level: "citymun",
  n_registered: 115,
  n_accredited: 110,
  n_unregistered: 13,
  n_total_bhw: 238,
  n_drafted: 1,
  n_for_validation: 0,
  n_back_to_encoder: 2,
  n_validated: 7,
  n_approved: 233,
};

describe("toProfilingStatus", () => {
  it("maps the five pipeline buckets into the cumulative Encode → Validate → Certify funnel", () => {
    const s = toProfilingStatus(abuyog);
    // Encoded = all five buckets = 211 + 1 = 212; nothing validated/certified yet.
    expect(s.encode.count).toBe(212);
    expect(s.validate.count).toBe(0);
    expect(s.certify.count).toBe(0);
    // Percentages are against totalBhw (387).
    expect(s.encode.pct).toBe(55);
  });

  it("counts validated + approved as validated, and approved as certified", () => {
    const s = toProfilingStatus(jaro);
    expect(s.encode.count).toBe(1 + 0 + 2 + 7 + 233); // 243
    expect(s.validate.count).toBe(7 + 233); // 240
    expect(s.certify.count).toBe(233);
  });

  it("preserves the funnel invariant Encoded ≥ Validated ≥ Certified", () => {
    for (const row of [abuyog, jaro]) {
      const s = toProfilingStatus(row);
      expect(s.encode.count).toBeGreaterThanOrEqual(s.validate.count);
      expect(s.validate.count).toBeGreaterThanOrEqual(s.certify.count);
    }
  });

  it("derives the denominator as registered + accredited + unregistered", () => {
    expect(toProfilingStatus(abuyog).totalBhw).toBe(387);
  });
});
