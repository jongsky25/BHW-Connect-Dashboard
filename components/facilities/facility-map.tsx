"use client";

import dynamic from "next/dynamic";
import { formatCount } from "@/lib/format";
import { accent, muted } from "@/lib/charts/palette";
import type { FacilityPointData } from "@/lib/geo/facility-points";

const PointMap = dynamic(() => import("@/components/maps/point-map").then((m) => m.PointMap), {
  ssr: false,
  loading: () => (
    <div className="h-80 w-full animate-pulse rounded-md border border-border bg-surface" />
  ),
});

/**
 * The facility point map and everything the reader needs to not misread it.
 *
 * **The caveat is not a footnote here, it is part of the figure.** The DOH registry records no
 * coordinates, so a dot on this map is a *barangay*, drawn at the barangay's own centre, sized by
 * how many facilities are registered in it. Anyone reading a dot as "the health station is here"
 * would be reading a claim the source cannot make, and a map is persuasive enough that the
 * correction has to sit next to the picture rather than three sections down on
 * `/facilities/methodology`. This is the reason the point map was deferred out of the original
 * NHFR increments rather than bolted onto the choropleth (NHFR_2026_PLAN.md §Deferred).
 *
 * **Empty barangays are drawn, hollow.** The dataset's headline finding is that thousands of
 * barangays have no registered facility at all; a map of only the filled ones would show a town
 * that looks entirely served. The hollow rings are the finding.
 *
 * The map canvas is decorative (`aria-hidden`, BUILD_PLAN §4.3). The accessible equivalent is the
 * facility list rendered directly beneath it on the same page — every facility, its type, and the
 * barangay it is in, as real DOM — plus the legend and the counts below, which are also real DOM.
 */
export function FacilityMap({
  data,
  areaName,
  outlineUrl,
  outlineGeoCode,
}: {
  data: FacilityPointData;
  areaName: string;
  outlineUrl: string | null;
  outlineGeoCode: string;
}) {
  const {
    points,
    maxFacilities,
    nBarangaysWithFacility,
    nBarangaysWithoutFacility,
    nBarangaysNotPlaced,
    nFacilitiesNotPlaced,
  } = data;

  return (
    <section aria-label="Barangay map">
      <h2 className="text-sm font-semibold">Which barangays have facilities</h2>
      <p className="mt-1 text-xs text-muted">
        One circle per barangay in {areaName}, at the barangay&rsquo;s centre.
      </p>

      <div className="mt-3">
        <PointMap
          points={points}
          maxFacilities={maxFacilities}
          outlineUrl={outlineUrl}
          outlineGeoCode={outlineGeoCode}
        />
      </div>

      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: accent, opacity: 0.65 }}
          />
          <span>
            {formatCount(nBarangaysWithFacility)}{" "}
            {nBarangaysWithFacility === 1 ? "barangay has" : "barangays have"} at least one facility
            — bigger circle, more facilities
          </span>
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-full border"
            style={{ borderColor: muted }}
          />
          <span>
            {formatCount(nBarangaysWithoutFacility)}{" "}
            {nBarangaysWithoutFacility === 1 ? "barangay has" : "barangays have"} none
          </span>
        </li>
      </ul>

      <p className="mt-3 text-xs text-muted">
        <strong className="font-semibold">A circle is a barangay, not a building.</strong> The
        registry records which barangay each facility is in, never its coordinates, so every
        facility in a barangay is counted into that barangay&rsquo;s one circle. Nothing here shows
        where a facility stands within its barangay.
      </p>

      {(nBarangaysNotPlaced > 0 || nFacilitiesNotPlaced > 0) && (
        <p className="mt-2 text-xs text-muted">
          {nBarangaysNotPlaced > 0 && (
            <>
              {formatCount(nBarangaysNotPlaced)}{" "}
              {nBarangaysNotPlaced === 1 ? "barangay is" : "barangays are"} missing from the
              boundary source and could not be drawn.{" "}
            </>
          )}
          {nFacilitiesNotPlaced > 0 && (
            <>
              {formatCount(nFacilitiesNotPlaced)}{" "}
              {nFacilitiesNotPlaced === 1 ? "facility is" : "facilities are"} not on the map;{" "}
              {nFacilitiesNotPlaced === 1 ? "it appears" : "they appear"} in the list below either
              way.
            </>
          )}
        </p>
      )}
    </section>
  );
}
