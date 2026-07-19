import "server-only";
import {
  getBhwCounts,
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
    case "honorarium": {
      const rows = await getHonorarium(params.geoCode, params.geoLevel);
      const labels: Record<string, string> = { region: "Region", province: "Province", citymun: "City/Municipality", barangay: "Barangay" };
      return {
        ...shared,
        title: "Honorarium, by paying level",
        headline: "% of BHWs receiving honorarium, by paying administrative level.",
        rows: rows.filter((r) => r.pctReceiving !== null).map((r) => ({ label: labels[r.payerLevel] ?? r.payerLevel, value: r.pctReceiving as number })),
        xLabel: "% of BHWs receiving",
        yLabel: "Paying level",
        valueSuffix: "%",
        isSuppressed: false,
        technicalNote: "A BHW may receive honorarium from more than one level; percentages aren't mutually exclusive.",
      };
    }
  }
}
