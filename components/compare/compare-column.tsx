"use client";

import Link from "next/link";
import { useFilterState } from "@/lib/filters/use-filter-state";
import type { GeoLevel } from "@/lib/filters/schema";
import { MIN_LEADER_N } from "@/lib/analysis/thresholds";
import { PEER_LEVEL_PLURAL, toFigurePeer } from "@/lib/analysis/peer-labels";
import { MAP_BASE_INDICATOR_META } from "@/lib/analysis/map-indicators";
import { FigureCard } from "@/components/narrative/figure-card";
import { FigureBenchmark, type FigureBenchmarkProps } from "@/components/narrative/figure-benchmark";
import { FigureTabs } from "@/components/ui/figure-tabs";
import { DemographicsFigure } from "@/components/explore/demographics-figure";
import { TrainingFigure } from "@/components/explore/training-figure";
import { CertificationFigure } from "@/components/explore/certification-figure";
import { HonorariumFigure } from "@/components/explore/honorarium-figure";
import { HonorariumAmountFigure } from "@/components/explore/honorarium-amount-figure";
import { HonorariumDistributionFigure } from "@/components/explore/honorarium-distribution-figure";
import { HonorariumSufficiencyFigure } from "@/components/explore/honorarium-sufficiency-figure";
import type {
  BhwCounts,
  CertificationRow,
  DemographicRow,
  HonorariumRow,
  TrainingRow,
} from "@/lib/db/indicators";
import type { HonorariumSufficiencyRow } from "@/lib/db/derived-figures";
import type { PeerRank } from "@/lib/db/peer-ranks";
import type { Indicator } from "@/lib/filters/schema";

/** This column's place vs. the Philippines only — no region row (Increment 4
 * §4.4: four places' regions would be noise; the head-to-head strip above
 * already covers across-places comparison). Built once on the server from the
 * already-fetched national values and reused by every column (Risk R8: plain,
 * serializable data — no functions/ReactNode). */
export type CompareNationalReference = {
  counts: {
    pctAccredited: number | null;
    avgActiveYears: number | null;
    anyHonorariumPct: number | null;
    nTotal: number | null;
  } | null;
  certification: CertificationRow[];
  honorarium: HonorariumRow[];
  honorariumSufficiency: HonorariumSufficiencyRow | null;
};

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
  honorariumSufficiency: HonorariumSufficiencyRow | null;
  /** This geo's standing among its same-level siblings, for the 4
   * `agg_peer_ranks`-covered indicators with a column figure — keyed by
   * indicator, absent (or null) when unranked (Risk R1: never faked). */
  peerRanks: Record<string, PeerRank | null>;
  /** Place-vs-nation reference for every column figure's benchmark rows. */
  nationalReference: CompareNationalReference | null;
};

const tesdaCertifiedPct = (rows: CertificationRow[]): number | null =>
  rows.find((r) => r.certType === "tesda_certified")?.pct ?? null;

const barangayAvgMonthlyAmount = (rows: HonorariumRow[]): number | null =>
  rows.find((r) => r.payerLevel === "barangay")?.avgMonthlyAmount ?? null;

const barangayMedianAmount = (rows: HonorariumRow[]): number | null =>
  rows.find((r) => r.payerLevel === "barangay")?.medianAmount ?? null;

