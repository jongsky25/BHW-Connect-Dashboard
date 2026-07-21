"use client";

import Link from "next/link";
import { useQueryStates } from "nuqs";
import { filterParsers } from "@/lib/filters/codec";
import type { GeoLevel } from "@/lib/filters/schema";
import { MIN_LEADER_N } from "@/lib/analysis/thresholds";
import { FigureCard } from "@/components/narrative/figure-card";
import { FigureTabs } from "@/components/ui/figure-tabs";
import { DemographicsFigure } from "@/components/explore/demographics-figure";
import { TrainingFigure } from "@/components/explore/training-figure";
import { CertificationFigure } from "@/components/explore/certification-figure";
import { HonorariumFigure } from "@/components/explore/honorarium-figure";
import { HonorariumAmountFigure } from "@/components/explore/honorarium-amount-figure";
import { HonorariumDistributionFigure } from "@/components/explore/honorarium-distribution-figure";
import type {
  BhwCounts,
  CertificationRow,
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
  /** Households per BHW (null when household data is unavailable). */
  householdsPerBhw: number | null;
  demographics: { dimension: string; rows: DemographicRow[] }[];
  training: TrainingRow[];
  certification: CertificationRow[];
  honorarium: HonorariumRow[];
};

export function CompareColumn({
  data,
  indicator,
}: {
  data: CompareColumnData;
  indicator: Indicator | null;
}) {
  const [filters, setFilters] = useQueryStates(filterParsers, { shallow: false, history: "push" });
  const caption = `N = ${data.validatedProfiles?.toLocaleString() ?? "—"} validated profiles · ${data.geoName} · 2025 snapshot`;

  function remove() {
    const next = (filters.compareGeos ?? []).filter((c) => c !== data.geoCode);
    setFilters({ compareGeos: next.length > 0 ? next : null });
  }

  const showAll = indicator === null;
  const isSmallSample = data.validatedProfiles !== null && data.validatedProfiles < MIN_LEADER_N;

  return (
    <div className="flex min-w-72 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <Link
          href={`/place/${data.geoLevel}/${data.geoCode}`}
          className="font-semibold hover:text-accent"
        >
          {data.geoName}
        </Link>
        <button
          type="button"
          onClick={remove}
          className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface hover:text-accent"
        >
          Remove
        </button>
      </div>

      <p className="text-xs text-muted">
        {data.totalBhw !== null ? `${data.totalBhw.toLocaleString()} total BHWs · ` : ""}
        {data.validatedProfiles?.toLocaleString() ?? "—"} validated profiles
        {data.coveragePct !== null ? ` (${data.coveragePct}%)` : ""}
        {data.householdsPerBhw !== null
          ? ` · ${data.householdsPerBhw.toLocaleString()} households per BHW`
          : ""}
      </p>

      {isSmallSample && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          Small sample — rates for {data.geoName} are based on fewer than {MIN_LEADER_N} profiles
          and can swing widely.
        </p>
      )}

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
            geoCode={data.geoCode}
            geoLevel={data.geoLevel}
          />
        ))}

      {(showAll || indicator === "training") && (
        <TrainingFigure
          rows={data.training}
          caption={caption}
          geoLevel={data.geoLevel}
          citymunAncestor={null}
          geoCode={data.geoCode}
        />
      )}

      {(showAll || indicator === "certification") && (
        <CertificationFigure
          rows={data.certification}
          caption={caption}
          geoCode={data.geoCode}
          geoLevel={data.geoLevel}
        />
      )}

      {/* One honorarium story told three ways — tabbed in the all-figures view,
        exactly as Home/Explore do it. When a specific honorarium focus is
        active, the single matching figure renders instead, so every column
        shows the same figure at the same position (tab state is per column and
        would misalign a focused comparison). */}
      {showAll ? (
        <FigureTabs
          heading="Honorarium"
          tabs={[
            {
              id: "who",
              label: "Who receives",
              content: (
                <HonorariumFigure
                  rows={data.honorarium}
                  caption={caption}
                  geoCode={data.geoCode}
                  geoLevel={data.geoLevel}
                />
              ),
            },
            {
              id: "amount",
              label: "How much",
              content: (
                <HonorariumAmountFigure
                  rows={data.honorarium}
                  caption={caption}
                  geoCode={data.geoCode}
                  geoLevel={data.geoLevel}
                />
              ),
            },
            {
              id: "distribution",
              label: "Distribution",
              content: (
                <HonorariumDistributionFigure
                  rows={data.honorarium}
                  caption={caption}
                  geoCode={data.geoCode}
                  geoLevel={data.geoLevel}
                />
              ),
            },
          ]}
        />
      ) : (
        <>
          {indicator === "honorarium" && (
            <HonorariumFigure
              rows={data.honorarium}
              caption={caption}
              geoCode={data.geoCode}
              geoLevel={data.geoLevel}
            />
          )}
          {indicator === "honorarium_amount" && (
            <HonorariumAmountFigure
              rows={data.honorarium}
              caption={caption}
              geoCode={data.geoCode}
              geoLevel={data.geoLevel}
            />
          )}
          {indicator === "honorarium_distribution" && (
            <HonorariumDistributionFigure
              rows={data.honorarium}
              caption={caption}
              geoCode={data.geoCode}
              geoLevel={data.geoLevel}
            />
          )}
        </>
      )}
    </div>
  );
}
