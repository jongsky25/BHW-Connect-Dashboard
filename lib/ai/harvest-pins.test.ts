import { describe, expect, it } from "vitest";
import { addressesIn, derivePins, deriveSelector } from "./harvest-pins";

/**
 * §10.1 route 3's figure derivation.
 *
 * The payloads below are the real shapes the public tools return, trimmed. That matters: the whole
 * question this module answers is whether a *harvested* answer can be pinned at all, and the answer
 * turned on two properties of these particular shapes — that `getIndicatorByGeo` puts its counts on
 * the root and its breakdown in an array named after the indicator, and that the same breakdown is
 * reachable a second way through the standalone tool. A fixture that flattened either would test a
 * payload nothing returns.
 *
 * Run against the seven approved answers in production this pins 37 of their 41 distinct numbers.
 * The four it does not are the two ambiguities and the two prose numbers exercised below.
 */

const DEMOGRAPHICS = {
  geoCode: "PH",
  geoLevel: "national",
  geoName: "Philippines",
  totalBhw: 306835,
  validatedProfiles: 270917,
  profilingCoveragePct: 97,
  demographics: [
    { dimension: "ip_status", category: "YES", n: 30600, pct: 11.29, isSuppressed: false },
    { dimension: "ip_status", category: "NO", n: 240317, pct: 88.71, isSuppressed: false },
    { dimension: "sex", category: "Female", n: 261684, pct: 96.59, isSuppressed: false },
  ],
};

const HONORARIUM_ROWS = {
  rows: [
    { payerLevel: "barangay", nReceiving: 241712, pctReceiving: 89.22, avgMonthlyAmount: 1290.81 },
    { payerLevel: "region", nReceiving: 5054, pctReceiving: 1.87, avgMonthlyAmount: 3698.2 },
  ],
};

/** The same array, reached through the indicator tool instead. */
const HONORARIUM_INDICATOR = {
  geoCode: "PH",
  totalBhw: 306835,
  honorarium: HONORARIUM_ROWS.rows,
};

const TRAINING = {
  rows: [
    {
      topicSlug: "filariasis",
      topicLabel: "Filariasis",
      nTrained: 8485,
      nTotal: 270917,
      coveragePct: 3.13,
    },
    {
      topicSlug: "malaria",
      topicLabel: "Malaria",
      nTrained: 9328,
      nTotal: 270917,
      coveragePct: 3.44,
    },
  ],
};

describe("deriveSelector", () => {
  it("names a row by the smallest string key that identifies it", () => {
    expect(deriveSelector(HONORARIUM_ROWS.rows, 0)).toEqual({ payerLevel: "barangay" });
  });

  it("falls back to a pair when no single key is unique", () => {
    const rows = [
      { dimension: "sex", category: "Female" },
      { dimension: "sex", category: "Male" },
      { dimension: "ip", category: "Female" },
    ];
    expect(deriveSelector(rows, 0)).toEqual({ dimension: "sex", category: "Female" });
  });

  it("never keys a selector on a measure, even when the measure would identify the row", () => {
    // A selector keyed on a number would put the very figure being checked into the thing that
    // selects the row to check it in. `n` is unique here and is still not used.
    const rows = [{ n: 1 }, { n: 2 }];
    expect(deriveSelector(rows, 0)).toBeNull();
  });

  it("gives up rather than inventing a positional selector", () => {
    const rows = [
      { label: "same", n: 1 },
      { label: "same", n: 2 },
    ];
    expect(deriveSelector(rows, 0)).toBeNull();
  });
});

describe("addressesIn", () => {
  it("reaches root scalars and every array of rows, naming the array unless it is `rows`", () => {
    const found = addressesIn(0, "getIndicatorByGeo", DEMOGRAPHICS);
    expect(found).toContainEqual({
      call: 0,
      tool: "getIndicatorByGeo",
      from: null,
      where: null,
      field: "totalBhw",
      value: 306835,
    });
    expect(found).toContainEqual({
      call: 0,
      tool: "getIndicatorByGeo",
      from: "demographics",
      where: { category: "YES" },
      field: "n",
      value: 30600,
    });
    // `rows` is written as an absent `from`, so a derived pin has the same shape route 1 wrote by
    // hand and the ten seeded cases keep parsing under one rule.
    expect(addressesIn(0, "getHonorariumStats", HONORARIUM_ROWS)).toContainEqual({
      call: 0,
      tool: "getHonorariumStats",
      from: null,
      where: { payerLevel: "region" },
      field: "pctReceiving",
      value: 1.87,
    });
  });

  it("ignores non-numeric fields, since only a number can be pinned", () => {
    const fields = addressesIn(0, "t", TRAINING).map((a) => a.field);
    expect(fields).not.toContain("topicLabel");
    expect(fields).toContain("nTrained");
  });

  it("returns nothing for a refusal payload", () => {
    expect(addressesIn(0, "getIndicatorByGeo", { error: "No data found." })).toEqual([]);
  });
});

