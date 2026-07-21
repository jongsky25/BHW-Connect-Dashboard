import Link from "next/link";
import { FigureCard } from "@/components/narrative/figure-card";
import { FigureView } from "@/components/charts/figure-view";
import { ExportMenu } from "@/components/narrative/export-menu";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import type { TrainingRow } from "@/lib/db/indicators";
import type { GeoLevel } from "@/lib/filters/schema";

/** The dataset is a 2025 snapshot; a topic whose median last-trained year is
 * this many years or more before it is flagged as possibly due for a refresher
 * (E2.1). Threshold documented in /methodology. */
const SNAPSHOT_YEAR = 2025;
const STALE_AFTER_YEARS = 5;

export function TrainingFigure({
  rows,
  caption,
  geoLevel,
  citymunAncestor,
  geoCode,
}: {
  rows: TrainingRow[];
  caption: string;
  geoLevel: GeoLevel;
  citymunAncestor: { geoCode: string; geoName: string } | null;
  geoCode?: string;
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

  const sortedRows = [...rows]
    .filter((r) => r.coveragePct !== null)
    .sort((a, b) => (a.coveragePct as number) - (b.coveragePct as number));
  const topGaps = sortedRows.slice(0, 8).map((r) => ({
    label: r.topicLabel ?? r.topicSlug,
    value: r.coveragePct as number,
    count: r.nTrained ?? undefined,
  }));

  const biggestGap = topGaps[0];
  const biggestGapRow = sortedRows[0];
  const gapCi =
    biggestGapRow && biggestGapRow.ciLow !== null && biggestGapRow.ciHigh !== null
      ? `${biggestGapRow.ciLow}–${biggestGapRow.ciHigh}%`
      : null;

  // Recency, orthogonal to coverage (E2.1): a topic can be widely trained yet
  // long ago. Flag topics whose median last-trained year is >= STALE_AFTER_YEARS
  // before the snapshot, stalest first.
  const staleYear = SNAPSHOT_YEAR - STALE_AFTER_YEARS;
  const staleTopics = rows
    .filter((r) => r.medianTrainingYear !== null && r.medianTrainingYear <= staleYear)
    .sort((a, b) => (a.medianTrainingYear as number) - (b.medianTrainingYear as number))
    .map((r) => ({ label: r.topicLabel ?? r.topicSlug, year: r.medianTrainingYear as number }));

  return (
    <FigureCard
      title="Training coverage — biggest gaps"
      caption={caption}
      exportMenu={
        geoCode ? (
          <ExportMenu geoCode={geoCode} geoLevel={geoLevel} indicator="training" />
        ) : undefined
      }
      headline={
        biggestGap
          ? `"${biggestGap.label}" has the lowest coverage here, at ${biggestGap.value}%.`
          : "No training data available."
      }
      technicalDetails={
        <p>
          Showing the 8 topics with the lowest coverage percentage. &ldquo;Median last-trained
          year&rdquo; is the middle year among trained BHWs; a topic whose median is{" "}
          {STALE_AFTER_YEARS}+ years before the {SNAPSHOT_YEAR} snapshot ({staleYear} or earlier) is
          flagged as possibly due for a refresher.
          {gapCi && biggestGap ? (
            <>
              {" "}
              The lowest-coverage topic&apos;s {biggestGap.value}% is a point estimate; its 95%{" "}
              <GlossaryTerm slug="confidence_interval">confidence interval</GlossaryTerm> is {gapCi}.
            </>
          ) : null}
        </p>
      }
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
      {staleTopics.length > 0 && (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          Refresher may be due:{" "}
          {staleTopics
            .slice(0, 3)
            .map((t) => `${t.label} (median last trained ${t.year})`)
            .join(", ")}
          {staleTopics.length > 3 ? `, and ${staleTopics.length - 3} more` : ""}.
        </p>
      )}
    </FigureCard>
  );
}
