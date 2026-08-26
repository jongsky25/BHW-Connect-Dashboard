import { describe, expect, it } from "vitest";
import { wrapNames } from "./uuc-phc-figure";

/**
 * SVG does not wrap text: a line longer than the canvas runs off the edge silently, with no
 * error and no clipping to notice. The one-pager names every listed barangay of a town, so this
 * packing is what keeps a 40-barangay municipality on the page.
 */
describe("wrapNames", () => {
  it("packs names onto as few lines as fit", () => {
    expect(wrapNames(["AAA", "BBB", "CCC"], 20)).toEqual(["AAA, BBB, CCC"]);
  });

  it("breaks to a new line rather than exceeding the width", () => {
    const lines = wrapNames(["AAAAA", "BBBBB", "CCCCC"], 13);
    expect(lines).toEqual(["AAAAA, BBBBB", "CCCCC"]);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(13);
  });

  it("keeps a name that is itself too long rather than dropping it", () => {
    // Truncating would silently remove a barangay from a sheet that claims to list them all.
    const lines = wrapNames(["SHORT", "AN-EXTREMELY-LONG-BARANGAY-NAME"], 10);
    expect(lines).toEqual(["SHORT", "AN-EXTREMELY-LONG-BARANGAY-NAME"]);
  });

  it("returns nothing for no names", () => {
    expect(wrapNames([], 40)).toEqual([]);
  });

  it("never loses a name", () => {
    const names = Array.from({ length: 37 }, (_, i) => `BARANGAY-${i}`);
    const rejoined = wrapNames(names, 45).join(", ").split(", ");
    expect(rejoined).toEqual(names);
  });
});
