import type { GeoLevel } from "@/lib/filters/schema";

/**
 * The section's one download: a PNG summary of this area's coverage, ownership split, and
 * facility types (the PNG one-pager, the last item of `docs/NHFR_2026_PLAN.md`'s Deferred list).
 *
 * There is no CSV/XLSX row export here, unlike `/uuc-phc`'s `DownloadLinks` — this section has no
 * `ref_nhfr_list`-style view to back one, and building one is its own increment, not a rider on
 * this one. The facility list itself is already on screen at citymun grain (`FacilityList`),
 * which is where "every row" belongs.
 */
export function DownloadLinks({ geoLevel, geoCode }: { geoLevel: GeoLevel; geoCode: string }) {
  const scope = `geoLevel=${geoLevel}&geoCode=${encodeURIComponent(geoCode)}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`/api/export/facilities?${scope}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-accent"
      >
        Summary (PNG)
      </a>
      <p className="w-full text-xs text-muted sm:w-auto">
        Coverage, ownership and facility types for this area, on one page. It carries no licence
        status — see the facility list on screen for what the source states per facility.
      </p>
    </div>
  );
}
