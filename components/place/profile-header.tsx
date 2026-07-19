import Link from "next/link";
import type { GeoLevel } from "@/lib/filters/schema";

const GEO_LEVEL_LABEL: Record<GeoLevel, string> = {
  national: "Country",
  region: "Region",
  province: "Province",
  citymun: "City/Municipality",
  barangay: "Barangay",
};

const INCOME_CLASS_LABEL: Record<number, string> = {
  1: "1st class",
  2: "2nd class",
  3: "3rd class",
  4: "4th class",
  5: "5th class",
  6: "6th class",
};

export type BreadcrumbAncestor = { label: string; geoLevel: GeoLevel; geoCode: string };

export function ProfileHeader({
  geoName,
  geoLevel,
  ancestors,
  totalBhw,
  validatedProfiles,
  coveragePct,
  incomeClass,
}: {
  geoName: string;
  geoLevel: GeoLevel;
  ancestors: BreadcrumbAncestor[];
  /** StepZero universe total for this geo (null when no quick-count row). */
  totalBhw: number | null;
  /** Individually-profiled BHWs (agg_bhw_counts.n_total). */
  validatedProfiles: number | null;
  /** Coverage % (already capped for display), or null. */
  coveragePct: number | null;
  incomeClass: number | null;
}) {
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-6">
      <nav aria-label="Breadcrumb" className="text-xs text-muted">
        <ol className="flex flex-wrap items-center gap-1">
          {ancestors.map((a) => (
            <li key={a.geoCode} className="flex items-center gap-1">
              <Link href={`/place/${a.geoLevel}/${a.geoCode}`} className="hover:text-accent">
                {a.label}
              </Link>
              <span aria-hidden="true">/</span>
            </li>
          ))}
          <li aria-current="page">{geoName}</li>
        </ol>
      </nav>

      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{geoName}</h1>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>{GEO_LEVEL_LABEL[geoLevel]}</span>
        {totalBhw !== null ? (
          <>
            <span>{totalBhw.toLocaleString()} BHWs total</span>
            {validatedProfiles !== null && (
              <span>
                {validatedProfiles.toLocaleString()} validated profiles
                {coveragePct !== null ? ` (${coveragePct}%)` : ""}
              </span>
            )}
          </>
        ) : validatedProfiles !== null ? (
          <span>{validatedProfiles.toLocaleString()} validated profiles</span>
        ) : (
          <span>No BHW data</span>
        )}
        {incomeClass !== null && INCOME_CLASS_LABEL[incomeClass] && (
          <span>{INCOME_CLASS_LABEL[incomeClass]} income</span>
        )}
      </div>
    </header>
  );
}
