import Link from "next/link";
import { FigureCard } from "@/components/narrative/figure-card";
import { FigureView } from "@/components/charts/figure-view";
import type { TrainingRow } from "@/lib/db/indicators";
import type { GeoLevel } from "@/lib/filters/schema";

export function TrainingFigure({
  rows,
  caption,
  geoLevel,
  citymunAncestor,
}: {
  rows: TrainingRow[];
  caption: string;
  geoLevel: GeoLevel;
  citymunAncestor: { geoCode: string; geoName: string } | null;
}) {
  if (geoLevel === "barangay") {
    return (
      <FigureCard
        title="Training coverage"
        caption={caption}
        headline="Training coverage isn't tracked at the barangay level."
        technicalDetails={
          <p>
            Per-topic training coverage is only computed down to the city/municipality level, to
            keep the published dataset within a manageable size.
          </p>
        }
      >
        <p className="text-sm text-muted">
          {citymunAncestor ? (
            <>
              See training coverage for{" "}
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

  const topGaps = [...rows]
    .filter((r) => r.coveragePct !== null)
    .sort((a, b) => (a.coveragePct as number) - (b.coveragePct as number))
    .slice(0, 8)
    .map((r) => ({ label: r.topicLabel ?? r.topicSlug, value: r.coveragePct as number }));

  const biggestGap = topGaps[0];

  return (
    <FigureCard
      title="Training coverage — biggest gaps"
      caption={caption}
      headline={
        biggestGap
          ? `"${biggestGap.label}" has the lowest coverage here, at ${biggestGap.value}%.`
          : "No training data available."
      }
      technicalDetails={<p>Showing the 8 topics with the lowest coverage percentage.</p>}
    >
      {topGaps.length > 0 ? (
        <FigureView
          title="Training coverage — biggest gaps"
          data={topGaps}
          xLabel="% trained"
          yLabel="Training topic"
          valueSuffix="%"
        />
      ) : (
        <p className="text-sm text-muted">No data available.</p>
      )}
    </FigureCard>
  );
}
