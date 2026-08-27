import { describe, expect, it } from "vitest";
import { QUALIFYING_ROUTES, toUucPhcCriteria, type Row } from "./uuc-phc-criteria";

/**
 * The pure row → routes mapping (plan U7).
 *
 * The cases that matter here are the ones a wrong rendering would make invisible: that the four
 * route shares are allowed to sum past 100% (they overlap, and a renderer must not "fix" that),
 * that route (d) is a share of a *different* denominator from the other three, and that a zero
 * denominator gives a null share rather than a 0% one — "no barangay qualified" and "the question
 * cannot be asked here" are different statements and must not collapse into each other.
 */

function row(over: Partial<Row> = {}): Row {
  return {
    geo_code: "PH",
    geo_level: "national",
    n_listed: 100,
    n_route_ip: 0,
    n_route_conflict: 0,
    n_route_four_ps: 0,
    n_route_health: 0,
    n_health_evaluable: 100,
    ...over,
  };
}

describe("toUucPhcCriteria", () => {
  it("exposes the four routes of AO §VI.A in the order the order lists them", () => {
    const routes = toUucPhcCriteria(row()).routes;
    expect(routes.map((r) => r.key)).toEqual(["ip", "conflict", "fourPs", "health"]);
    expect(routes.map((r) => r.criterion)).toEqual(["a", "b", "c", "d"]);
    expect(routes).toHaveLength(QUALIFYING_ROUTES.length);
  });

  it("lets the four shares sum past 100% — the routes overlap and the sum says so", () => {
    // The whole point of the increment: a barangay can qualify on several routes, so these are
    // four independent shares and not a partition. Nothing here may clamp or normalise them.
    const criteria = toUucPhcCriteria(
      row({ n_route_ip: 70, n_route_conflict: 60, n_route_four_ps: 20, n_route_health: 40 }),
    );
    expect(criteria.routes.map((r) => r.sharePct)).toEqual([70, 60, 20, 40]);
    expect(criteria.shareSumPct).toBe(190);
  });

  it("prints a share sum that equals the shares beside it", () => {
    // Summing the rounded shares rather than recomputing from the raw counts: a reader who adds
    // the four percentages on screen has to get this number back.
    const criteria = toUucPhcCriteria(
      row({ n_listed: 3, n_route_ip: 1, n_route_conflict: 1, n_route_four_ps: 1, n_route_health: 1, n_health_evaluable: 3 }),
    );
    const printed = criteria.routes.reduce((total, r) => total + (r.sharePct ?? 0), 0);
    expect(criteria.shareSumPct).toBe(printed);
  });

  it("gives route (d) the evaluable denominator and the others the listed count", () => {
    const criteria = toUucPhcCriteria(
      row({ n_listed: 200, n_health_evaluable: 100, n_route_health: 50, n_route_ip: 50 }),
    );
    const byKey = Object.fromEntries(criteria.routes.map((r) => [r.key, r]));
    expect(byKey.ip.denominator).toBe(200);
    expect(byKey.ip.sharePct).toBe(25);
    // Same raw count, different denominator — the health route is out of 100, not 200.
    expect(byKey.health.denominator).toBe(100);
    expect(byKey.health.sharePct).toBe(50);
    expect(criteria.healthEvaluable).toBe(100);
    expect(criteria.healthExcluded).toBe(100);
  });

  it("reports no exclusion when every listed barangay is evaluable", () => {
    const criteria = toUucPhcCriteria(row({ n_listed: 42, n_health_evaluable: 42 }));
    expect(criteria.healthExcluded).toBe(0);
  });

  it("distinguishes 'nobody qualified' from 'not evaluable here'", () => {
    // n_route_health 0 out of 0 evaluable is not 0% — it is unanswerable, and the UI renders the
    // two differently (a 0% track vs. an em dash).
    const criteria = toUucPhcCriteria(
      row({ n_listed: 10, n_health_evaluable: 0, n_route_health: 0, n_route_ip: 0 }),
    );
    const byKey = Object.fromEntries(criteria.routes.map((r) => [r.key, r]));
    expect(byKey.health.sharePct).toBeNull();
    expect(byKey.health.fraction).toBe(0);
    // Route (a) genuinely has a denominator and genuinely reads zero.
    expect(byKey.ip.sharePct).toBe(0);
    expect(criteria.healthExcluded).toBe(10);
  });

  it("returns a null share sum for an area with nothing listed, not a zero", () => {
    // NCR: a real row reading zero. Printing "these four shares add up to 0%" would be noise
    // dressed as a finding.
    const criteria = toUucPhcCriteria(row({ n_listed: 0, n_health_evaluable: 0 }));
    expect(criteria.nListed).toBe(0);
    expect(criteria.shareSumPct).toBeNull();
    expect(criteria.routes.every((r) => r.sharePct === null)).toBe(true);
    expect(criteria.healthExcluded).toBe(0);
  });

  it("clamps the drawn fraction to its track without touching the count", () => {
    // Impossible by construction, and the migration asserts against it — but a bar that can
    // overflow its track is worth making impossible in the mapping too.
    const criteria = toUucPhcCriteria(row({ n_listed: 10, n_route_ip: 12 }));
    const ip = criteria.routes.find((r) => r.key === "ip");
    expect(ip?.fraction).toBe(1);
    expect(ip?.count).toBe(12);
  });

  it("never reports a negative excluded count", () => {
    const criteria = toUucPhcCriteria(row({ n_listed: 5, n_health_evaluable: 8 }));
    expect(criteria.healthExcluded).toBe(0);
  });

  it("carries each route's own test text, including criterion (b)'s summed reading", () => {
    // (b) is implemented as armed_conf + idp, following the source file rather than the order's
    // literal "or" (docs/UUC_PHC_2025_PLAN.md §1a). The page has to say so where it renders.
    const byKey = Object.fromEntries(toUucPhcCriteria(row()).routes.map((r) => [r.key, r]));
    expect(byKey.conflict.test).toMatch(/together reach 10%/);
    expect(byKey.conflict.test).toMatch(/ELCAC/);
    expect(byKey.health.test).toMatch(/4 of the 7/);
  });
});
