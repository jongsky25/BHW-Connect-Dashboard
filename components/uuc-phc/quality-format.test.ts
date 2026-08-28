import { describe, expect, it } from "vitest";
import { benchmark, share, showsWitness } from "./quality-format";
import type { UucPhcBenchmarkGap } from "@/lib/db/uuc-phc-quality";

/**
 * The display rules of `/uuc-phc/data-quality` (plan U10).
 *
 * Every case here is one where the obvious rounding makes the page state the opposite of what the
 * data says — which on a data-quality page is the only kind of bug that matters, because a reader
 * arrives at it precisely to find out what is wrong.
 */

function gap(over: Partial<UucPhcBenchmarkGap> = {}): UucPhcBenchmarkGap {
  return {
    provinceCode: "16003",
    provinceName: "AGUSAN DEL SUR",
    nListedProvince: 156,
    nAffected: 156,
    kind: "every value exactly 1",
    witnessValue: 1,
    finding: "criterion_d",
    ...over,
  };
}

describe("share", () => {
  it("floors a tiny non-zero share at <0.1% rather than rounding it to nothing", () => {
    // Two bounded ABR values in 5,987 barangays is 0.03%. "0%" would say the cap never binds on
    // that indicator, which is the opposite of the row's reason for existing.
    expect(share(2, 5987)).toBe("<0.1%");
    expect(share(1, 5987)).toBe("<0.1%");
  });

  it("still prints a real zero as zero", () => {
    // The distinction the floor exists to protect: none bounded and almost none bounded are
    // different findings.
    expect(share(0, 5987)).toBe("0%");
  });

  it("reproduces the cleaning report's own shares to one decimal", () => {
    expect(share(886, 5987)).toBe("14.8%");
    expect(share(456, 5987)).toBe("7.6%");
    expect(share(1397, 5987)).toBe("23.3%");
  });

  it("returns a dash rather than dividing by zero", () => {
    expect(share(0, 0)).toBe("—");
  });
});

describe("benchmark", () => {
  it("keeps the two decimals that make an over-ceiling benchmark legible", () => {
    // 100.96 rounded to one decimal is 101 — the exact figure the plan and the cleaning report
    // carried in error until U9 corrected them. Rounding here would put it straight back on a
    // page whose subject is figures being wrong.
    expect(benchmark(100.96)).toBe("100.96");
    expect(benchmark(102.15)).toBe("102.15");
  });

  it("does not pad a whole number with decimals it does not have", () => {
    expect(benchmark(1)).toBe("1");
    expect(benchmark(0)).toBe("0");
  });

  it("renders a missing benchmark as a dash, never as zero", () => {
    // "No reference supplied" and "a reference of 0" are two different findings on this very page.
    expect(benchmark(null)).toBe("—");
  });
});

describe("showsWitness", () => {
  it("hides a value the description already states", () => {
    expect(showsWitness(gap({ kind: "every value exactly 1", witnessValue: 1 }))).toBe(false);
    expect(showsWitness(gap({ kind: "every value zero", witnessValue: 0 }))).toBe(false);
  });

  it("shows a fraction, because the words cannot carry which fraction it was", () => {
    expect(
      showsWitness(gap({ kind: "fractions where percentages were wanted", witnessValue: 0.9 })),
    ).toBe(true);
  });

  it("always shows an FIC benchmark — how far above the ceiling it sits is the finding", () => {
    expect(showsWitness(gap({ finding: "fic_only", witnessValue: 100.96 }))).toBe(true);
    expect(showsWitness(gap({ finding: "fic_only", witnessValue: 102.15 }))).toBe(true);
  });

  it("shows nothing where the source supplied nothing", () => {
    expect(showsWitness(gap({ kind: "no reference supplied", witnessValue: null }))).toBe(false);
    expect(showsWitness(gap({ finding: "fic_only", witnessValue: null }))).toBe(false);
  });
});
