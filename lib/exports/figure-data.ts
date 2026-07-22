import "server-only";
import {
  getBhwCounts,
  getCertification,
  getDemographics,
  getHonorarium,
  getTrainingCoverage,
} from "@/lib/db/indicators";
import { getGeoByCode } from "@/lib/db/geo";
import { getActiveDataset } from "@/lib/db/dataset";
import { getHonorariumSufficiency } from "@/lib/db/derived-figures";
import {
  getBenchmarkContext,
  benchmarkRowsFor,
  rowsFromAncestorValues,
} from "@/lib/db/benchmark-context";
import { getPeerRanks } from "@/lib/db/peer-ranks";
import { PEER_LEVEL_PLURAL, peerParentName } from "@/lib/analysis/peer-labels";
import { peerRankSentence } from "@/components/explore/peer-rank-chip";
import { MAP_BASE_INDICATOR_META } from "@/lib/analysis/map-indicators";
import {
  MIN_LEADER_N,
  HONORARIUM_SUFFICIENCY_MONTHLY_PHP,
  HONORARIUM_SUFFICIENCY_DAILY_PHP,
} from "@/lib/analysis/thresholds";
import { formatPeso } from "@/lib/format";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import type { DemographicDimension, GeoLevel, Indicator } from "@/lib/filters/schema";
import type { BenchmarkRow } from "@/components/place/benchmark";
import type { HonorariumRow, CertificationRow } from "@/lib/db/indicators";

export type ExportRow = { label: string; value: number };

/** Flat This place / region / Philippines rows for the export benchmark block —
 * same shape `BenchmarkBars` renders, minus the `isPrimary` flag (irrelevant
 * once a format like PNG/CSV joins rows into one line). */
export type ExportBenchmarkRow = { label: string; value: number | null };

export type ExportBenchmark = {
  rows: ExportBenchmarkRow[];
  /** Appended after each formatted value (e.g. "%", " yrs"), except the
   * sentinel "₱" — peso amounts are rendered with the peso sign as a prefix
   * (via `formatPeso`) instead, matching on-screen currency formatting. */
  suffix: string;
  /** Compact peer-standing sentence (`peerRankSentence`), or null when the
   * indicator isn't one of `agg_peer_ranks`'s 6 covered indicators, or this
   * geo isn't ranked (national/barangay, or n below `MIN_LEADER_N`) — never
   * approximated (Risk R1), same as the on-screen `FigureBenchmark` slot. */
  peerLine: string | null;
};

export type ExportFigureData = {
  title: string;
  geoName: string;
  caption: string;
  headline: string;
  rows: ExportRow[];
  xLabel: string;
  yLabel: string;
  valueSuffix: string;
  isSuppressed: boolean;
  technicalNote: string;
  sourceName: string;
  license: string;
  asOfDate: string | null;
  /** This place vs. its region vs. the nation, plus a peer-rank sentence —
   * export parity (Increment 5) for the "no naked numbers" rollout (E1-E4).
   * Null when there's nothing to compare (fewer than 2 usable rows and no
   * peer line — e.g. the national view, or an indicator with no comparable
   * ancestor value) or when the figure has no vertical benchmark at all
   * (demographics/training: adequacy-only, per the Increment 4 contract table). */
  benchmark?: ExportBenchmark | null;
  /** The adequacy signal (the n behind this figure) — always present, one of
   * three states matching the on-screen `AdequacyNote`: normal, small-sample
   * (n < `MIN_LEADER_N`), or suppressed (n < 5). */
  adequacyNote: string;
};

/** Same labels/order as CertificationFigure, so exports read like the screen. */
const CERT_LABEL: Record<string, string> = {
  ref_manual_trained: "BHW Reference Manual Training",
  tesda_nc2: "TESDA BHS NC II Training",
  tesda_certified: "TESDA BHS NC II Certification",
};
const CERT_ORDER = ["ref_manual_trained", "tesda_nc2", "tesda_certified"];

