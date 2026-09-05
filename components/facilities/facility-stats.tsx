import { formatCount } from "@/lib/format";
import type { NhfrCounts } from "@/lib/db/nhfr";

/**
 * The headline figures for an area: how many facilities, split by ownership, and the four types
 * the section leads with.
 *
 * **No "% licensed" tile, deliberately.** 63% of the register carries no licensing status at all
 * — overwhelmingly Barangay Health Stations, which are not a licensed facility type — so any
 * percentage would divide by a denominator this export cannot support and would read as a
 * compliance figure. The facility list states each facility's status where the source states one.
 */
export function FacilityStats({ counts }: { counts: NhfrCounts }) {
  const tiles = [
    { label: "Barangay health stations", value: counts.nBarangayHealthStation },
    { label: "Rural health units", value: counts.nRuralHealthUnit },
    { label: "Hospitals", value: counts.nHospital },
    { label: "Birthing homes", value: counts.nBirthingHome },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-semibold tabular-nums sm:text-4xl">
          {formatCount(counts.nFacilities)}
        </span>
        <span className="text-muted">
          {counts.nFacilities === 1 ? "health facility" : "health facilities"}
        </span>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
          <dt className="text-muted">Government</dt>
          <dd className="font-semibold tabular-nums">{formatCount(counts.nGovernment)}</dd>
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full bg-surface ring-1 ring-border"
          />
          <dt className="text-muted">Private</dt>
          <dd className="font-semibold tabular-nums">{formatCount(counts.nPrivate)}</dd>
        </div>
      </dl>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md border border-border bg-surface/40 p-3">
            <dd className="text-xl font-semibold tabular-nums">{formatCount(t.value)}</dd>
            <dt className="mt-0.5 text-xs text-muted">{t.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}