function maxNReceiving(rows: HonorariumRow[]): number | null {
  const values = rows.map((r) => r.nReceiving).filter((v): v is number => v !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

/** This place / Philippines only (no region row — Increment 4 §4.4). The
 * Philippines row is included whenever `nationalReference` was fetched at
 * all, even if the specific value inside it is null, matching how
 * `rowsFromAncestorValues` treats a present-but-null ancestor value. */
function placeVsNationRows(
  data: CompareColumnData,
  selfValue: number | null,
  nationalValue: number | null,
): FigureBenchmarkProps["rows"] {
  return [
    { label: data.geoName, value: selfValue, isPrimary: true },
    ...(data.nationalReference ? [{ label: "Philippines", value: nationalValue }] : []),
  ];
}

/** Flattens this column's batched peer-rank map into the shape
 * `FigureBenchmark` renders — parentName is omitted (null) here: Compare's
 * columns don't carry ancestor data (place-vs-nation only), so the sentence
 * reads "Ranks 3rd of 17 provinces on % accredited" without the "in {region}"
 * clause, still accurate and never fabricated (Risk R1). */
function peerFor(
  data: CompareColumnData,
  indicatorKey: string,
  meta: { label: string },
) {
  return toFigurePeer(data.peerRanks[indicatorKey] ?? null, null, PEER_LEVEL_PLURAL[data.geoLevel] ?? "", meta.label);
}

export function CompareColumn({
  data,
  indicator,
}: {
  data: CompareColumnData;
  indicator: Indicator | null;
}) {
  const [filters, setFilters] = useFilterState();
  const caption = `N = ${data.validatedProfiles?.toLocaleString() ?? "—"} validated profiles · ${data.geoName} · 2025 snapshot`;

  function remove() {
    const next = (filters.compareGeos ?? []).filter((c) => c !== data.geoCode);
    setFilters({ compareGeos: next.length > 0 ? next : null });
  }

  const showAll = indicator === null;
  const isSmallSample = data.validatedProfiles !== null && data.validatedProfiles < MIN_LEADER_N;

  // Built once and shared by both the tabbed (showAll) and single-focus
  // render paths below, so the two can never disagree on a benchmark.
  const sufficiencyBenchmark: FigureBenchmarkProps = {
    rows: placeVsNationRows(
      data,
      data.honorariumSufficiency?.pctBelowSufficiency ?? null,
      data.nationalReference?.honorariumSufficiency?.pctBelowSufficiency ?? null,
    ),
    format: "percent",
    n: data.honorariumSufficiency?.nTotal ?? null,
  };
  const whoBenchmark: FigureBenchmarkProps = {
    rows: placeVsNationRows(
      data,
      data.counts?.anyHonorariumPct ?? null,
      data.nationalReference?.counts?.anyHonorariumPct ?? null,
    ),
    format: "percent",
    peer: peerFor(data, "any_honorarium_pct", MAP_BASE_INDICATOR_META.any_honorarium_pct),
    n: data.counts?.nTotal ?? null,
  };
  const amountBenchmark: FigureBenchmarkProps = {
    rows: placeVsNationRows(
      data,
      barangayAvgMonthlyAmount(data.honorarium),
      barangayAvgMonthlyAmount(data.nationalReference?.honorarium ?? []),
    ),
    format: "peso",
    n: maxNReceiving(data.honorarium),
    nLabel: "recipients",
  };
  const distributionBenchmark: FigureBenchmarkProps = {
    rows: placeVsNationRows(
      data,
      barangayMedianAmount(data.honorarium),
      barangayMedianAmount(data.nationalReference?.honorarium ?? []),
    ),
    format: "peso",
    n: maxNReceiving(data.honorarium),
    nLabel: "recipients",
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 sm:min-w-72 sm:flex-1">
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
          className="rounded-md px-3 py-2 text-xs text-muted hover:bg-surface hover:text-accent"
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
          benchmark={
            <FigureBenchmark
              rows={placeVsNationRows(
                data,
                data.counts?.pctAccredited ?? null,
                data.nationalReference?.counts?.pctAccredited ?? null,
              )}
              format="percent"
              peer={peerFor(data, "pct_accredited", MAP_BASE_INDICATOR_META.pct_accredited)}
              n={data.counts?.nTotal ?? null}
            />
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
          benchmark={
            <FigureBenchmark
              rows={placeVsNationRows(
                data,
                data.counts?.avgActiveYears ?? null,
                data.nationalReference?.counts?.avgActiveYears ?? null,
              )}
              format="count"
              unitSuffix="yrs"
              peer={peerFor(data, "avg_active_years", MAP_BASE_INDICATOR_META.avg_active_years)}
              n={data.counts?.nTotal ?? null}
            />
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
            benchmark={{ n: data.counts?.nTotal ?? null }}
          />
        ))}

      {(showAll || indicator === "training") && (
        <TrainingFigure
          rows={data.training}
          caption={caption}
          geoLevel={data.geoLevel}
          citymunAncestor={null}
          geoCode={data.geoCode}
          benchmark={{ n: data.counts?.nTotal ?? null }}
        />
      )}

      {(showAll || indicator === "certification") && (
        <CertificationFigure
          rows={data.certification}
          caption={caption}
          geoCode={data.geoCode}
          geoLevel={data.geoLevel}
          benchmark={{
            rows: placeVsNationRows(
              data,
              tesdaCertifiedPct(data.certification),
              tesdaCertifiedPct(data.nationalReference?.certification ?? []),
            ),
            format: "percent",
            n: data.counts?.nTotal ?? null,
          }}
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
              id: "sufficiency",
              label: "Is it enough?",
              content: (
                <HonorariumSufficiencyFigure
                  data={data.honorariumSufficiency}
                  caption={caption}
                  geoCode={data.geoCode}
                  geoLevel={data.geoLevel}
                  benchmark={sufficiencyBenchmark}
                />
              ),
            },
            {
              id: "who",
              label: "Who receives",
              content: (
                <HonorariumFigure
                  rows={data.honorarium}
                  caption={caption}
                  geoCode={data.geoCode}
                  geoLevel={data.geoLevel}
                  benchmark={whoBenchmark}
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
                  benchmark={amountBenchmark}
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
                  benchmark={distributionBenchmark}
                />
              ),
            },
          ]}
        />
      ) : (
        <>
          {indicator === "honorarium_sufficiency" && (
            <HonorariumSufficiencyFigure
              data={data.honorariumSufficiency}
              caption={caption}
              geoCode={data.geoCode}
              geoLevel={data.geoLevel}
              benchmark={sufficiencyBenchmark}
            />
          )}
          {indicator === "honorarium" && (
            <HonorariumFigure
              rows={data.honorarium}
              caption={caption}
              geoCode={data.geoCode}
              geoLevel={data.geoLevel}
              benchmark={whoBenchmark}
            />
          )}
          {indicator === "honorarium_amount" && (
            <HonorariumAmountFigure
              rows={data.honorarium}
              caption={caption}
              geoCode={data.geoCode}
              geoLevel={data.geoLevel}
              benchmark={amountBenchmark}
            />
          )}
          {indicator === "honorarium_distribution" && (
            <HonorariumDistributionFigure
              rows={data.honorarium}
              caption={caption}
              geoCode={data.geoCode}
              geoLevel={data.geoLevel}
              benchmark={distributionBenchmark}
            />
          )}
        </>
      )}
    </div>
  );
}
