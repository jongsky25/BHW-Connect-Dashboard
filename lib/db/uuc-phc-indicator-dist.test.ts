import { describe, expect, it } from "vitest";
import {
  BIN_COUNT,
  UUC_PHC_INDICATORS,
  benchmarkStateOf,
  toIndicatorDist,
  type Row,
} from "./uuc-phc-indicator-dist";
import { HEALTH_INDICATORS } from "./uuc-phc-indicators";

/**
 * The pure row → distribution mapping (plan U9).
 *
 * The cases that matter here are the ones a wrong rendering would make invisible: that the bounded
 * values stay countable inside the top bin rather than being folded into it, that the bar heights
 * are relative to the tallest bar and never to the area's list (which would flatten every
 * distribution that is actually spread out), and that a provincial benchmark is drawn only when it
 * is a benchmark — the two ways it can be present and useless are both real in this data and both
 * would render as a plausible line.
 */

/** Water at national grain: the real shape, with the 886 bounded values in the top bin. */
function row(over: Partial<Row> = {}): Row {
  return {
    geo_code: "PH",
    geo_level: "national",
    indicator: "water",
    value_max: 100,
    n_listed: 5991,
    bin_counts: [710, 115, 121, 142, 187, 202, 315, 374, 574, 3251],
    bin_capped: [0, 0, 0, 0, 0, 0, 0, 0, 0, 886],
    n_missing: 0,
    provincial_ref: null,
    n_comparable: 5765,
    n_worse: 2915,
    ...over,
  };
}

describe("UUC_PHC_INDICATORS", () => {
  it("covers all 12 indicators, the physical factor first and the seven health ones last", () => {
    expect(UUC_PHC_INDICATORS).toHaveLength(12);
    expect(UUC_PHC_INDICATORS[0].key).toBe("physical_factor");
    expect(UUC_PHC_INDICATORS.filter((m) => m.group === "socio")).toHaveLength(3 + 1);
    expect(UUC_PHC_INDICATORS.filter((m) => m.group === "health").map((m) => m.key)).toEqual(
      HEALTH_INDICATORS.map((m) => m.key),
    );
  });

  it("takes the health indicators' maxima from HEALTH_INDICATORS rather than restating them", () => {
    // `max` is the histogram's axis top AND the threshold comparesWorse refuses a benchmark above.
    // Two copies that drifted would put the axis and the comparison on different scales without
    // either looking wrong on its own.
    for (const health of HEALTH_INDICATORS) {
      const meta = UUC_PHC_INDICATORS.find((m) => m.key === health.key);
      expect(meta?.max, health.key).toBe(health.max);
      expect(meta?.higherIsWorse, health.key).toBe(health.higherIsWorse);
    }
  });

  it("gives the five indicators criterion (d) does not test no direction at all", () => {
    // null rather than false: "criterion (d) does not ask this" and "a lower value is worse" are
    // different statements, and the page renders no comparison for the first.
    for (const key of ["physical_factor", "ip_pop", "armed_conf", "idp", "four_ps"]) {
      expect(UUC_PHC_INDICATORS.find((m) => m.key === key)?.higherIsWorse, key).toBeNull();
    }
  });
});

