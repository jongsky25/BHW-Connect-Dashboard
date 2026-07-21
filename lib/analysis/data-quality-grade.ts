/**
 * A single, explainable data-quality grade per geo (E2.5 / review S10), collapsed
 * at read time from the field-level completeness rows that back `/data-quality`
 * and the completeness figure — no new column or aggregate. Client-safe (no
 * `server-only`): a plain closed-form summary over rows the page already has.
 */
import type { CompletenessRow } from "@/lib/db/data-quality";

/** Average-completeness cut-offs for the letter grade (documented in /methodology). */
export const GRADE_THRESHOLDS = { A: 95, B: 85 } as const;
/** Only name the worst field when it's missing at least this often, so a grade-A
 * geo with everything near-complete doesn't get a spurious "X is often missing". */
export const WORST_FIELD_MENTION_THRESHOLD = 10;

export type DataQualityGrade = {
  grade: "A" | "B" | "C";
  /** Mean completeness (100 − pctMissing) across the tracked fields, one decimal. */
  avgCompleteness: number;
  /** Field with the highest missingness, or null when none clears the mention bar. */
  worstFieldName: string | null;
  worstPctMissing: number | null;
};

/**
 * Grade the geo from its completeness rows. Each tracked field is weighted
 * equally (a trust-first choice — no hidden editorial weighting); the grade is
 * A ≥95% average completeness, B ≥85%, else C. Returns null when there are no
 * usable rows (e.g. barangay, whose caller falls back to the citymun).
 */
export function computeDataQualityGrade(rows: CompletenessRow[]): DataQualityGrade | null {
  const usable = rows.filter((r) => r.pctMissing !== null);
  if (usable.length === 0) return null;

  const avgMissing =
    usable.reduce((sum, r) => sum + (r.pctMissing as number), 0) / usable.length;
  const avgCompleteness = Math.round((100 - avgMissing) * 10) / 10;

  const grade =
    avgCompleteness >= GRADE_THRESHOLDS.A ? "A" : avgCompleteness >= GRADE_THRESHOLDS.B ? "B" : "C";

  const worst = usable.reduce((a, b) =>
    (b.pctMissing as number) > (a.pctMissing as number) ? b : a,
  );
  const worstNotable = (worst.pctMissing as number) >= WORST_FIELD_MENTION_THRESHOLD;

  return {
    grade,
    avgCompleteness,
    worstFieldName: worstNotable ? worst.fieldName : null,
    worstPctMissing: worstNotable ? (worst.pctMissing as number) : null,
  };
}
