import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildIndicatorRow } from "@/lib/db/indicators";

const {
  getPeerRank,
  getBenchmarkContext,
  getChildGeos,
  getGeoByCode,
  getChildIndicators,
  getInsights,
} = vi.hoisted(() => ({
  getPeerRank: vi.fn(),
  getBenchmarkContext: vi.fn(),
  getChildGeos: vi.fn(),
  getGeoByCode: vi.fn(),
  getChildIndicators: vi.fn(),
  getInsights: vi.fn(),
}));

vi.mock("@/lib/db/peer-ranks", () => ({ getPeerRank }));
vi.mock("@/lib/db/benchmark-context", () => ({ getBenchmarkContext }));
vi.mock("@/lib/db/geo", () => ({ getChildGeos, getGeoByCode }));
vi.mock("@/lib/db/indicators", () => ({ getChildIndicators }));
vi.mock("@/lib/db/insights", () => ({ getInsights }));

const { createAnalysisTools, unrankedReason, PICK_FROM_CHILD } = await import("./analysis-tools");

const tools = createAnalysisTools();
const run = (name: string, args: Record<string, unknown>) =>
  tools.find((t) => t.definition.name === name)!.execute(args);

const BASILAN = { geoCode: "150701000", geoLevel: "province", geoName: "Basilan", incomeClass: 3 };

const benchmark = (
  self: number | null,
  region: number | null,
  national: number | null,
  n = 900,
) => ({
  geo: { geoCode: "150701000", geoLevel: "province", geoName: "Basilan" },
  ancestors: { region: { geoName: "BARMM" }, province: null, citymun: null },
  self: {
    overview: { householdsPerBhw: null, profilingCoveragePct: null, bhwPer1000: null },
    counts: { pctAccredited: self },
  },
  region: { geoName: "BARMM", overview: {}, counts: { pctAccredited: region } },
  national: { overview: {}, counts: { pctAccredited: national } },
  showBenchmarks: true,
  adequacy: { n, smallSample: n < 30 },
});

const child = (geoName: string, pct: number | null, nTotal = 100): ChildIndicatorRow =>
  ({
    geoCode: geoName.toLowerCase(),
    geoName,
    nTotal,
    pctAccredited: pct,
    adjustedPctAccredited: null,
    anyHonorariumPct: pct === null ? null : 100 - pct,
    avgActiveYears: null,
    householdsPerBhw: null,
    coveragePct: null,
    bhwPer1000: null,
  }) as ChildIndicatorRow;

beforeEach(() => {
  vi.resetAllMocks();
  getGeoByCode.mockResolvedValue(BASILAN);
  getPeerRank.mockResolvedValue(null);
  getBenchmarkContext.mockResolvedValue(benchmark(45.2, 48.0, 51.0));
  getChildGeos.mockResolvedValue([]);
  getChildIndicators.mockResolvedValue([]);
  getInsights.mockResolvedValue([]);
});

describe("getPeerContext", () => {
  it("turns a bare value into a rank, a median and an outlier flag", async () => {
    getPeerRank.mockResolvedValue({
      indicator: "pct_accredited",
      value: 45.2,
      nTotal: 900,
      rankPosition: 12,
      nSiblings: 81,
      percentile: 85.2,
      median: 51.0,
      mad: 6.1,
      isOutlier: true,
    });

    const result = (await run("getPeerContext", {
      geoCode: "150701000",
      geoLevel: "province",
      indicator: "pct_accredited",
    })) as Record<string, Record<string, unknown>>;

    expect(result.peer).toMatchObject({
      ranked: true,
      rankPosition: 12,
      nSiblings: 81,
      siblingPlural: "provinces",
      among: "BARMM",
      siblingMedian: 51.0,
      isOutlier: true,
    });
    expect(result.benchmark).toMatchObject({
      self: 45.2,
      region: { geoName: "BARMM", value: 48.0 },
      national: { value: 51.0 },
    });
  });

  /**
   * The reason is the load-bearing part. A bare "not ranked" reads to a model as missing data,
   * which it then reports as a gap in the dataset rather than a property of the table.
   */
  it.each([
    ["national", /no peers to rank against/],
    ["barangay", /city\/municipality level only/],
  ] as const)("explains why %s has no rank", async (geoLevel, pattern) => {
    getGeoByCode.mockResolvedValue({ ...BASILAN, geoLevel });
    const result = (await run("getPeerContext", {
      geoCode: geoLevel === "national" ? "PH" : "150701001",
      geoLevel,
      indicator: "pct_accredited",
    })) as Record<string, Record<string, unknown>>;

    expect(result.peer.ranked).toBe(false);
    expect(String(result.peer.reason)).toMatch(pattern);
  });

  it("never queries agg_peer_ranks at a level that has no rows", async () => {
    await run("getPeerContext", {
      geoCode: "PH",
      geoLevel: "national",
      indicator: "pct_accredited",
    });
    expect(getPeerRank).not.toHaveBeenCalled();
  });

  it("warns when the geography's own sample is too small to be stable", async () => {
    getBenchmarkContext.mockResolvedValue(benchmark(45.2, 48.0, 51.0, 12));
    const result = (await run("getPeerContext", {
      geoCode: "150701000",
      geoLevel: "province",
      indicator: "pct_accredited",
    })) as { warnings: string[] };
    expect(result.warnings.join(" ")).toMatch(/12 validated profiles/);
  });

  it("refuses an indicator agg_peer_ranks does not cover", async () => {
    expect(
      await run("getPeerContext", {
        geoCode: "150701000",
        geoLevel: "province",
        indicator: "demographics",
      }),
    ).toEqual({ error: "Invalid arguments for getPeerContext." });
  });

  it("reports an unknown geo_code rather than answering about nothing", async () => {
    getGeoByCode.mockResolvedValue(null);
    expect(
      await run("getPeerContext", {
        geoCode: "000000000",
        geoLevel: "province",
        indicator: "pct_accredited",
      }),
    ).toMatchObject({ error: expect.stringContaining("000000000") });
  });
});

