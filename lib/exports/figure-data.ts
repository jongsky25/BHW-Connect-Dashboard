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
import type { DemographicDimension, GeoLevel, Indicator } from "@/lib/filters/schema";

export type ExportRow = { label: string; value: number };

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
      };
    }
    case "service_years": {
      const avg = counts?.avgActiveYears ?? null;
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
      };
    }
    case "certification": {
      const rows = await getCertification(params.geoCode, params.geoLevel);
      const byType = new Map(rows.map((r) => [r.certType, r]));
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
      };
    }
    case "honorarium": {
      const rows = await getHonorarium(params.geoCode, params.geoLevel);
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
      };
    }
    case "honorarium_amount": {
      const rows = await getHonorarium(params.geoCode, params.geoLevel);
      const byLevel = new Map(rows.map((r) => [r.payerLevel, r]));
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
      };
    }
    case "honorarium_distribution": {
      const rows = await getHonorarium(params.geoCode, params.geoLevel);
      const byLevel = new Map(rows.map((r) => [r.payerLevel, r]));
      const ordered = PAYER_ORDER.map((l) => byLevel.get(l)).filter(
        (r): r is NonNullable<typeof r> => !!r,
      );
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
      };
    }
    case "honorarium_sufficiency": {
      // Export parity for this indicator is Increment 5's job (`ExportFigureData`
      // gains benchmark rows + an adequacy line, then a real case body here —
      // 8 band rows, the sufficiency headline, benchmark rows for
      // `pctBelowSufficiency`). Until then this returns `null`, which every
      // `api/export/*/route.ts` already treats as "Place not found" (a plain
      // 404) — the same degrade-gracefully path an unknown geo hits today,
      // not a crash. The switch needs *a* case for this indicator now only
      // because adding it to `INDICATORS` (§3.2) makes this function's return
      // type require one (TS2366: not every code path returned a value).
      return null;
    }
  }
}
