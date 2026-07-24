import { describe, expect, it } from "vitest";
import { toProfilingStatus, type Row } from "./profiling-status";

/** ABUYOG (0803701): 116/96/175 headcount, 211 drafted + 1 for_validation encoded, none further. */
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

/** JARO (0803723): mostly approved, and its pipeline (243) overshoots its headcount (238). */
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
  it("splits the raw buckets into four mutually-exclusive stages", () => {
    const s = toProfilingStatus(abuyog);
    // Encoded = drafted + for_validation + back_to_encoder = 211 + 1 + 0 = 212 (not cumulative:
    // it excludes validated/attested). Nothing validated or attested yet.
    expect(s.encoded.count).toBe(212);
    expect(s.validated.count).toBe(0);
    expect(s.attested.count).toBe(0);
    // Not encoded = totalBhw − everything in the pipeline = 387 − 212 = 175.
    expect(s.notEncoded.count).toBe(175);
    // Percentages are against totalBhw (387): 212/387 ≈ 55%, 175/387 ≈ 45%.
    expect(s.encoded.pct).toBe(55);
    expect(s.notEncoded.pct).toBe(45);
  });

  it("makes the four stages partition the denominator (counts and shares sum to the whole)", () => {
    const s = toProfilingStatus(abuyog);
    const counts = s.encoded.count + s.validated.count + s.attested.count + s.notEncoded.count;
    expect(counts).toBe(s.totalBhw);
    const pcts =
      (s.encoded.pct ?? 0) + (s.validated.pct ?? 0) + (s.attested.pct ?? 0) + (s.notEncoded.pct ?? 0);
    expect(pcts).toBe(100);
    const fraction =
      s.encoded.fraction + s.validated.fraction + s.attested.fraction + s.notEncoded.fraction;
    expect(fraction).toBeCloseTo(1, 10);
  });

  it("counts validated as validated and approved as attested", () => {
    const s = toProfilingStatus(jaro);
    expect(s.encoded.count).toBe(1 + 0 + 2); // 3, awaiting validation
    expect(s.validated.count).toBe(7);
    expect(s.attested.count).toBe(233);
  });

  it("floors not-encoded at zero and still fills the bar when the pipeline overshoots", () => {
    // JARO's pipeline (3 + 7 + 233 = 243) exceeds its headcount (238), so nobody is "not encoded"
    // and the bar is normalized against the pipeline so the stages fill it exactly once.
    const s = toProfilingStatus(jaro);
    expect(s.notEncoded.count).toBe(0);
    const fraction =
      s.encoded.fraction + s.validated.fraction + s.attested.fraction + s.notEncoded.fraction;
    expect(fraction).toBeCloseTo(1, 10);
  });

  it("derives the denominator as registered + accredited + unregistered", () => {
    expect(toProfilingStatus(abuyog).totalBhw).toBe(387);
  });

  it("exposes the still-to-attest gap against the denominator", () => {
    // JARO: 238 to profile, 233 attested → 5 still to attest (~2% to go).
    const s = toProfilingStatus(jaro);
    expect(s.toAttest.count).toBe(5);
    expect(s.toAttest.pct).toBe(2);
    // ABUYOG: nothing attested yet → the whole denominator is still to go.
    const a = toProfilingStatus(abuyog);
    expect(a.toAttest.count).toBe(387);
    expect(a.toAttest.pct).toBe(100);
  });

  it("returns null percentages when the denominator is zero", () => {
    const empty: Row = {
      geo_code: "9999999",
      geo_level: "citymun",
      n_registered: 0,
      n_accredited: 0,
      n_unregistered: 0,
      n_total_bhw: 0,
      n_drafted: 0,
      n_for_validation: 0,
      n_back_to_encoder: 0,
      n_validated: 0,
      n_approved: 0,
    };
    const s = toProfilingStatus(empty);
    expect(s.encoded.pct).toBeNull();
    expect(s.notEncoded.pct).toBeNull();
    expect(s.toAttest.pct).toBeNull();
  });
});