describe("getDistribution", () => {
  beforeEach(() => {
    getChildGeos.mockResolvedValue([
      { geoCode: "a", geoLevel: "citymun" },
      { geoCode: "b", geoLevel: "citymun" },
      { geoCode: "c", geoLevel: "citymun" },
    ]);
  });

  it("reports the range and the extremes", async () => {
    getChildIndicators.mockResolvedValue([
      child("Alpha", 30),
      child("Beta", 70),
      child("Gamma", 50),
    ]);
    const result = (await run("getDistribution", {
      parentCode: "150701000",
      indicator: "pct_accredited",
    })) as Record<string, never> & {
      spread: { min: number; max: number };
      highest: { geoName: string }[];
      lowest: { geoName: string }[];
    };

    expect(result.spread).toEqual({ min: 30, max: 70 });
    expect(result.highest[0].geoName).toBe("Beta");
    expect(result.lowest[0].geoName).toBe("Alpha");
  });

  /** The dashboard refuses to crown a leader below MIN_LEADER_N; the model must be told which
   * rows are noise rather than left to rank them. */
  it("marks and warns about children below the small-sample threshold", async () => {
    getChildIndicators.mockResolvedValue([
      child("Alpha", 100, 3),
      child("Beta", 70),
      child("Gamma", 50),
    ]);
    const result = (await run("getDistribution", {
      parentCode: "150701000",
      indicator: "pct_accredited",
    })) as {
      counts: { smallSample: number };
      warnings: string[];
      highest: { smallSample: boolean }[];
    };

    expect(result.counts.smallSample).toBe(1);
    expect(result.highest[0].smallSample).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/do not present them as leaders/);
  });

  it("counts children with no value and says the range covers only those that have one", async () => {
    getChildIndicators.mockResolvedValue([
      child("Alpha", null),
      child("Beta", 70),
      child("Gamma", 50),
    ]);
    const result = (await run("getDistribution", {
      parentCode: "150701000",
      indicator: "pct_accredited",
    })) as { counts: { withValue: number; missing: number }; warnings: string[] };

    expect(result.counts).toMatchObject({ withValue: 2, missing: 1 });
    expect(result.warnings.join(" ")).toMatch(/have no value for this indicator/);
  });

  it("reports a correlation only when a second indicator is given", async () => {
    getChildIndicators.mockResolvedValue([child("Alpha", 30), child("Beta", 70)]);
    const without = (await run("getDistribution", {
      parentCode: "150701000",
      indicator: "pct_accredited",
    })) as { correlation: unknown };
    expect(without.correlation).toBeNull();

    const with_ = (await run("getDistribution", {
      parentCode: "150701000",
      indicator: "pct_accredited",
      against: "any_honorarium_pct",
    })) as { correlation: { kind: string; n: number } };
    // Two pairs is far below describeCorrelation's floor — it must say so, not invent a coefficient.
    expect(with_.correlation.kind).toBe("insufficient");
  });

  it("refuses to look inside a barangay, which has nothing inside it", async () => {
    getGeoByCode.mockResolvedValue({ ...BASILAN, geoLevel: "barangay" });
    expect(
      await run("getDistribution", { parentCode: "150701001", indicator: "pct_accredited" }),
    ).toMatchObject({ error: expect.stringContaining("lowest level") });
  });
});

describe("getInsightCards", () => {
  it("returns the dashboard's own cards without their editorial score", async () => {
    getInsights.mockResolvedValue([
      { id: "x", category: "Coverage", headline: "H", caption: "C", href: "/explore", score: 42 },
    ]);
    const result = (await run("getInsightCards", {
      geoCode: "150701000",
      geoLevel: "province",
    })) as { cards: Record<string, unknown>[] };

    expect(result.cards[0]).toEqual({
      category: "Coverage",
      headline: "H",
      caption: "C",
      href: "/explore",
    });
    // `score` curates the grid and is documented as not shown to users; handing it over invites
    // the model to quote a number that means nothing outside the generator.
    expect(result.cards[0]).not.toHaveProperty("score");
  });

  it("says why there are no cards rather than returning a bare empty list", async () => {
    const result = (await run("getInsightCards", {
      geoCode: "150701000",
      geoLevel: "province",
    })) as { count: number; note: string };
    expect(result.count).toBe(0);
    expect(result.note).toMatch(/thresholds/);
  });
});

describe("indicator picks", () => {
  // A lookup rather than a switch, so a seventh indicator is a compile error here rather than a
  // silent null in an answer.
  it("covers every indicator agg_peer_ranks ranks", () => {
    expect(Object.keys(PICK_FROM_CHILD).sort()).toEqual(
      [
        "any_honorarium_pct",
        "avg_active_years",
        "bhw_per_1000",
        "coverage_pct",
        "households_per_bhw",
        "pct_accredited",
      ].sort(),
    );
  });
});

describe("unrankedReason", () => {
  it("is null for the three levels that are ranked", () => {
    for (const level of ["region", "province", "citymun"] as const) {
      expect(unrankedReason(level)).toBeNull();
    }
  });
});
