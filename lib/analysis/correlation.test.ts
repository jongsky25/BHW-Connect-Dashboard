import { describe, expect, it } from "vitest";
import {
  correlationStrength,
  describeCorrelation,
  MIN_CORRELATION_N,
  spearmanRho,
} from "./correlation";

describe("spearmanRho", () => {
  it("is +1 for a perfectly increasing monotonic relationship", () => {
    const pairs: Array<[number, number]> = [
      [1, 2],
      [2, 5],
      [3, 9],
      [4, 20],
      [5, 100],
    ];
    expect(spearmanRho(pairs)).toBeCloseTo(1, 10);
  });

  it("is -1 for a perfectly decreasing monotonic relationship", () => {
    const pairs: Array<[number, number]> = [
      [1, 50],
      [2, 40],
      [3, 30],
      [4, 20],
      [5, 10],
    ];
    expect(spearmanRho(pairs)).toBeCloseTo(-1, 10);
  });

  it("matches a hand-computed case with a single rank swap", () => {
    // X ranks 1..5; Y is monotonic except the last two are swapped, so exactly
    // one adjacent inversion. Spearman ρ = 1 - 6·Σd² / (n(n²−1)); d = 0,0,0,1,1
    // → Σd² = 2 → ρ = 1 - 12/120 = 0.9.
    const pairs: Array<[number, number]> = [
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 50],
      [5, 40],
    ];
    expect(spearmanRho(pairs)).toBeCloseTo(0.9, 10);
  });

  it("handles ties via average ranks (all-equal Y → undefined)", () => {
    expect(
      spearmanRho([
        [1, 7],
        [2, 7],
        [3, 7],
      ]),
    ).toBeNull();
  });

  it("returns null for fewer than two pairs", () => {
    expect(spearmanRho([[1, 1]])).toBeNull();
    expect(spearmanRho([])).toBeNull();
  });
});

describe("correlationStrength", () => {
  it("buckets by |rho| at the documented thresholds", () => {
    expect(correlationStrength(0.1)).toBe("none");
    expect(correlationStrength(0.2)).toBe("weak");
    expect(correlationStrength(0.39)).toBe("weak");
    expect(correlationStrength(0.4)).toBe("moderate");
    expect(correlationStrength(0.69)).toBe("moderate");
    expect(correlationStrength(0.7)).toBe("strong");
    expect(correlationStrength(1)).toBe("strong");
  });
});

describe("describeCorrelation", () => {
  it("refuses to characterize fewer than MIN_CORRELATION_N places", () => {
    const pairs = Array.from({ length: MIN_CORRELATION_N - 1 }, (_, i): [number, number] => [i, i]);
    expect(describeCorrelation(pairs)).toEqual({ kind: "insufficient", n: MIN_CORRELATION_N - 1 });
  });

  it("describes a strong positive link at/above the threshold N", () => {
    const pairs = Array.from({ length: MIN_CORRELATION_N }, (_, i): [number, number] => [i, i * 2]);
    const d = describeCorrelation(pairs);
    expect(d.kind).toBe("described");
    if (d.kind === "described") {
      expect(d.direction).toBe("positive");
      expect(d.strength).toBe("strong");
      expect(d.rho).toBeCloseTo(1, 10);
      expect(d.n).toBe(MIN_CORRELATION_N);
    }
  });

  it("reports a negative direction for an inverse relationship", () => {
    const pairs = Array.from({ length: 12 }, (_, i): [number, number] => [i, -i]);
    const d = describeCorrelation(pairs);
    expect(d.kind).toBe("described");
    if (d.kind === "described") {
      expect(d.direction).toBe("negative");
      expect(d.strength).toBe("strong");
    }
  });

  it("treats a constant variable (undefined rho) as insufficient", () => {
    const pairs = Array.from({ length: 12 }, (_, i): [number, number] => [i, 5]);
    expect(describeCorrelation(pairs).kind).toBe("insufficient");
  });
});
