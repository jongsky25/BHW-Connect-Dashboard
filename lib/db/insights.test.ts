import { describe, expect, it } from "vitest";
import {
  MAX_CARDS,
  MIN_LEADER_N,
  benchmarkDiff,
  householdsPerBhw,
  pickTopInsights,
  rankChildren,
  spreadOf,
  type ChildSummary,
  type InsightCard,
} from "./insights";

function child(overrides: Partial<ChildSummary>): ChildSummary {
  return {
    geoCode: "X",
    geoLevel: "province",
    geoName: "X",
    nTotal: 100,
    pctAccredited: null,
    anyHonorariumPct: null,
    ...overrides,
  };
}

const byAccreditation = (r: ChildSummary) => r.pctAccredited;

describe("rankChildren", () => {
  it("sorts qualifying children best-first by the metric", () => {
    const rows = [
      child({ geoCode: "A", pctAccredited: 40 }),
      child({ geoCode: "B", pctAccredited: 90 }),
      child({ geoCode: "C", pctAccredited: 65 }),
    ];
    expect(rankChildren(rows, byAccreditation).map((r) => r.geoCode)).toEqual(["B", "C", "A"]);
  });

  it("drops children below the leader-n threshold", () => {
    const rows = [
      child({ geoCode: "TINY", pctAccredited: 100, nTotal: MIN_LEADER_N - 1 }),
      child({ geoCode: "BIG", pctAccredited: 50, nTotal: MIN_LEADER_N }),
    ];
    expect(rankChildren(rows, byAccreditation).map((r) => r.geoCode)).toEqual(["BIG"]);
  });

  it("drops children with a null metric or null n", () => {
    const rows = [
      child({ geoCode: "NULLPCT", pctAccredited: null }),
      child({ geoCode: "NULLN", pctAccredited: 80, nTotal: null }),
      child({ geoCode: "OK", pctAccredited: 10 }),
    ];
    expect(rankChildren(rows, byAccreditation).map((r) => r.geoCode)).toEqual(["OK"]);
  });
});

describe("spreadOf", () => {
  const ranked = rankChildren(
    [
      child({ geoCode: "A", pctAccredited: 80 }),
      child({ geoCode: "B", pctAccredited: 60 }),
      child({ geoCode: "C", pctAccredited: 50 }),
      child({ geoCode: "D", pctAccredited: 30 }),
    ],
    byAccreditation,
  );

  it("returns top, bottom, and the rounded gap", () => {
    const spread = spreadOf(ranked, byAccreditation);
    expect(spread?.top.geoCode).toBe("A");
    expect(spread?.bottom.geoCode).toBe("D");
    expect(spread?.gap).toBe(50);
  });

  it("returns null with too few children — the gap of a coin flip isn't a story", () => {
    expect(spreadOf(ranked.slice(0, 3), byAccreditation)).toBeNull();
  });

  it("returns null when the gap is too narrow to be noteworthy", () => {
    const narrow = rankChildren(
      [
        child({ geoCode: "A", pctAccredited: 62 }),
        child({ geoCode: "B", pctAccredited: 61 }),
        child({ geoCode: "C", pctAccredited: 60 }),
        child({ geoCode: "D", pctAccredited: 59 }),
      ],
      byAccreditation,
    );
    expect(spreadOf(narrow, byAccreditation)).toBeNull();
  });
});

describe("benchmarkDiff", () => {
  it("rounds both sides and diffs the rounded values", () => {
    // 33.4 vs 33.0 both round to 33 — must not report a phantom 0.4-point gap.
    expect(benchmarkDiff(33.4, 33.0)).toEqual({ own: 33, parent: 33, diff: 0 });
  });

  it("reports the signed difference", () => {
    expect(benchmarkDiff(72.6, 60.2)).toEqual({ own: 73, parent: 60, diff: 13 });
    expect(benchmarkDiff(41, 55.8)).toEqual({ own: 41, parent: 56, diff: -15 });
  });

  it("returns null when either side is missing", () => {
    expect(benchmarkDiff(null, 50)).toBeNull();
    expect(benchmarkDiff(50, undefined)).toBeNull();
  });
});

describe("householdsPerBhw", () => {
  it("computes the rounded households-per-BHW ratio", () => {
    expect(householdsPerBhw(1_050, 4)).toBe(263);
  });

  it("returns null when either input is missing or non-positive", () => {
    expect(householdsPerBhw(null, 4)).toBeNull();
    expect(householdsPerBhw(1_000, null)).toBeNull();
    expect(householdsPerBhw(0, 4)).toBeNull();
    expect(householdsPerBhw(1_000, 0)).toBeNull();
  });
});

describe("pickTopInsights", () => {
  function card(id: string, score: number): InsightCard {
    return { id, category: id, headline: id, caption: id, score };
  }

  it("orders by score descending and caps at the grid size", () => {
    const cards = Array.from({ length: MAX_CARDS + 2 }, (_, i) => card(`c${i}`, i));
    const picked = pickTopInsights(cards);
    expect(picked).toHaveLength(MAX_CARDS);
    expect(picked[0].id).toBe(`c${MAX_CARDS + 1}`);
    expect(picked.map((c) => c.score)).toEqual(
      [...picked.map((c) => c.score)].sort((a, b) => b - a),
    );
  });

  it("keeps registry order on score ties and does not mutate its input", () => {
    const cards = [card("first", 50), card("second", 50), card("third", 60)];
    expect(pickTopInsights(cards).map((c) => c.id)).toEqual(["third", "first", "second"]);
    expect(cards.map((c) => c.id)).toEqual(["first", "second", "third"]);
  });
});
