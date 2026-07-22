import { describe, expect, it } from "vitest";
import { peerRankSentence } from "./peer-rank-chip";

const baseRank = { nSiblings: 40, nTotal: 100 };

describe("peerRankSentence", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [101, "101st"],
    [111, "111th"],
  ])("renders rank %i as %s", (rankPosition, expected) => {
    const sentence = peerRankSentence({
      rank: { ...baseRank, rankPosition },
      geoName: "Manila",
      parentName: "Metro Manila",
      siblingPlural: "cities/municipalities",
      indicatorLabel: "% accredited",
    });
    expect(sentence).toContain(expected);
  });

  it("names the geo and parent when geoName is given", () => {
    const sentence = peerRankSentence({
      rank: { ...baseRank, rankPosition: 3 },
      geoName: "Manila",
      parentName: "Metro Manila",
      siblingPlural: "cities/municipalities",
      indicatorLabel: "% accredited",
    });
    expect(sentence).toBe(
      "On % accredited, Manila ranks 3rd of 40 cities/municipalities in Metro Manila.",
    );
  });

  it("omits the geo name and rephrases when geoName is not given", () => {
    const sentence = peerRankSentence({
      rank: { ...baseRank, rankPosition: 3 },
      parentName: "Metro Manila",
      siblingPlural: "cities/municipalities",
      indicatorLabel: "% accredited",
    });
    expect(sentence).toBe("Ranks 3rd of 40 cities/municipalities in Metro Manila on % accredited.");
  });

  it("omits the '... in {parentName}' clause when parentName is null", () => {
    const sentence = peerRankSentence({
      rank: { ...baseRank, rankPosition: 1 },
      geoName: "Region VII",
      parentName: null,
      siblingPlural: "regions",
      indicatorLabel: "% accredited",
    });
    expect(sentence).toBe("On % accredited, Region VII ranks 1st of 40 regions.");
  });

  it("returns null when there is no rank row", () => {
    expect(
      peerRankSentence({
        rank: null,
        geoName: "Manila",
        parentName: null,
        siblingPlural: "cities/municipalities",
        indicatorLabel: "% accredited",
      }),
    ).toBeNull();
  });

  it("returns null when rankPosition or nSiblings is missing", () => {
    expect(
      peerRankSentence({
        rank: { rankPosition: null, nSiblings: 40, nTotal: 100 },
        geoName: "Manila",
        parentName: null,
        siblingPlural: "cities/municipalities",
        indicatorLabel: "% accredited",
      }),
    ).toBeNull();
    expect(
      peerRankSentence({
        rank: { rankPosition: 1, nSiblings: null, nTotal: 100 },
        geoName: "Manila",
        parentName: null,
        siblingPlural: "cities/municipalities",
        indicatorLabel: "% accredited",
      }),
    ).toBeNull();
  });

  it("returns null when nTotal is below MIN_LEADER_N (small-sample suppression)", () => {
    expect(
      peerRankSentence({
        rank: { rankPosition: 1, nSiblings: 40, nTotal: 10 },
        geoName: "Manila",
        parentName: null,
        siblingPlural: "cities/municipalities",
        indicatorLabel: "% accredited",
      }),
    ).toBeNull();
  });
});