/** Same labels/order as the honorarium figures. */
const PAYER_LABEL: Record<string, string> = {
  region: "Region",
  province: "Province",
  citymun: "City/Municipality",
  barangay: "Barangay",
};
const PAYER_ORDER = ["region", "province", "citymun", "barangay"];

const DIMENSION_LABEL: Record<DemographicDimension, string> = {
  sex: "Sex",
  age_band: "Age",
  civil_status: "Civil status",
  bloodtype: "Blood type",
  education: "Educational attainment",
  ip_status: "Indigenous people (IP) status",
};

/** The barangay-payer figure the honorarium amount/distribution exports read
 * (contract table: "barangay-payer avgMonthlyAmount/medianAmount vs
 * region/nation, ancestor `getHonorarium`"). */
const barangayAvgMonthlyAmount = (rows: HonorariumRow[]): number | null =>
  rows.find((r) => r.payerLevel === "barangay")?.avgMonthlyAmount ?? null;
const barangayMedianAmount = (rows: HonorariumRow[]): number | null =>
  rows.find((r) => r.payerLevel === "barangay")?.medianAmount ?? null;
const tesdaCertifiedPct = (rows: CertificationRow[]): number | null =>
  rows.find((r) => r.certType === "tesda_certified")?.pct ?? null;

/** Adequacy n for the honorarium amount/distribution figures: the largest
 * recipient count across paying levels (contract table: "max nReceiving"). */
