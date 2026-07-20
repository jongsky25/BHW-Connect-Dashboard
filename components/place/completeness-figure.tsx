import Link from "next/link";
import { FigureCard } from "@/components/narrative/figure-card";
import { FigureView } from "@/components/charts/figure-view";
import type { CompletenessRow } from "@/lib/db/data-quality";
import type { GeoLevel } from "@/lib/filters/schema";

/** Same labels as /data-quality, so a field reads identically in both places. */
export const COMPLETENESS_FIELD_LABEL: Record<string, string> = {
  active_years: "Active-service years",
  civil_status: "Civil status",
  age: "Age",
  bloodtype: "Blood type",
  sex: "Sex",
  ip_status: "Indigenous people (IP) status",
  household: "Household count",
  educational_attainment: "Educational attainment",
};

/**
 * Per-place field completeness (§7 1.9 "findings, not apologies"). Completeness
 * is aggregated down to citymun only (same disk-budget cut as training
 * coverage), so barangay pages point at their citymun's figures instead of
 * passing a broader number off as barangay-local.
 */
export function CompletenessFigure({
  rows,
  caption,
  geoLevel,
  citymunAncestor,
}: {
  rows: CompletenessRow[];
  caption: string;
  geoLevel: GeoLevel;
  citymunAncestor: { geoCode: string; geoName: string } | null;
}) {
  const methodology = (
    <>
      <p>
        A field counts as missing only when the source record has no value at all. Fields whose
        source uses an explicit &quot;unknown&quot; category (e.g. blood type) count those rows as
        present.
      </p>
      <p>
        See the <Link href="/data-quality" className="underline hover:text-accent">data quality page</Link>{" "}
        for the dataset-wide picture.
      </p>
    </>
  );

  if (geoLevel === "barangay") {
    return (
      <FigureCard
        title="Data completeness"
        caption={caption}
        headline="Field completeness isn't tracked at the barangay level."
        technicalDetails={
          <>
            <p>
              Completeness is only computed down to the city/municipality level, to keep the
              published dataset within a manageable size.
            </p>
            {methodology}
          </>
        }
      >
        <p className="text-sm text-muted">
          {citymunAncestor ? (
            <>
              See field completeness for{" "}
              <Link
                href={`/place/citymun/${citymunAncestor.geoCode}`}
                className="underline hover:text-accent"
              >
                {citymunAncestor.geoName}
              </Link>{" "}
              instead.
            </>
          ) : (
            "No city/municipality context available."
          )}
        </p>
      </FigureCard>
    );
  }

  const gaps = rows
    .filter((r) => r.pctMissing !== null && r.pctMissing > 0)
    .map((r) => ({
      label: COMPLETENESS_FIELD_LABEL[r.fieldName] ?? r.fieldName,
      value: r.pctMissing as number,
      count: r.nMissing ?? undefined,
    }));
  const worst = gaps[0];

  return (
    <FigureCard
      title="Data completeness"
      caption={caption}
      headline={
        rows.length === 0
          ? "No completeness data available for this area."
          : worst
            ? `${worst.label} is missing for ${worst.value}% of profiles here.`
            : `All ${rows.length} core profile fields are complete for BHWs profiled here.`
      }
      technicalDetails={
        <>
          <p>
            Share of validated profiles in this area with no recorded value, per field, across{" "}
            {rows.length} core profile fields.
          </p>
          {methodology}
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No data available.</p>
      ) : gaps.length > 0 ? (
        <FigureView
          title="Data completeness — fields with gaps"
          caption={caption}
          data={gaps}
          xLabel="% of profiles missing the field"
          yLabel="Field"
          valueSuffix="%"
        />
      ) : (
        <p className="text-4xl font-semibold tracking-tight">100%</p>
      )}
    </FigureCard>
  );
}
