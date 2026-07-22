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
  householdsPerBhw,
  incomeClass,
  locator,
  benchmarkNote,
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
  /** Households per BHW (null when household data is unavailable). */
  householdsPerBhw: number | null;
  incomeClass: number | null;
  /** Locator-map thumbnail (omitted when the geo has no boundary). */
  locator?: ReactNode;
  /** One compact muted line under the stat-chip row (Increment 4) — e.g.
   * "Region VII: 62 hh/BHW · Philippines: 58 hh/BHW · n = 1,234 profiled (92%)."
   * The full benchmark bars live on the cards below; this is just the
   * at-a-glance summary. */
  benchmarkNote?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
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
            {householdsPerBhw !== null && (
              <StatChip
                label={<GlossaryTerm slug="households_per_bhw">Households per BHW</GlossaryTerm>}
                value={householdsPerBhw.toLocaleString()}
              />
            )}
            {incomeClass !== null && INCOME_CLASS_LABEL[incomeClass] && (
              <StatChip label="Income class" value={INCOME_CLASS_LABEL[incomeClass]} />
            )}
          </div>
        )}
        {benchmarkNote && <p className="text-xs text-muted">{benchmarkNote}</p>}
      </div>
      {locator}
    </header>
  );
}