function maxNReceiving(rows: HonorariumRow[]): number | null {
  const values = rows.map((r) => r.nReceiving).filter((v): v is number => v !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

/**
 * The adequacy signal, as text — the same three states as the on-screen
 * `AdequacyNote` (`components/narrative/figure-benchmark.tsx`): suppressed
 * (n<5), small-sample (n < `MIN_LEADER_N`), or normal. `adequacyNote` is
 * always present on `ExportFigureData`, so this never returns null; a
 * missing n (no adequacy signal to report) is the empty string.
 */
function adequacyNoteFor(
  n: number | null,
  nLabel = "validated profiles",
  suppressed = false,
): string {
  if (suppressed) {
    return "Withheld — fewer than 5 individuals; suppressed to protect privacy.";
  }
  if (n === null) return "";
  if (n < MIN_LEADER_N) {
    return `Small sample — n = ${n.toLocaleString()} (fewer than ${MIN_LEADER_N}); rates can swing widely.`;
  }
  return `Based on n = ${n.toLocaleString()} ${nLabel}.`;
}

/**
 * Flattens `BenchmarkRow[]` + a peer-rank sentence into the export
 * `ExportBenchmark` shape, or null when there's nothing worth showing —
 * mirrors `BenchmarkBars`' own "fewer than 2 usable rows → render nothing"
 * rule (`components/place/benchmark.tsx:38`), except a non-null peer line
 * alone is still enough to keep the block (e.g. a figure with only a self
 * value but a real peer rank).
 */
function toExportBenchmark(
  rows: BenchmarkRow[],
  suffix: string,
  peerLine: string | null,
): ExportBenchmark | null {
  const usable = rows.filter((r) => r.value !== null).length;
  if (usable < 2 && !peerLine) return null;
  return { rows: rows.map((r) => ({ label: r.label, value: r.value })), suffix, peerLine };
}

/**
 * One normalized data shape for any exportable figure, built from the exact
 * same lib/db query functions the on-screen FigureCards use — so an export
 * can never show a number the page didn't (and suppression is enforced
 * exactly once, here, rather than re-implemented per export format).
 */
export async function getExportFigureData(params: {
  geoCode: string;
  geoLevel: GeoLevel;
  indicator: Indicator;
  dimension?: DemographicDimension;
}): Promise<ExportFigureData | null> {
  const [geo, dataset, counts] = await Promise.all([
    getGeoByCode(params.geoCode),
    getActiveDataset(),
    getBhwCounts(params.geoCode, params.geoLevel),
  ]);
  if (!geo) return null;

  const shared = {
    geoName: geo.geoName,
    caption: `N = ${counts?.nTotal?.toLocaleString() ?? "—"} BHWs · ${geo.geoName} · 2025 snapshot`,
    sourceName: dataset?.sourceName ?? "Official DOH BHW registration/accreditation dataset",
    license: dataset?.license ?? "CC BY 4.0",
    asOfDate: dataset?.asOfDate ?? null,
  };

  switch (params.indicator) {
    case "accreditation": {
      const pct = counts?.pctAccredited ?? null;
      const benchmarkCtx = await getBenchmarkContext(params.geoCode, params.geoLevel, geo.geoName);
      const peerRanks = await getPeerRanks(params.geoCode, params.geoLevel, ["pct_accredited"]);
      const peerLine = peerRankSentence({
        rank: peerRanks.get("pct_accredited") ?? null,
        geoName: geo.geoName,
        parentName: peerParentName(params.geoLevel, benchmarkCtx.ancestors),
        siblingPlural: PEER_LEVEL_PLURAL[params.geoLevel] ?? "",
        indicatorLabel: MAP_BASE_INDICATOR_META.pct_accredited.label,
      });
      const benchmark = benchmarkCtx.showBenchmarks
        ? toExportBenchmark(
            benchmarkRowsFor(benchmarkCtx, (s) => s.counts?.pctAccredited ?? null),
            "%",
            peerLine,
          )
        : peerLine
          ? { rows: [], suffix: "%", peerLine }
          : null;
      return {
        ...shared,
        title: "Accreditation",
        headline: pct !== null ? `About ${Math.round(pct)}% of BHWs here are accredited.` : "No data.",
        rows: pct !== null ? [{ label: "Accredited", value: pct }, { label: "Not accredited", value: Math.round((100 - pct) * 100) / 100 }] : [],
        xLabel: "% of BHWs",
        yLabel: "Accreditation status",
        valueSuffix: "%",
        isSuppressed: false,
        technicalNote: `${counts?.nAccredited?.toLocaleString() ?? "—"} of ${counts?.nTotal?.toLocaleString() ?? "—"} BHWs are accredited.`,
        benchmark,
        adequacyNote: adequacyNoteFor(counts?.nTotal ?? null),
      };
    }
    case "service_years": {
      const avg = counts?.avgActiveYears ?? null;
      const benchmarkCtx = await getBenchmarkContext(params.geoCode, params.geoLevel, geo.geoName);
      const peerRanks = await getPeerRanks(params.geoCode, params.geoLevel, ["avg_active_years"]);
      const peerLine = peerRankSentence({
        rank: peerRanks.get("avg_active_years") ?? null,
        geoName: geo.geoName,
        parentName: peerParentName(params.geoLevel, benchmarkCtx.ancestors),
        siblingPlural: PEER_LEVEL_PLURAL[params.geoLevel] ?? "",
        indicatorLabel: MAP_BASE_INDICATOR_META.avg_active_years.label,
      });
      const benchmark = benchmarkCtx.showBenchmarks
        ? toExportBenchmark(
            benchmarkRowsFor(benchmarkCtx, (s) => s.counts?.avgActiveYears ?? null),
            " yrs",
            peerLine,
          )
        : peerLine
          ? { rows: [], suffix: " yrs", peerLine }
          : null;
      return {
        ...shared,
        title: "Average years of service",
        headline: avg !== null ? `BHWs here have served an average of ${avg} years.` : "No data.",
        rows: avg !== null ? [{ label: "Average years", value: avg }] : [],
        xLabel: "Years of service",
        yLabel: "Metric",
        valueSuffix: "",
        isSuppressed: false,
        technicalNote: "Computed from each BHW's recorded active-service years.",
        benchmark,
        adequacyNote: adequacyNoteFor(counts?.nTotal ?? null),
      };
    }
    case "demographics": {
      const dimension = params.dimension ?? "sex";
      const demoRows = await getDemographics(params.geoCode, params.geoLevel, [dimension]);
      const isSuppressed = demoRows.some((r) => r.isSuppressed);
      return {
        ...shared,
        title: DIMENSION_LABEL[dimension],
        headline: isSuppressed
          ? "This breakdown is suppressed to protect individual privacy (n<5)."
          : "Breakdown by " + DIMENSION_LABEL[dimension].toLowerCase() + ".",
        rows: isSuppressed
          ? []
          : demoRows.filter((r) => r.pct !== null).map((r) => ({ label: r.category, value: r.pct as number })),
        xLabel: "% of BHWs",
        yLabel: DIMENSION_LABEL[dimension],
        valueSuffix: "%",
        isSuppressed,
        technicalNote:
          "Individual-level breakdowns are suppressed when a geo has fewer than 5 BHWs, to prevent re-identification.",
        // Adequacy-only (Increment 4 contract table): no single headline value
        // to benchmark vertically or rank against peers.
        benchmark: null,
        adequacyNote: adequacyNoteFor(counts?.nTotal ?? null),
      };
    }
    case "training": {
      const rows = await getTrainingCoverage(params.geoCode, params.geoLevel);
      return {
        ...shared,
        title: "Training coverage",
        headline: params.geoLevel === "barangay" ? "Not tracked at the barangay level." : "Coverage by training topic.",
        rows: rows.filter((r) => r.coveragePct !== null).map((r) => ({ label: r.topicLabel ?? r.topicSlug, value: r.coveragePct as number })),
        xLabel: "% trained",
        yLabel: "Training topic",
        valueSuffix: "%",
        isSuppressed: false,
        technicalNote: "agg_training is computed at national/region/province/citymun level only.",
        // Adequacy-only (Increment 4 contract table): 44 topics have no single
        // headline value to benchmark or rank.
        benchmark: null,
        adequacyNote: adequacyNoteFor(counts?.nTotal ?? null),
      };
    }
    case "certification": {
      const rows = await getCertification(params.geoCode, params.geoLevel);
      const byType = new Map(rows.map((r) => [r.certType, r]));
      const benchmarkCtx = await getBenchmarkContext(params.geoCode, params.geoLevel, geo.geoName);
      const regionCode = benchmarkCtx.ancestors.region?.geoCode ?? null;
      const [regionCert, nationalCert] = await Promise.all([
        benchmarkCtx.region && regionCode
          ? getCertification(regionCode, "region")
          : Promise.resolve<CertificationRow[]>([]),
        benchmarkCtx.national
          ? getCertification(NATIONAL_GEO_CODE, "national")
          : Promise.resolve<CertificationRow[]>([]),
      ]);
      const benchmark = benchmarkCtx.showBenchmarks
        ? toExportBenchmark(
            rowsFromAncestorValues(
              benchmarkCtx,
              tesdaCertifiedPct(rows),
              tesdaCertifiedPct(regionCert),
              tesdaCertifiedPct(nationalCert),
            ),
            "%",
            // Not one of `agg_peer_ranks`'s 6 covered indicators — never faked.
            null,
          )
        : null;
      return {
        ...shared,
        title: "Training & certification coverage",
        headline: "% of BHWs with each training/certification, tracked independently.",
        rows: CERT_ORDER.map((t) => byType.get(t))
          .filter((r): r is NonNullable<typeof r> => !!r && r.pct !== null)
          .map((r) => ({ label: CERT_LABEL[r.certType] ?? r.certType, value: r.pct as number })),
        xLabel: "% of BHWs",
        yLabel: "Training / certification",
        valueSuffix: "%",
        isSuppressed: false,
        technicalNote:
          "Reference Manual training, TESDA NC II training, and TESDA NC II certification are tracked independently; a BHW may have any combination of the three.",
        benchmark,
        adequacyNote: adequacyNoteFor(counts?.nTotal ?? null),
      };
    }
    case "honorarium": {
      const rows = await getHonorarium(params.geoCode, params.geoLevel);
      const benchmarkCtx = await getBenchmarkContext(params.geoCode, params.geoLevel, geo.geoName);
      const peerRanks = await getPeerRanks(params.geoCode, params.geoLevel, ["any_honorarium_pct"]);
      const peerLine = peerRankSentence({
        rank: peerRanks.get("any_honorarium_pct") ?? null,
        geoName: geo.geoName,
        parentName: peerParentName(params.geoLevel, benchmarkCtx.ancestors),
        siblingPlural: PEER_LEVEL_PLURAL[params.geoLevel] ?? "",
        indicatorLabel: MAP_BASE_INDICATOR_META.any_honorarium_pct.label,
      });
      const benchmark = benchmarkCtx.showBenchmarks
        ? toExportBenchmark(
            benchmarkRowsFor(benchmarkCtx, (s) => s.counts?.anyHonorariumPct ?? null),
            "%",
            peerLine,
          )
        : peerLine
          ? { rows: [], suffix: "%", peerLine }
          : null;
      return {
        ...shared,
        title: "Honorarium, by paying level",
        headline: "% of BHWs receiving honorarium, by paying administrative level.",
        rows: rows.filter((r) => r.pctReceiving !== null).map((r) => ({ label: PAYER_LABEL[r.payerLevel] ?? r.payerLevel, value: r.pctReceiving as number })),
        xLabel: "% of BHWs receiving",
        yLabel: "Paying level",
        valueSuffix: "%",
        isSuppressed: false,
        technicalNote: "A BHW may receive honorarium from more than one level; percentages aren't mutually exclusive.",
        benchmark,
        adequacyNote: adequacyNoteFor(counts?.nTotal ?? null),
      };
    }
    case "honorarium_amount": {
      const rows = await getHonorarium(params.geoCode, params.geoLevel);
      const byLevel = new Map(rows.map((r) => [r.payerLevel, r]));
      const benchmarkCtx = await getBenchmarkContext(params.geoCode, params.geoLevel, geo.geoName);
      const regionCode = benchmarkCtx.ancestors.region?.geoCode ?? null;
      const [regionRows, nationalRows] = await Promise.all([
        benchmarkCtx.region && regionCode
          ? getHonorarium(regionCode, "region")
          : Promise.resolve<HonorariumRow[]>([]),
        benchmarkCtx.national
          ? getHonorarium(NATIONAL_GEO_CODE, "national")
          : Promise.resolve<HonorariumRow[]>([]),
      ]);
      const benchmark = benchmarkCtx.showBenchmarks
        ? toExportBenchmark(
            rowsFromAncestorValues(
              benchmarkCtx,
              barangayAvgMonthlyAmount(rows),
              barangayAvgMonthlyAmount(regionRows),
              barangayAvgMonthlyAmount(nationalRows),
            ),
            "₱",
            // No `agg_peer_ranks` coverage for honorarium amount.
            null,
          )
        : null;
      return {
        ...shared,
        title: "Average honorarium amount, by paying level",
        headline: "Average monthly honorarium among BHWs who receive one from that level.",
        rows: PAYER_ORDER.map((l) => byLevel.get(l))
          .filter((r): r is NonNullable<typeof r> => !!r && r.avgMonthlyAmount !== null)
          .map((r) => ({ label: PAYER_LABEL[r.payerLevel] ?? r.payerLevel, value: r.avgMonthlyAmount as number })),
        xLabel: "Average ₱ per month",
        yLabel: "Paying level",
        valueSuffix: "",
        isSuppressed: false,
        technicalNote:
          "Amounts are monthly averages in pesos, among BHWs receiving from that level. A BHW may receive from more than one level, so averages are not additive across levels.",
        benchmark,
        adequacyNote: adequacyNoteFor(maxNReceiving(rows), "recipients"),
      };
    }
    case "honorarium_distribution": {
      const rows = await getHonorarium(params.geoCode, params.geoLevel);
      const byLevel = new Map(rows.map((r) => [r.payerLevel, r]));
      const ordered = PAYER_ORDER.map((l) => byLevel.get(l)).filter(
        (r): r is NonNullable<typeof r> => !!r,
      );
      const benchmarkCtx = await getBenchmarkContext(params.geoCode, params.geoLevel, geo.geoName);
      const regionCode = benchmarkCtx.ancestors.region?.geoCode ?? null;
      const [regionRows, nationalRows] = await Promise.all([
        benchmarkCtx.region && regionCode
          ? getHonorarium(regionCode, "region")
          : Promise.resolve<HonorariumRow[]>([]),
        benchmarkCtx.national
          ? getHonorarium(NATIONAL_GEO_CODE, "national")
          : Promise.resolve<HonorariumRow[]>([]),
      ]);
      const benchmark = benchmarkCtx.showBenchmarks
        ? toExportBenchmark(
            rowsFromAncestorValues(
              benchmarkCtx,
              barangayMedianAmount(rows),
              barangayMedianAmount(regionRows),
              barangayMedianAmount(nationalRows),
            ),
            "₱",
            // No `agg_peer_ranks` coverage for honorarium distribution.
            null,
          )
        : null;
      // The flat {label, value} export contract can't carry a five-number
      // summary per row, so each (level, statistic) becomes its own row —
      // "Barangay — median" etc. — matching the figure's companion table.
      const stats = [
        ["min", (r: (typeof ordered)[number]) => r.minAmount],
        ["p25", (r: (typeof ordered)[number]) => r.p25Amount],
        ["median", (r: (typeof ordered)[number]) => r.medianAmount],
        ["p75", (r: (typeof ordered)[number]) => r.p75Amount],
        ["max", (r: (typeof ordered)[number]) => r.maxAmount],
      ] as const;
      const suppressedLevels = ordered.filter((r) => r.isSuppressed);
      return {
        ...shared,
        title: "Honorarium distribution, by paying level",
        headline:
          "Monthly honorarium min/p25/median/p75/max among BHWs receiving from each level.",
        rows: ordered.flatMap((r) =>
          stats
            .filter(([, pick]) => pick(r) !== null)
            .map(([stat, pick]) => ({
              label: `${PAYER_LABEL[r.payerLevel] ?? r.payerLevel} — ${stat}`,
              value: pick(r) as number,
            })),
        ),
        xLabel: "₱ per month",
        yLabel: "Paying level · statistic",
        valueSuffix: "",
        isSuppressed: false,
        technicalNote:
          "Amounts are monthly, in pesos, among BHWs receiving from that level." +
          (suppressedLevels.length > 0
            ? ` Distribution values are withheld for ${suppressedLevels
                .map((r) => PAYER_LABEL[r.payerLevel] ?? r.payerLevel)
                .join(", ")} (fewer than 5 recipients at this geography, to prevent re-identification).`
            : ""),
        benchmark,
        adequacyNote: adequacyNoteFor(maxNReceiving(rows), "recipients"),
      };
    }
    case "honorarium_sufficiency": {
      const sufficiency = await getHonorariumSufficiency(params.geoCode, params.geoLevel);

      if (!sufficiency) {
        return {
          ...shared,
          title: "Honorarium sufficiency",
          headline:
            params.geoLevel === "barangay"
              ? "Sufficiency figures aren't available at the barangay level."
              : "No honorarium-sufficiency data for this area.",
          rows: [],
          xLabel: "% of profiled BHWs",
          yLabel: "Cumulative monthly honorarium",
          valueSuffix: "%",
          isSuppressed: false,
          technicalNote:
            "The sufficiency figure is built down to the city/municipality level. Barangay pages show their city/municipality's figure instead.",
          benchmark: null,
          adequacyNote: adequacyNoteFor(null),
        };
      }

      if (sufficiency.isSuppressed || sufficiency.pctBelowSufficiency === null) {
        return {
          ...shared,
          title: "Honorarium sufficiency",
          headline: "Too few profiled BHWs here to show a sufficiency figure.",
          rows: [],
          xLabel: "% of profiled BHWs",
          yLabel: "Cumulative monthly honorarium",
          valueSuffix: "%",
          isSuppressed: true,
          technicalNote:
            "Withheld — fewer than 5 profiled BHWs at this geography, to prevent re-identification.",
          benchmark: null,
          adequacyNote: adequacyNoteFor(sufficiency.nTotal, "validated profiles", true),
        };
      }

      const visibleBands = sufficiency.bands.filter((b) => !b.isSuppressed && b.pct !== null);
      const suppressedBands = sufficiency.bands.filter((b) => b.isSuppressed);
      const medianDaily =
        sufficiency.medianCumulativeMonthly !== null
          ? Math.round(sufficiency.medianCumulativeMonthly / 30)
          : null;

      const headline =
        `${sufficiency.pctBelowSufficiency}% of profiled BHWs here receive less than ₱${HONORARIUM_SUFFICIENCY_DAILY_PHP.toFixed(0)} per day in total honorarium` +
        (medianDaily !== null && sufficiency.medianCumulativeMonthly !== null
          ? ` (median ₱${medianDaily}/day, ${formatPeso(sufficiency.medianCumulativeMonthly)}/month).`
          : ".");

      const benchmarkCtx = await getBenchmarkContext(params.geoCode, params.geoLevel, geo.geoName);
      const regionCode = benchmarkCtx.ancestors.region?.geoCode ?? null;
      const [regionSufficiency, nationalSufficiency] = await Promise.all([
        benchmarkCtx.region && regionCode
          ? getHonorariumSufficiency(regionCode, "region")
          : Promise.resolve(null),
        benchmarkCtx.national
          ? getHonorariumSufficiency(NATIONAL_GEO_CODE, "national")
          : Promise.resolve(null),
      ]);
      const benchmark = benchmarkCtx.showBenchmarks
        ? toExportBenchmark(
            rowsFromAncestorValues(
              benchmarkCtx,
              sufficiency.pctBelowSufficiency,
              regionSufficiency?.pctBelowSufficiency ?? null,
              nationalSufficiency?.pctBelowSufficiency ?? null,
            ),
            "%",
            // Sufficiency isn't in `agg_peer_ranks` this pass (Risk R1 follow-up).
            null,
          )
        : null;

      return {
        ...shared,
        title: "Honorarium sufficiency",
        headline,
        rows: visibleBands.map((b) => ({ label: b.bandLabel, value: b.pct as number })),
        xLabel: "% of profiled BHWs",
        yLabel: "Cumulative monthly honorarium",
        valueSuffix: "%",
        isSuppressed: false,
        technicalNote:
          `Denominator is every profiled BHW here, including those who receive no honorarium — contrast the recipients-only "Distribution"/"Inequality" figures. Each BHW's honorarium is cumulative across every paying level (region, province, city/municipality, barangay), then compared against the ₱${HONORARIUM_SUFFICIENCY_MONTHLY_PHP.toLocaleString()}/month sufficiency cut (≈₱${HONORARIUM_SUFFICIENCY_DAILY_PHP.toFixed(0)}/day, 30-day month convention). Built down to the city/municipality level.` +
          (suppressedBands.length > 0
            ? ` Bands withheld for fewer than 5 BHWs: ${suppressedBands.map((b) => b.bandLabel).join(", ")}.`
            : ""),
        benchmark,
        adequacyNote: adequacyNoteFor(sufficiency.nTotal),
      };
    }
  }
}

/**
 * Joins export benchmark rows into one line, e.g. "This place 62% · Region
 * VII 71% · Philippines 68%" — shared by every export format (PNG/PPTX/CSV/
 * XLSX) so the same numbers read identically everywhere instead of four
 * separate re-implementations. `suffix === "₱"` formats each value as a peso
 * amount (prefix, via `formatPeso`); every other suffix is appended directly
 * after a value rounded to one decimal place.
 */
export function formatBenchmarkLine(benchmark: ExportBenchmark): string {
  return benchmark.rows
    .filter((r): r is { label: string; value: number } => r.value !== null)
    .map((r) =>
      benchmark.suffix === "₱"
        ? `${r.label} ${formatPeso(r.value)}`
        : `${r.label} ${Math.round(r.value * 10) / 10}${benchmark.suffix}`,
    )
    .join(" · ");
}
