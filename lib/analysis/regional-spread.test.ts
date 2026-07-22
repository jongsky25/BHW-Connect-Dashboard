import { describe, expect, it } from "vitest";
import { regionalSpread } from "./regional-spread";

type Row = { geoCode: string; value: number | null };
const row = (geoCode: string, value: number | null): Row => ({ geoCode, value });

describe("regionalSpread", () => {
  it("returns null for an empty input", () => {
    expect(regionalSpread<Row>([], (r) => r.value)).toBeNull();
  });

  it("returns null when every pick is null", () => {
    expect(regionalSpread([row("A", null), row("B", null)], (r) => r.value)).toBeNull();
  });

  it("ignores null values and returns the min/max of the rest", () => {
    const rows = [row("A", 40), row("B", null), row("C", 85), row("D", 60)];
    expect(regionalSpread(rows, (r) => r.value)).toEqual({ min: 40, max: 85 });
  });

  it("handles a single usable value (min === max)", () => {
    expect(regionalSpread([row("A", 50)], (r) => r.value)).toEqual({ min: 50, max: 50 });
  });
});