describe("toIndicatorDist", () => {
  it("keeps the bounded values countable inside the top bin", () => {
    // The whole increment. 886 of the top bin's 3,251 barangays are values the source recorded
    // above 100 and cleaning bounded to it; folding them into the bar would reproduce exactly what
    // a mean does to them.
    const dist = toIndicatorDist(row())!;
    const top = dist.bins[BIN_COUNT - 1];
    expect(top.count).toBe(3251);
    expect(top.capped).toBe(886);
    expect(dist.cappedTotal).toBe(886);
    expect(dist.bins.slice(0, -1).every((b) => b.capped === 0)).toBe(true);
  });

  it("closes the top bin inclusive and no other", () => {
    // A capped value *is* value_max, so it only lands in the top bin because that bin includes its
    // own upper edge. Every other bin is half-open.
    const bins = toIndicatorDist(row())!.bins;
    expect(bins.map((b) => b.inclusive)).toEqual([...new Array(9).fill(false), true]);
    expect(bins[0].lo).toBe(0);
    expect(bins[9].hi).toBe(100);
  });

  it("lays equal-width bins over the indicator's own domain", () => {
    // Rates per 1,000 get a 0–1,000 axis, coverage percentages 0–100. Equal width within each: an
    // unequal one would render the zero-inflated rates as a spread-out distribution when they are
    // a spike, which misstates density by construction.
    const rate = toIndicatorDist(
      row({ indicator: "imr", value_max: 1000, bin_counts: [5919, 47, 13, 5, 0, 1, 1, 0, 0, 5] }),
    )!;
    expect(rate.bins.map((b) => b.hi - b.lo)).toEqual(new Array(10).fill(100));
    expect(toIndicatorDist(row())!.bins.map((b) => b.hi - b.lo)).toEqual(new Array(10).fill(10));
  });

  it("scales bars against the tallest bin, not against the area's list", () => {
    // Scaling ten bars to n_listed would push every one of them near zero wherever the values are
    // spread out — which is most indicators, and exactly the ones whose shape is worth seeing.
    const dist = toIndicatorDist(row())!;
    expect(dist.bins[9].fraction).toBe(1);
    expect(dist.bins[0].fraction).toBeCloseTo(710 / 3251, 6);
    expect(Math.max(...dist.bins.map((b) => b.fraction))).toBe(1);
  });

  it("gives an empty area zero-height bars rather than dividing by zero", () => {
    const dist = toIndicatorDist(
      row({
        geo_code: "13",
        geo_level: "region",
        n_listed: 0,
        bin_counts: new Array(10).fill(0),
        bin_capped: new Array(10).fill(0),
        n_comparable: 0,
        n_worse: 0,
      }),
    )!;
    expect(dist.bins.every((b) => b.fraction === 0)).toBe(true);
    expect(dist.cappedTotal).toBe(0);
    expect(dist.nNotComparable).toBe(0);
  });

  it("derives the not-comparable count rather than trusting a stored one", () => {
    const dist = toIndicatorDist(row())!;
    expect(dist.nComparable).toBe(5765);
    expect(dist.nNotComparable).toBe(5991 - 5765);
  });

  it("drops an indicator this build does not know", () => {
    // A row written by a newer migration than the deployed code. Rendering a histogram with no
    // label, no unit and no idea whether criterion (d) tests it is worse than omitting it.
    expect(toIndicatorDist(row({ indicator: "fp_cu" }))).toBeNull();
  });
});

describe("benchmarkStateOf", () => {
  const water = UUC_PHC_INDICATORS.find((m) => m.key === "water")!;
  const ip = UUC_PHC_INDICATORS.find((m) => m.key === "ip_pop")!;

  it("draws a usable provincial benchmark", () => {
    expect(benchmarkStateOf(water, "province", 71.28, 107, 107)).toBe("drawn");
    expect(benchmarkStateOf(water, "citymun", 71.28, 12, 12)).toBe("drawn");
  });

  it("draws nothing for an indicator criterion (d) does not test", () => {
    expect(benchmarkStateOf(ip, "province", 40, 107, 0)).toBe("none");
  });

  it("distinguishes an area with no single province from one with no benchmark", () => {
    // Both render as "no line", and they are entirely different statements: a region spans 87
    // benchmarks by construction, while Nueva Vizcaya supplied none. Collapsing them would hide a
    // data-quality finding behind a geometric fact.
    expect(benchmarkStateOf(water, "national", null, 5991, 5765)).toBe("aggregate");
    expect(benchmarkStateOf(water, "region", null, 399, 380)).toBe("aggregate");
    expect(benchmarkStateOf(water, "province", null, 50, 0)).toBe("missing");
  });

  it("refuses a benchmark above the indicator's own ceiling", () => {
    // Ilocos Sur's FIC benchmark is 102.15 and City of Butuan's 100.96, against barangay values
    // capped at 100 — the plan's Verify case. A line there would sit off the end of the axis and
    // mark all 113 barangays worse than their province by construction.
    const fic = UUC_PHC_INDICATORS.find((m) => m.key === "fic")!;
    expect(benchmarkStateOf(fic, "province", 102.15, 107, 0)).toBe("unreachable");
    expect(benchmarkStateOf(fic, "province", 100.96, 6, 0)).toBe("unreachable");
    // The same province's Water benchmark is fine — the exclusion is per indicator, not per area.
    expect(benchmarkStateOf(water, "province", 71.28, 107, 107)).toBe("drawn");
  });

  it("refuses a benchmark that compares fine and means nothing", () => {
    // Agusan del Sur's every-value-1 set. It is inside the indicator's range, so `unreachable`
    // cannot catch it; n_comparable being 0 with a benchmark present is what does.
    expect(benchmarkStateOf(water, "province", 1, 156, 0)).toBe("placeholder");
    expect(benchmarkStateOf(water, "province", 0, 12, 0)).toBe("placeholder");
  });

  it("says nothing at all about an area with nothing listed", () => {
    expect(benchmarkStateOf(water, "province", null, 0, 0)).toBe("none");
  });
});
