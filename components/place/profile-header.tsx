import Link from "next/link";
import type { ReactNode } from "react";
import type { GeoLevel } from "@/lib/filters/schema";
import { GlossaryTerm } from "@/components/glossary/glossary-term";

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

/** One labelled stat in the header chip row. */
function StatChip({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-1.5">
      <div className="text-[0.7rem] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function ProfileHeader({
  geoName,
  geoLevel,
  ancestors,
  totalBhw,
  validatedProfiles,
  coveragePct,
  bhwPer1000Residents,
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
  /** Total BHWs per 1,000 residents (null when population data is unavailable). */
  bhwPer1000Residents: number | null;
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

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{geoName}</h1>
        <span className="text-sm text-muted">{GEO_LEVEL_LABEL[geoLevel]}</span>
      </div>

      {totalBhw === null && validatedProfiles === null ? (
        <p className="text-sm text-muted">No BHW data for this area.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {totalBhw !== null && (
            <StatChip
              label={<GlossaryTerm slug="total_bhw">Total BHWs</GlossaryTerm>}
              value={totalBhw.toLocaleString()}
            />
          )}
          {validatedProfiles !== null && (
            <StatChip
              label={<GlossaryTerm slug="validated_profile">Validated profiles</GlossaryTerm>}
              value={
                coveragePct !== null
                  ? `${validatedProfiles.toLocaleString()} (${coveragePct}%)`
                  : validatedProfiles.toLocaleString()
              }
            />
          )}
          {bhwPer1000Residents !== null && (
            <StatChip
              label={<GlossaryTerm slug="bhw_per_1000">Per 1,000 residents</GlossaryTerm>}
              value={bhwPer1000Residents.toLocaleString()}
            />
          )}
          {incomeClass !== null && INCOME_CLASS_LABEL[incomeClass] && (
            <StatChip label="Income class" value={INCOME_CLASS_LABEL[incomeClass]} />
          )}
        </div>
      )}
    </header>
  );
}
