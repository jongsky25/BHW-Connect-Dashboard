import { describe, expect, it } from "vitest";
import { COMPARE_METRICS, leaderIndex } from "./compare-metrics";
import { MAP_BASE_INDICATORS } from "@/lib/filters/schema";
import { MAP_BASE_INDICATOR_META } from "@/lib/analysis/map-indicators";

describe("COMPARE_METRICS", () => {
  it("covers every base map indicator exactly once", () => {
    const keys = COMPARE_METRICS.map((m) => m.key);
    expect([...keys].sort()).toEqual([...MAP_BASE_INDICATORS].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reuses the Explore switcher's labels and suffixes verbatim", () => {
    for (const metric of COMPARE_METRICS) {
      expect(metric.label).toBe(MAP_BASE_INDICATOR_META[metric.key].label);
      expect(metric.suffix).toBe(MAP_BASE_INDICATOR_META[metric.key].suffix);
    }
  });
});

describe("leaderIndex", () => {
  it("returns the index of the strict maximum", () => {
    expect(leaderIndex([10, 42, 7])).toBe(1);
    expect(leaderIndex([null, 3, 9])).toBe(2);
  });

  it("ignores null values when finding the leader", () => {
    expect(leaderIndex([null, 5, null, 2])).toBe(1);
  });

  it("returns null when fewer than two places carry a value", () => {
    expect(leaderIndex([null, null])).toBeNull();
    expect(leaderIndex([42, null, null])).toBeNull();
    expect(leaderIndex([])).toBeNull();
  });

  it("returns null on a tie for the top value", () => {
    expect(leaderIndex([42, 42, 7])).toBeNull();
    expect(leaderIndex([0, 0])).toBeNull();
  });

  it("treats zero as a real value, not missing", () => {
    expect(leaderIndex([0, -5])).toBe(0);
  });
});
