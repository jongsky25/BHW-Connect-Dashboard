import { describe, expect, it } from "vitest";
import { figureFromPayloads } from "./figure-from-payload";

const distribution = (over: Record<string, unknown> = {}) => ({
  parent: { geoCode: "07", geoLevel: "region", geoName: "Region VII" },
  indicator: { key: "pct_accredited", label: "% accredited", unit: "percent" },
  counts: { children: 4, withValue: 3, missing: 1, smallSample: 0 },
  highest: [
    { geoName: "Cebu", value: 70, nTotal: 900, smallSample: false },
    { geoName: "Bohol", value: 55, nTotal: 400, smallSample: false },
  ],
  lowest: [],
  ...over,
});

const peerContext = (over: Record<string, unknown> = {}) => ({
  geo: { geoCode: "150701000", geoLevel: "province", geoName: "Basilan" },
  indicator: { key: "pct_accredited", label: "% accredited", unit: "percent" },
  peer: { ranked: true, rankPosition: 12, nSiblings: 81, siblingPlural: "provinces" },
  benchmark: {
    self: 45.2,
    region: { geoName: "BARMM", value: 48 },
    national: { value: 51 },
  },
  warnings: [],
  ...over,
});

describe("figureFromPayloads", () => {
  it("plots the ranked children of a distribution", () => {
    const figure = figureFromPayloads([distribution()])!;
    expect(figure.from).toBe("getDistribution");
    expect(figure.data).toEqual([
      { label: "Cebu", value: 70 },
      { label: "Bohol", value: 55 },
    ]);
    expect(figure.valueSuffix).toBe("%");
  });

  it("plots this place against its region and the nation", () => {
    const figure = figureFromPayloads([peerContext()])!;
    expect(figure.from).toBe("getPeerContext");
    expect(figure.data).toEqual([
      { label: "Basilan", value: 45.2 },
      { label: "BARMM", value: 48 },
      { label: "Philippines", value: 51 },
    ]);
    expect(figure.headline).toContain("12 of 81 provinces");
  });

  /**
   * The property the whole module exists for: values are read from the payload, never parsed out
   * of the model's prose. A figure a model authored could be confidently wrong and still pass
   * every audit, because the numbers in it would be real numbers from somewhere else.
   */
  it("takes every plotted value from the payload", () => {
    const payload = distribution();
    const figure = figureFromPayloads([payload])!;
    const source = payload.highest.map((r) => r.value);
    expect(figure.data.map((d) => d.value)).toEqual(source.slice(0, figure.data.length));
  });

  // insights.ts refuses to crown a leader below MIN_LEADER_N; a bar chart makes such a leader look
  // authoritative, which is worse than a sentence doing it.
  it("leaves small-sample children out and says how many", () => {
    const figure = figureFromPayloads([
      distribution({
        highest: [
          { geoName: "Tiny", value: 100, nTotal: 3, smallSample: true },
          { geoName: "Cebu", value: 70, nTotal: 900, smallSample: false },
        ],
      }),
    ])!;
    expect(figure.data.map((d) => d.label)).toEqual(["Cebu"]);
    expect(figure.notes.join(" ")).toMatch(/too few validated profiles/);
  });

  it("notes children that have no value for the indicator", () => {
    expect(figureFromPayloads([distribution()])!.notes.join(" ")).toMatch(
      /no value for this indicator/,
    );
  });

  it("returns nothing when every child is small-sample", () => {
    expect(
      figureFromPayloads([
        distribution({ highest: [{ geoName: "Tiny", value: 100, nTotal: 3, smallSample: true }] }),
      ]),
    ).toBeNull();
  });

  // One bar is not a comparison, and "versus what?" is the entire purpose of this figure.
  it("refuses a peer chart with only the place's own value", () => {
    expect(
      figureFromPayloads([
        peerContext({ benchmark: { self: 45.2, region: null, national: null } }),
      ]),
    ).toBeNull();
  });

  /**
   * A queryDataset result is a table, not a series: choosing the label and measure columns would
   * be a guess, and a chart with the wrong column as its measure survives every audit because all
   * its numbers are real.
   */
  it("does not plot a queryDataset result", () => {
    expect(
      figureFromPayloads([
        {
          table: "agg_poverty",
          grain: "one geography x SAE year",
          mode: "rows",
          rows: [{ geo_code: "07", poverty_incidence: 21.4 }],
        },
      ]),
    ).toBeNull();
  });

  it("skips a refusal payload", () => {
    expect(figureFromPayloads([{ error: "Table agg_secret is not registered." }])).toBeNull();
  });

  it("caps the number of bars", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      geoName: `P${i}`,
      value: 100 - i,
      nTotal: 500,
      smallSample: false,
    }));
    expect(figureFromPayloads([distribution({ highest: many })])!.data.length).toBeLessThanOrEqual(
      8,
    );
  });

  it("takes the first plottable payload rather than judging between them", () => {
    const figure = figureFromPayloads([peerContext(), distribution()])!;
    expect(figure.from).toBe("getPeerContext");
  });

  it("returns null when nothing is plottable", () => {
    expect(figureFromPayloads([])).toBeNull();
    expect(figureFromPayloads([{ geoName: "Basilan", totalBhw: 900 }])).toBeNull();
  });
});
