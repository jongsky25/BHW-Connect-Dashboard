import { describe, expect, it } from "vitest";
import {
  benchmarksArePlaceholder,
  comparesWorse,
  toBarangayDetail,
  type Row,
} from "./uuc-phc-indicators";

/** A barangay with a capped Water value (the source recorded it above 100) and a real IMR. */
const base: Row = {
  geo_code: "1402706001",
  physical_factor: 100,
  ip_pop: 92,
  armed_conf: 0,
  idp: 0,
  four_ps: 61,
  elcac_brgy: false,
  imr: 12,
  ufmr: 15,
  fic: 80,
  abr: 20,
  pre_natal: 70,
  sba: 65,
  water: 100,
  imr_prov_ref: 8,
  ufmr_prov_ref: 20,
  fic_prov_ref: 90,
  abr_prov_ref: 30,
  pre_natal_prov_ref: 60,
  sba_prov_ref: 60,
  water_prov_ref: 75,
  capped_indicators: ["water"],
};

describe("comparesWorse", () => {
  it("reads a higher value as worse for mortality and birth rates", () => {
    expect(comparesWorse(12, 8, true, 1000)).toBe(true);
    expect(comparesWorse(5, 8, true, 1000)).toBe(false);
  });

  it("reads a LOWER value as worse for coverage indicators", () => {
    // The direction is the whole point: 80% immunisation against a province's 90% is worse,
    // even though the number is larger than a mortality rate would ever be.
    expect(comparesWorse(80, 90, false, 100)).toBe(true);
    expect(comparesWorse(95, 90, false, 100)).toBe(false);
  });

  it("returns null rather than 'not worse' when there is no benchmark", () => {
    // 57 barangays sit in provinces that supplied no reference. Criterion (d) is not evaluable
    // for them, which is not the same as passing it.
    expect(comparesWorse(12, null, true, 1000)).toBeNull();
    expect(comparesWorse(null, 8, true, 1000)).toBeNull();
    expect(comparesWorse(null, null, false, 100)).toBeNull();
  });

  it("treats an exactly-equal value as not worse", () => {
    expect(comparesWorse(8, 8, true, 1000)).toBe(false);
    expect(comparesWorse(90, 90, false, 100)).toBe(false);
  });

  it("refuses a benchmark the indicator cannot reach", () => {
    // FIC's provincial reference was left uncapped in two provinces (Ilocos Sur 102.15, City of
    // Butuan 100.96) while every barangay FIC was capped at 100. Without this rule all 113 of
    // their barangays would read as "worse than province" — an artefact of the cleaning, not a
    // finding.
    expect(comparesWorse(100, 102.15, false, 100)).toBeNull();
    expect(comparesWorse(60, 100.96, false, 100)).toBeNull();
    // A rate legitimately above 100 is still comparable: only above its own maximum is not.
    expect(comparesWorse(300, 277, true, 1000)).toBe(true);
  });
});

describe("benchmarksArePlaceholder", () => {
  it("accepts a real benchmark set", () => {
    expect(benchmarksArePlaceholder([8, 20, 30, 90, 60, 60, 75])).toBe(false);
  });

  it("rejects the three shapes the source actually supplied", () => {
    // Agusan del Sur: every reference exactly 1. Cagayan: every one 0. BARMM's Special Geographic
    // Area: fractions where percentages were wanted. All three compare perfectly well and mean
    // nothing, which is why comparesWorse alone cannot catch them.
    expect(benchmarksArePlaceholder([1, 1, 1, 1, 1, 1, 1])).toBe(true);
    expect(benchmarksArePlaceholder([0, 0, 0, 0, 0, 0, 0])).toBe(true);
    expect(benchmarksArePlaceholder([0.04, 0.9, 0.12, 0.88, 0.7, 0.65, 0.8])).toBe(true);
  });

  it("rejects a set with nothing in it at all", () => {
    // Nueva Vizcaya and Zamboanga City supplied #N/A throughout — 57 barangays.
    expect(benchmarksArePlaceholder([null, null, null, null, null, null, null])).toBe(true);
  });

  it("accepts a set where a single real rate survives", () => {
    // The test is on the largest of the seven, not on all of them: a partial set is still a set
    // that criterion (d) can be run against, and treating it as fake would exclude barangays the
    // criteria page counts.
    expect(benchmarksArePlaceholder([null, null, 45, null, null, null, null])).toBe(false);
  });
});

