import { describe, expect, it } from "vitest";
import { benchmarkRowsFor, type BenchmarkContext } from "./benchmark-context";
import type { BhwOverview } from "./stepzero";
import type { BhwCounts } from "./indicators";

function overview(householdsPerBhw: number | null): BhwOverview {
  return {
    geoCode: "x",
    geoLevel: "citymun",
    totalBhw: null,
    registeredUniverse: null,
    nRegistered: null,
    nRegisteredAccredited: null,
    nonRegistered: null,
    validatedProfiles: null,
    profilingCoveragePct: null,
    coverageExceedsBase: false,
    hasStepzero: false,
    population: null,
    households: null,
    householdsPerBhw,
    pctRegisteredAccredited: null,
    bhwPer1000: null,
  };
}

function counts(pctAccredited: number | null): BhwCounts {
  return {
    geoCode: "x",
    geoLevel: "citymun",
    nTotal: null,
    nAccredited: null,
    pctAccredited,
    avgActiveYears: null,
    anyHonorariumPct: null,
    ciLow: null,
    ciHigh: null,
    adjustedPct: null,
  };
}

/** Minimal fixture builder — only the fields `benchmarkRowsFor` actually reads
 * are exercised in these tests, but the object still has to satisfy the full
 * `BenchmarkContext` shape. */
function makeCtx(overrides: Partial<BenchmarkContext> = {}): BenchmarkContext {
  return {
    geo: { geoCode: "citymun-1", geoLevel: "citymun", geoName: "This place" },
    ancestors: { region: null, province: null, citymun: null },
    self: { overview: overview(50), counts: counts(70) },
    region: { geoName: "Region VII", overview: overview(60), counts: counts(65) },
    national: { overview: overview(55), counts: counts(60) },
    showBenchmarks: true,
    adequacy: { n: 100, smallSample: false },
    ...overrides,
  };
}

describe("benchmarkRowsFor", () => {
  it("builds This place / region / Philippines rows from a pick function", () => {
    const ctx = makeCtx();
    const rows = benchmarkRowsFor(ctx, (s) => s.counts?.pctAccredited ?? null);
    expect(rows).toEqual([
      { label: "This place", value: 70, isPrimary: true },
      { label: "Region VII", value: 65 },
      { label: "Philippines", value: 60 },
    ]);
  });

  it("omits the region row when ctx.region is null (region level and above)", () => {
    const ctx = makeCtx({ region: null });
    const rows = benchmarkRowsFor(ctx, (s) => s.counts?.pctAccredited ?? null);
    expect(rows).toEqual([
      { label: "This place", value: 70, isPrimary: true },
      { label: "Philippines", value: 60 },
    ]);
  });

  it("omits the national row when ctx.national is null (national level)", () => {
    const ctx = makeCtx({ region: null, national: null, showBenchmarks: false });
    const rows = benchmarkRowsFor(ctx, (s) => s.counts?.pctAccredited ?? null);
    expect(rows).toEqual([{ label: "This place", value: 70, isPrimary: true }]);
  });

  it("passes a null pick result straight through as a null-valued row", () => {
    const ctx = makeCtx({
      self: { overview: overview(50), counts: counts(null) },
      region: { geoName: "Region VII", overview: overview(60), counts: counts(null) },
    });
    const rows = benchmarkRowsFor(ctx, (s) => s.counts?.pctAccredited ?? null);
    expect(rows).toEqual([
      { label: "This place", value: null, isPrimary: true },
      { label: "Region VII", value: null },
      { label: "Philippines", value: 60 },
    ]);
  });

  it("honors a custom selfLabel", () => {
    const ctx = makeCtx();
    const rows = benchmarkRowsFor(ctx, (s) => s.overview.householdsPerBhw, "Manila");
    expect(rows[0]).toEqual({ label: "Manila", value: 50, isPrimary: true });
  });
});
