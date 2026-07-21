import Link from "next/link";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import { COMPLETENESS_FIELD_LABEL } from "@/components/place/completeness-figure";
import type { DataQualityGrade } from "@/lib/analysis/data-quality-grade";

const GRADE_STYLE: Record<DataQualityGrade["grade"], string> = {
  A: "bg-accent/10 text-accent border-accent/30",
  B: "bg-warning/10 text-warning border-warning/40",
  C: "bg-danger/10 text-danger border-danger/40",
};

/**
 * Compact per-geo data-completeness grade (E2.5) shown beside the Explore
 * figures. Reads the read-time grade collapsed from the completeness rows; at
 * barangay it describes the citymun it falls back to (mirroring the completeness
 * figure), labeled as such. Links to /data-quality for the field-by-field view.
 */
export function DataQualityBadge({
  grade,
  fallbackCitymunName,
}: {
  grade: DataQualityGrade | null;
  /** Set when the grade is the citymun's, shown at a barangay with no rows. */
  fallbackCitymunName?: string | null;
}) {
  if (!grade) return null;

  const worstLabel = grade.worstFieldName
    ? (COMPLETENESS_FIELD_LABEL[grade.worstFieldName] ?? grade.worstFieldName)
    : null;

  const scope = fallbackCitymunName
    ? `for ${fallbackCitymunName} (city/municipality)`
    : "here";

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-sm font-bold ${GRADE_STYLE[grade.grade]}`}
      >
        {grade.grade}
      </span>
      <span className="text-muted">
        <GlossaryTerm slug="data_completeness">Data completeness</GlossaryTerm> {scope}: grade{" "}
        {grade.grade} — {grade.avgCompleteness}% of key fields filled
        {worstLabel ? `; ${worstLabel.toLowerCase()} is often missing` : ""}.{" "}
        <Link href="/data-quality" className="underline hover:text-accent">
          See data quality
        </Link>
        .
      </span>
    </div>
  );
}
