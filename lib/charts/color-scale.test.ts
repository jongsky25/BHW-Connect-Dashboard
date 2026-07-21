import { describe, expect, it } from "vitest";
import { binIndexForValue, colorForValue, computeQuantileBins, NO_DATA_COLOR } from "./color-scale";
import { sequentialRamp } from "./palette";

describe("computeQuantileBins", () => {
  it("returns no bins for an empty / all-null value set", () => {
    expect(computeQuantileBins([])).toEqual([]);
    expect(computeQuantileBins([null, undefined])).toEqual([]);
  });

  it("returns a single mid-ramp bin for one distinct value", () => {
    const bins = computeQuantileBins([42, 42, 42]);
    expect(bins).toHaveLength(1);
    expect(bins[0]).toMatchObject({ min: 42, max: 42 });
    expect(bins[0].color).toBe(sequentialRamp[Math.floor(sequentialRamp.length / 2)]);
  });

  it("produces five contiguous quintile bins for a spread of values", () => {
    const values = Array.from({ length: 20 }, (_, i) => i * 5); // 0..95
    const bins = computeQuantileBins(values);
    expect(bins).toHaveLength(5);
    // Contiguous: each bin's max is the next bin's min.
    for (let i = 1; i < bins.length; i++) {
      expect(bins[i].min).toBe(bins[i - 1].max);
    }
    // Span covers the full data range, light -> dark.
    expect(bins[0].min).toBe(0);
    expect(bins[bins.length - 1].max).toBe(95);
    expect(bins[0].color).toBe(sequentialRamp[0]);
    expect(bins[bins.length - 1].color).toBe(sequentialRamp[sequentialRamp.length - 1]);
  });

  it("falls back to fewer bins when there are fewer distinct values than requested", () => {
    const bins = computeQuantileBins([10, 10, 20, 20, 30, 30]);
    expect(bins.length).toBeLessThanOrEqual(3);
    // No zero-width or duplicated ranges.
    for (const b of bins) expect(b.max).toBeGreaterThan(b.min);
  });
});

describe("binIndexForValue / colorForValue", () => {
  const bins = computeQuantileBins(Array.from({ length: 20 }, (_, i) => i * 5)); // 0..95

  it("places the maximum value in the top bin (no overflow past the ramp)", () => {
    const idx = binIndexForValue(95, bins);
    expect(idx).toBe(bins.length - 1);
    expect(colorForValue(95, bins)).toBe(bins[bins.length - 1].color);
  });

  it("places the minimum value in the bottom bin", () => {
    expect(binIndexForValue(0, bins)).toBe(0);
    expect(colorForValue(0, bins)).toBe(bins[0].color);
  });

  it("returns the no-data color when there are no bins", () => {
    expect(binIndexForValue(50, [])).toBe(-1);
    expect(colorForValue(50, [])).toBe(NO_DATA_COLOR);
  });
});
