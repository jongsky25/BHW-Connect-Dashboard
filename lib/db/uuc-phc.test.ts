import { describe, expect, it } from "vitest";
import { toUucPhcCounts, uucContextSentence, uucPhcAreaHref, type Row } from "./uuc-phc";

/** National: 5,991 of the country's 41,958 barangays are on the 2025 list. */
const national: Row = {
  geo_code: "PH",
  geo_level: "national",
  n_listed: 5991,
  n_barangays: 41958,
};

/** MAYOYAO, Ifugao (1402706) — every one of its 27 barangays is on the list. */
const mayoyao: Row = {
  geo_code: "1402706",
  geo_level: "citymun",
  n_listed: 27,
  n_barangays: 27,
};

/** A city with barangays but none listed — a real row reading zero, not a missing row. */
const noneListed: Row = {
  geo_code: "1380601",
  geo_level: "citymun",
  n_listed: 0,
  n_barangays: 39,
};

describe("toUucPhcCounts", () => {
  it("derives the share from the dim_geo barangay denominator", () => {
    const c = toUucPhcCounts(national);
    expect(c.nListed).toBe(5991);
    expect(c.nBarangays).toBe(41958);
    // 5,991 / 41,958 = 14.28% → 14
    expect(c.sharePct).toBe(14);
    expect(c.fraction).toBeCloseTo(0.1428, 4);
  });

  it("reads a fully-listed area as 100%, filling the bar exactly once", () => {
    const c = toUucPhcCounts(mayoyao);
    expect(c.sharePct).toBe(100);
    expect(c.fraction).toBe(1);
  });

  it("distinguishes 'none listed' from 'no data': zero is a real share", () => {
    const c = toUucPhcCounts(noneListed);
    expect(c.nListed).toBe(0);
    expect(c.nBarangays).toBe(39);
    // Not null — the area was covered and none of its barangays are on the list.
    expect(c.sharePct).toBe(0);
    expect(c.fraction).toBe(0);
  });

  it("returns a null share, not a division by zero, when the area has no barangays", () => {
    const c = toUucPhcCounts({
      geo_code: "9999999",
      geo_level: "citymun",
      n_listed: 0,
      n_barangays: 0,
    });
    expect(c.sharePct).toBeNull();
    expect(c.fraction).toBe(0);
  });

  it("clamps the bar fraction at 1 even on impossible input", () => {
    // n_listed > n_barangays cannot happen (a listed barangay is one of the area's own, and the
    // load verifies it), but the bar must not overflow its track if the data ever says otherwise.
    const c = toUucPhcCounts({
      geo_code: "0000000",
      geo_level: "citymun",
      n_listed: 5,
      n_barangays: 3,
    });
    expect(c.fraction).toBe(1);
    expect(c.sharePct).toBe(167);
  });

  it("carries the geo identity through unchanged", () => {
    const c = toUucPhcCounts(mayoyao);
    expect(c.geoCode).toBe("1402706");
    expect(c.geoLevel).toBe("citymun");
  });
});

/**
 * The `/explore` and `/place/*` context chip (U12a). The sentence is the only place this dataset
 * speaks on a page about another one, so what it must never do is state a barangay count in a way
 * a reader takes for a BHW figure, or go quiet in a way that hides a real zero.
 */
describe("uucContextSentence", () => {
  it("states the count, the denominator and the universe in one sentence", () => {
    expect(uucContextSentence(toUucPhcCounts(national))).toBe(
      "5,991 of this area's 41,958 barangays are on the 2025 UUC for PHC list",
    );
  });

  it("names barangays as the universe, since the host page's figures are about BHW profiles", () => {
    // The whole reason U12a is a sentence and not a colour ramp: the denominator changes when a
    // reader's eye moves from the BHW figures above it to this line, and the line has to say so.
    expect(uucContextSentence(toUucPhcCounts(national))).toContain("barangays");
  });

  it("renders a zero as a statement rather than disappearing", () => {
    // NCR: a real row reading 0 of 1,675. A chip that vanished here would be indistinguishable
    // from one that failed to load.
    const ncr = uucContextSentence(
      toUucPhcCounts({ geo_code: "13", geo_level: "region", n_listed: 0, n_barangays: 1675 }),
    );
    expect(ncr).toBe("None of this area's 1,675 barangays are on the 2025 UUC for PHC list");
  });

  it("agrees with itself grammatically on a single listed barangay", () => {
    expect(
      uucContextSentence(
        toUucPhcCounts({ geo_code: "0102801", geo_level: "citymun", n_listed: 1, n_barangays: 14 }),
      ),
    ).toBe("1 of this area's 14 barangays is on the 2025 UUC for PHC list");
  });

  it("says nothing when there is no row — a read failure or a level the aggregate skips", () => {
    // `agg_uuc_phc_counts` stops at citymun, so a barangay geo has no row at all. Neither that nor
    // a failed read is a statement about the area.
    expect(uucContextSentence(null)).toBeNull();
  });

  it("says nothing when the area has no barangays to count against", () => {
    expect(
      uucContextSentence(
        toUucPhcCounts({ geo_code: "9999999", geo_level: "citymun", n_listed: 0, n_barangays: 0 }),
      ),
    ).toBeNull();
  });
});

describe("uucPhcAreaHref", () => {
  it("sends the national chip to the section landing page, not a /national/PH route", () => {
    expect(uucPhcAreaHref("national", "PH")).toBe("/uuc-phc");
  });

  it.each([
    ["region", "13", "/uuc-phc/region/13"],
    ["province", "14027", "/uuc-phc/province/14027"],
    ["citymun", "1402706", "/uuc-phc/citymun/1402706"],
  ] as const)("links a %s to its area page", (level, code, expected) => {
    expect(uucPhcAreaHref(level, code)).toBe(expected);
  });
});
