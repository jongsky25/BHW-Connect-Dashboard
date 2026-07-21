import { describe, expect, it } from "vitest";
import { computeDataQualityGrade } from "./data-quality-grade";
import type { CompletenessRow } from "@/lib/db/data-quality";

const row = (fieldName: string, pctMissing: number | null): CompletenessRow => ({
  fieldName,
  nMissing: pctMissing === null ? null : 1,
  pctMissing,
});

describe("computeDataQualityGrade", () => {
  it("returns null when no field has a missingness value", () => {
    expect(computeDataQualityGrade([])).toBeNull();
    expect(computeDataQualityGrade([row("age", null), row("sex", null)])).toBeNull();
  });

  it("grades A when average completeness is >= 95%", () => {
    const g = computeDataQualityGrade([row("age", 2), row("sex", 3), row("bloodtype", 4)]);
    expect(g?.grade).toBe("A"); // avg missing 3% -> 97% complete
    expect(g?.avgCompleteness).toBe(97);
    expect(g?.worstFieldName).toBeNull(); // worst 4% < mention threshold
  });

  it("grades B when average completeness is 85–95% and names the worst field", () => {
    const g = computeDataQualityGrade([row("age", 2), row("sex", 4), row("bloodtype", 30)]);
    // avg missing 12% -> 88% complete
    expect(g?.grade).toBe("B");
    expect(g?.avgCompleteness).toBe(88);
    expect(g?.worstFieldName).toBe("bloodtype");
    expect(g?.worstPctMissing).toBe(30);
  });

  it("grades C below 85% average completeness", () => {
    const g = computeDataQualityGrade([row("age", 20), row("sex", 25)]);
    expect(g?.grade).toBe("C"); // avg missing 22.5% -> 77.5% complete
    expect(g?.avgCompleteness).toBe(77.5);
    expect(g?.worstFieldName).toBe("sex");
  });

  it("ignores fields with null missingness in the average", () => {
    const g = computeDataQualityGrade([row("age", 2), row("sex", null), row("bloodtype", 4)]);
    expect(g?.avgCompleteness).toBe(97); // only age+bloodtype counted
    expect(g?.grade).toBe("A");
  });

  it("treats the A/B boundary as inclusive at 95%", () => {
    expect(computeDataQualityGrade([row("age", 5)])?.grade).toBe("A"); // exactly 95%
    expect(computeDataQualityGrade([row("age", 15)])?.grade).toBe("B"); // exactly 85%
  });
});