describe("derivePins", () => {
  it("pins a figure the answer is actually about, inside a named array", () => {
    const { pins } = derivePins("Nationwide, 30,600 BHWs (11.29%) identify as Indigenous People.", [
      { name: "getIndicatorByGeo", payload: DEMOGRAPHICS },
    ]);
    expect(pins.map((p) => p.expectation)).toEqual([
      {
        call: 0,
        tool: "getIndicatorByGeo",
        from: "demographics",
        where: { category: "YES" },
        field: "n",
        value: 30600,
      },
      {
        call: 0,
        tool: "getIndicatorByGeo",
        from: "demographics",
        where: { category: "YES" },
        field: "pct",
        value: 11.29,
      },
    ]);
  });

  it("pins the earliest call when one quantity is reachable through two of them", () => {
    // The honorarium array the standalone tool returns is the same array the indicator tool
    // embeds. Two addresses, one quantity — the same selector and the same field — so this is not
    // an ambiguity, and the call the answer's own tool loop made first is the one pinned.
    const { pins, ambiguous } = derivePins("89.22% receive an honorarium from their barangay.", [
      { name: "getHonorariumStats", payload: HONORARIUM_ROWS },
      { name: "getIndicatorByGeo", payload: HONORARIUM_INDICATOR },
    ]);
    expect(ambiguous).toEqual([]);
    expect(pins[0].expectation).toMatchObject({
      call: 0,
      tool: "getHonorariumStats",
      field: "pctReceiving",
    });
    expect(pins[0].addresses).toHaveLength(2);
  });

  it("declines a number whose addresses disagree about which quantity it is", () => {
    // 270,917 is `validatedProfiles` on the root and `nTotal` on every training row. Different
    // fields on different rows: the same value today, not the same quantity. Pinning either would
    // record a claim the sentence never made, and a later divergence would report a regression in a
    // figure the answer was not about.
    const { pins, ambiguous } = derivePins("270,917 validated profiles.", [
      { name: "getTrainingCoverage", payload: TRAINING },
      { name: "getIndicatorByGeo", payload: DEMOGRAPHICS },
    ]);
    expect(pins).toEqual([]);
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0].value).toBe(270917);
  });

  it("reports a prose number as unmatched rather than rounding it onto a field", () => {
    // The audit admits "near 100%" through its rounding rule. A pin has no such rule: an expected
    // value that was never in a payload would fail on its first replay.
    const { pins, unmatched } = derivePins(
      "Field completeness is near 100%, and coverage is 97%.",
      [{ name: "getIndicatorByGeo", payload: DEMOGRAPHICS }],
    );
    expect(unmatched).toContain(100);
    expect(pins.map((p) => p.expectation.value)).toEqual([97]);
  });

  it("does not match a rounded figure onto the number the answer stated", () => {
    const { pins, unmatched } = derivePins("about 11% identify as Indigenous People", [
      { name: "getIndicatorByGeo", payload: DEMOGRAPHICS },
    ]);
    expect(pins).toEqual([]);
    expect(unmatched).toEqual([11]);
  });

  it("keeps the call index aligned with the recorded calls, failed ones included", () => {
    // Same rule as `replayCase`: an expectation names its call by index, so a skipped entry would
    // shift every pin onto the wrong call.
    const { pins } = derivePins("306,835 total BHWs.", [
      { name: "getGone", payload: undefined },
      { name: "getIndicatorByGeo", payload: DEMOGRAPHICS },
    ]);
    expect(pins[0].expectation.call).toBe(1);
  });

  it("pins nothing from an answer whose calls all refused", () => {
    const { pins, unmatched } = derivePins("There are 306,835 BHWs.", [
      { name: "getIndicatorByGeo", payload: { error: "No data found for geo_code XX." } },
    ]);
    expect(pins).toEqual([]);
    expect(unmatched).toEqual([306835]);
  });
});