describe("toBarangayDetail", () => {
  it("marks capped values and only those", () => {
    const d = toBarangayDetail(base, "BANAO");
    expect(d.health.find((h) => h.key === "water")?.capped).toBe(true);
    expect(d.health.find((h) => h.key === "fic")?.capped).toBe(false);
    expect(d.cappedCount).toBe(1);
  });

  it("compares each indicator in its own direction", () => {
    const d = toBarangayDetail(base, "BANAO");
    const by = Object.fromEntries(d.health.map((h) => [h.key, h.worseThanProvince]));
    expect(by.imr).toBe(true); // 12 vs 8 — higher mortality is worse
    expect(by.ufmr).toBe(false); // 15 vs 20 — lower mortality is better
    expect(by.fic).toBe(true); // 80 vs 90 — lower coverage is worse
    expect(by.water).toBe(false); // 100 vs 75 — higher coverage is better
  });

  it("flags an impossible benchmark instead of scoring against it", () => {
    const d = toBarangayDetail({ ...base, fic: 100, fic_prov_ref: 102.15 }, "X");
    const fic = d.health.find((h) => h.key === "fic");
    expect(fic?.benchmarkUnusable).toBe(true);
    expect(fic?.worseThanProvince).toBeNull();
    // The other indicators are unaffected.
    expect(d.health.find((h) => h.key === "imr")?.benchmarkUnusable).toBe(false);
  });

  it("draws no verdict at all where the province's benchmarks are placeholders", () => {
    // Plan U9. Until then this was the one surface that would score a barangay against Agusan del
    // Sur's all-ones reference and print "worse than province (1)" — while agg_uuc_phc_criteria
    // had already excluded that same barangay from route (d)'s denominator on the same rule. One
    // rule, three readers: the disclosure, the criteria aggregate and the distributions.
    const placeholder = toBarangayDetail(
      {
        ...base,
        imr_prov_ref: 1,
        ufmr_prov_ref: 1,
        fic_prov_ref: 1,
        abr_prov_ref: 1,
        pre_natal_prov_ref: 1,
        sba_prov_ref: 1,
        water_prov_ref: 1,
      },
      "X",
    );
    expect(placeholder.benchmarksPlaceholder).toBe(true);
    expect(placeholder.health.map((h) => h.worseThanProvince)).toEqual(
      new Array(7).fill(null) as (boolean | null)[],
    );
    // The figures are still carried — the page prints what the source supplied, it just draws no
    // conclusion from it.
    expect(placeholder.health.every((h) => h.provincialRef === 1)).toBe(true);
    expect(placeholder.health.every((h) => h.benchmarkPlaceholder)).toBe(true);
  });

  it("leaves a real benchmark set unflagged", () => {
    const d = toBarangayDetail(base, "X");
    expect(d.benchmarksPlaceholder).toBe(false);
    expect(d.health.some((h) => h.benchmarkPlaceholder)).toBe(false);
  });

  it("sums armed conflict and displacement for criterion (b), matching the source", () => {
    // The source marks the factor met when the two together reach 10%, which reproduces its own
    // Pass/Fail on every row. Neither alone reaches the threshold here.
    const d = toBarangayDetail({ ...base, armed_conf: 6, idp: 5 }, "X");
    const conflict = d.factors.find((f) => f.key === "conflict");
    expect(conflict?.value).toBe(11);
    expect(conflict?.met).toBe(true);
  });

  it("applies each factor's own threshold", () => {
    const d = toBarangayDetail(base, "X");
    const byKey = Object.fromEntries(d.factors.map((f) => [f.key, f]));
    expect(byKey.ip_pop.met).toBe(true); // 92% against a 10% threshold
    expect(byKey.four_ps.met).toBe(true); // 61% against a 50% threshold
    expect(byKey.conflict.met).toBe(false); // 0% against a 10% threshold
    expect(byKey.four_ps.threshold).toBe(50);
  });

  it("keeps a blank factor null rather than reading it as zero", () => {
    // A missing IP figure is not "no Indigenous Peoples" — it is unknown, and must not render as
    // a failed criterion.
    const d = toBarangayDetail({ ...base, ip_pop: null }, "X");
    const ip = d.factors.find((f) => f.key === "ip_pop");
    expect(ip?.value).toBeNull();
    expect(ip?.met).toBeNull();
  });

  it("keeps conflict null only when both of its inputs are missing", () => {
    expect(
      toBarangayDetail({ ...base, armed_conf: null, idp: null }, "X").factors.find(
        (f) => f.key === "conflict",
      )?.value,
    ).toBeNull();
    // One side present is still a usable sum — the other contributes nothing.
    expect(
      toBarangayDetail({ ...base, armed_conf: null, idp: 12 }, "X").factors.find(
        (f) => f.key === "conflict",
      )?.value,
    ).toBe(12);
  });

  it("exposes all seven health indicators, in order", () => {
    const d = toBarangayDetail(base, "X");
    expect(d.health.map((h) => h.key)).toEqual([
      "imr",
      "ufmr",
      "abr",
      "fic",
      "pre_natal",
      "sba",
      "water",
    ]);
  });
});
