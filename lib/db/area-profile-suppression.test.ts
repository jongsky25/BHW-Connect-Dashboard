import { describe, expect, it } from "vitest";
import { applyComplementarySuppression, type SuppressibleCell } from "./area-profile-suppression";

const cell = (
  dimension: string,
  category: string,
  n: number | null,
  isSuppressed = false,
): SuppressibleCell => ({
  dimension,
  category,
  n,
  pct: n === null ? null : n,
  isSuppressed,
});

/** Can an attacker who knows the group total solve for a suppressed cell? Only if exactly one
 * cell is unknown. This is the property the whole module exists to deny. */
function solvable(rows: readonly SuppressibleCell[]): boolean {
  return rows.filter((r) => r.n === null).length === 1;
}

describe("applyComplementarySuppression", () => {
  /**
   * The attack, concretely. `build_aggregates.sql` nulls the small cell; `agg_bhw_counts.n_total`
   * publishes 43. Female = 43 − 40 = 3, and the suppression has bought nothing.
   */
  it("closes the differencing path a single suppressed cell leaves open", () => {
    const input = [cell("sex", "Male", 40), cell("sex", "Female", null, true)];
    expect(solvable(input)).toBe(true);

    const { rows } = applyComplementarySuppression(input);

    expect(solvable(rows)).toBe(false);
    expect(rows.find((r) => r.category === "Male")).toMatchObject({
      n: null,
      pct: null,
      isSuppressed: true,
      suppressedBy: "complement",
    });
  });

  // `pct × total` reconstructs `n` exactly, so nulling one without the other protects nothing —
  // the same reason the ingestion pass nulls both.
  it("nulls pct alongside n on the complement", () => {
    const { rows } = applyComplementarySuppression([
      cell("sex", "Male", 40),
      cell("sex", "Female", null, true),
    ]);
    expect(rows.every((r) => r.pct === null)).toBe(true);
  });

  it("chooses the smallest visible positive cell, losing the least information", () => {
    const { rows } = applyComplementarySuppression([
      cell("education", "College", 50),
      cell("education", "High School", 12),
      cell("education", "Elementary", 80),
      cell("education", "Vocational", null, true),
    ]);
    expect(rows.find((r) => r.suppressedBy === "complement")?.category).toBe("High School");
    expect(rows.find((r) => r.category === "College")?.n).toBe(50);
  });

  it("leaves a group with nothing suppressed untouched", () => {
    const input = [cell("sex", "Male", 40), cell("sex", "Female", 30)];
    const { rows, notes } = applyComplementarySuppression(input);
    expect(rows.every((r) => r.n !== null && r.suppressedBy === null)).toBe(true);
    expect(notes).toEqual([]);
  });

  it("leaves a group that already has two unknowns untouched", () => {
    const { rows } = applyComplementarySuppression([
      cell("sex", "Male", 40),
      cell("sex", "Female", null, true),
      cell("sex", "Unknown", null, true),
    ]);
    expect(rows.filter((r) => r.n === null)).toHaveLength(2);
    expect(rows.some((r) => r.suppressedBy === "complement")).toBe(false);
  });

  /** A known zero adds no ambiguity: the attacker's sum is unchanged whether or not it is hidden. */
  it("does not pick a visible zero as the complement", () => {
    const { rows, unprotectable } = applyComplementarySuppression([
      cell("ip_status", "Non-IP", 0),
      cell("ip_status", "IP", null, true),
    ]);
    expect(rows.find((r) => r.category === "Non-IP")?.n).toBe(0);
    expect(unprotectable).toEqual(["ip_status"]);
  });

  // Honesty over the appearance of protection: when nothing can be withheld, say so.
  it("reports a group it cannot protect instead of pretending it did", () => {
    const { unprotectable, notes } = applyComplementarySuppression([
      cell("sex", "Female", null, true),
    ]);
    expect(unprotectable).toEqual(["sex"]);
    expect(notes.join(" ")).toMatch(/still derivable from the group total/);
  });

  it("treats each dimension independently", () => {
    const { rows } = applyComplementarySuppression([
      cell("sex", "Male", 40),
      cell("sex", "Female", null, true),
      cell("civil_status", "Single", 20),
      cell("civil_status", "Married", 23),
    ]);
    const civil = rows.filter((r) => r.dimension === "civil_status");
    expect(civil.every((r) => r.n !== null)).toBe(true);
    expect(rows.filter((r) => r.dimension === "sex").every((r) => r.n === null)).toBe(true);
  });

  it("explains the withholding rather than silently thinning the breakdown", () => {
    const { notes } = applyComplementarySuppression([
      cell("sex", "Male", 40),
      cell("sex", "Female", null, true),
    ]);
    expect(notes.join(" ")).toMatch(/cannot be recovered by subtracting from the total/);
  });

  it("marks pre-existing suppressions as small-cell, not as complements", () => {
    const { rows } = applyComplementarySuppression([
      cell("sex", "Male", 40),
      cell("sex", "Female", null, true),
    ]);
    expect(rows.find((r) => r.category === "Female")?.suppressedBy).toBe("small-cell");
  });

  it("returns every input row, in dimension groups", () => {
    const input = [
      cell("sex", "Male", 40),
      cell("sex", "Female", null, true),
      cell("civil_status", "Single", 20),
    ];
    const { rows } = applyComplementarySuppression(input);
    expect(rows).toHaveLength(input.length);
    expect(new Set(rows.map((r) => r.category))).toEqual(new Set(["Male", "Female", "Single"]));
  });

  it("handles an empty input", () => {
    expect(applyComplementarySuppression([])).toEqual({ rows: [], unprotectable: [], notes: [] });
  });
});
