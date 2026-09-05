import { describe, expect, it } from "vitest";
import { isDistrictCorrectionDecision } from "./district-corrections";

describe("isDistrictCorrectionDecision", () => {
  it("accepts only the three outcomes a reviewer can record", () => {
    expect(isDistrictCorrectionDecision("accepted")).toBe(true);
    expect(isDistrictCorrectionDecision("rejected")).toBe(true);
    expect(isDistrictCorrectionDecision("duplicate")).toBe(true);
  });

  it("rejects 'open' — where a proposal starts, never something a reviewer submits", () => {
    expect(isDistrictCorrectionDecision("open")).toBe(false);
    expect(isDistrictCorrectionDecision("")).toBe(false);
    expect(isDistrictCorrectionDecision(undefined)).toBe(false);
    expect(isDistrictCorrectionDecision(null)).toBe(false);
  });
});
