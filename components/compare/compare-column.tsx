"use client";

import Link from "next/link";
import { useQueryStates } from "nuqs";
import { filterParsers } from "@/lib/filters/codec";
import type { GeoLevel } from "@/lib/filters/schema";
import { FigureCard } from "@/components/narrative/figure-card";
import { DemographicsFigure } from "@/components/explore/demographics-figure";
import { TrainingFigure } from "@/components/explore/training-figure";
import { HonorariumFigure } from "@/components/explore/honorarium-figure";
import type {
  BhwCounts,
  DemographicRow,
  HonorariumRow,
  TrainingRow,
} from "@/lib/db/indicators";
import type { Indicator } from "@/lib/filters/schema";

export type CompareColumnData = {
  geoCode: string;
  geoName: string;
  geoLevel: GeoLevel;
  counts: BhwCounts | null;
  /** StepZero universe total for this geo (null when no quick-count row). */
  totalBhw: number | null;
  /** Individually-profiled BHWs (agg_bhw_counts.n_total). */
  validatedProfiles: number | null;
  /** Coverage % (already capped for display), or null. */
  coveragePct: number | null;
  demographics: { dimension: string; rows: DemographicRow[] }[];
  training: TrainingRow[];
  honorarium: HonorariumRow[];
};

export function CompareColumn({
  data,
  indicator,
  canRemove,
}: {
  data: CompareColumnData;
  indicator: Indicator | null;
  canRemove: boolean;
}) {
  const [filters, setFilters] = useQueryStates(filterParsers, { shallow: false, history: "push" });
  const caption = `N = ${data.validatedProfiles?.toLocaleString() ?? "—"} validated profiles · ${data.geoName} · 2025 snapshot`;

  function remove() {
    setFilters({ compareGeos: (filters.compareGeos ?? []).filter((c) => c !== data.geoCode) });
  }

  const showAll = indicator === null;

  return (
    <div className="flex min-w-72 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <Link
          href={`/place/${data.geoLevel}/${data.geoCode}`}
          className="font-semibold hover:text-accent"
        >
          {data.geoName}
        </Link>
        {canRemove && (
          <button
            type="button"
            onClick={remove}
            className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface hover:text-accent"
          >
            Remove
          </button>
        )}
      </div>

      <p className="text-xs text-muted">
        {data.totalBhw !== null ? `${data.totalBhw.toLocaleString()} total BHWs · ` : ""}
        {data.validatedProfiles?.toLocaleString() ?? "—"} validated profiles
        {data.coveragePct !== null ? ` (${data.coveragePct}%)` : ""}
      </p>

      {(showAll || indicator === "accreditation") && (
        <FigureCard
          title="Accreditation"
          caption={caption}
          headline={
            data.counts?.pctAccredited !== null && data.counts?.pctAccredited !== undefined
              ? `About ${Math.round(data.counts.pctAccredited)}% of profiled BHWs here are accredited.`
              : "No accreditation data available."
          }
        >
          <p className="text-4xl font-semibold tracking-tight">
            {data.counts?.pctAccredited ?? "—"}
            {data.counts?.pctAccredited !== null && data.counts?.pctAccredited !== undefined ? "%" : ""}
          </p>
        </FigureCard>
      )}

      {(showAll || indicator === "service_years") && (
        <FigureCard
          title="Average years of service"
          caption={caption}
          headline={
            data.counts?.avgActiveYears !== null && data.counts?.avgActiveYears !== undefined
              ? `Average of ${data.counts.avgActiveYears} years.`
              : "No service-year data available."
          }
        >
          <p className="text-4xl font-semibold tracking-tight">{data.counts?.avgActiveYears ?? "—"}</p>
        </FigureCard>
      )}

      {(showAll || indicator === "demographics") &&
        data.demographics.map(({ dimension, rows }) => (
          <DemographicsFigure
            key={dimension}
            dimension={dimension as never}
            rows={rows}
            caption={caption}
          />
        ))}

      {(showAll || indicator === "training") && (
        <TrainingFigure
          rows={data.training}
          caption={caption}
          geoLevel={data.geoLevel}
          citymunAncestor={null}
        />
      )}

      {(showAll || indicator === "honorarium") && (
        <HonorariumFigure rows={data.honorarium} caption={caption} />
      )}
    </div>
  );
}
