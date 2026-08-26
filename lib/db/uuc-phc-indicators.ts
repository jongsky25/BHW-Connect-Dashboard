import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";
import { getChildGeos } from "./geo";

/**
 * UUC for PHC 2025 — the indicator values behind the list (plan U3).
 *
 * These are the measurements each barangay was assessed on under DOH AO No. 2020-0023, read at
 * barangay grain and **only** at barangay grain. That is a deliberate limit, not an omission:
 *
 * **1,584 values across 1,397 barangays were bounded during cleaning.** The source recorded Water
 * as high as 9,594% and FIC as 18,088; those were capped at 100 (coverage percentages) or 1,000
 * (rates per 1,000). Afterwards 886 Water and 456 FIC values read as exactly 100% with nothing to
 * separate them from barangays genuinely at full coverage. `capped` on each reading is what
 * separates them — and a marker can travel with a single rendered value, but not through a mean or
 * a median. So this module exposes readings, never averages, and the section publishes no
 * indicator aggregates. See `docs/UUC_PHC_2025_CLEANING_REPORT.md` §6.
 */

/** The seven health indicators of criterion (d). FP CU — the order's eighth, Contraceptive
 * Prevalence Rate — was dropped by the source office before reconciliation. */
export const HEALTH_INDICATORS = [
  {
    key: "imr",
    label: "Infant mortality",
    unit: "per 1,000 live births",
    higherIsWorse: true,
    max: 1000,
  },
  {
    key: "ufmr",
    label: "Under-five mortality",
    unit: "per 1,000 live births",
    higherIsWorse: true,
    max: 1000,
  },
  {
    key: "abr",
    label: "Adolescent birth rate",
    unit: "per 1,000 women 10–19",
    higherIsWorse: true,
    max: 1000,
  },
  { key: "fic", label: "Fully immunised children", unit: "%", higherIsWorse: false, max: 100 },
  { key: "pre_natal", label: "4+ pre-natal visits", unit: "%", higherIsWorse: false, max: 100 },
  { key: "sba", label: "Skilled birth attendance", unit: "%", higherIsWorse: false, max: 100 },
  { key: "water", label: "Improved water supply", unit: "%", higherIsWorse: false, max: 100 },
] as const;

export type IndicatorKey = (typeof HEALTH_INDICATORS)[number]["key"];

export type IndicatorReading = {
  key: IndicatorKey;
  label: string;
  unit: string;
  value: number | null;
  /** The province's figure for this indicator — what criterion (d) compares against. */
  provincialRef: number | null;
  /** Whether the barangay performs worse than its province here. Null when the comparison cannot
   * be made — the honest answer, not "no worse than". Two cases: the province supplied no
   * benchmark (57 barangays), or the benchmark is impossible for the indicator (see
   * `benchmarkUnusable`). */
  worseThanProvince: boolean | null;
  /** The province's benchmark exceeds the maximum this indicator can take — a coverage figure
   * above 100%. No barangay can reach it, so "worse than province" would be true by construction
   * and mean nothing. Affects FIC in two provinces (113 barangays): their benchmarks were left
   * uncapped while barangay values were capped. See docs/UUC_PHC_2025_CLEANING_REPORT.md §6. */
  benchmarkUnusable: boolean;
  /** The value was bounded during cleaning: it is a ceiling the source overshot, not a
   * measurement. Rendering it without saying so would assert a coverage level the data does not
   * support. */
  capped: boolean;
};

/** One of the socio-economic routes a barangay can qualify by (AO §VI.A, criteria a–c). */
export type QualifyingFactor = {
  key: string;
  label: string;
  /** The measured percentage, or null where the source left it blank. */
  value: number | null;
  threshold: number;
  met: boolean | null;
};

export type UucPhcBarangayDetail = {
  geoCode: string;
  geoName: string;
  /** % of sitios/puroks more than 60 minutes from a health facility. At least 25 in every listed
   * barangay — below that a barangay never entered the list. */
  physicalFactor: number | null;
  factors: QualifyingFactor[];
  /** Designated a conflict-affected barangay. */
  elcac: boolean | null;
  health: IndicatorReading[];
  /** How many of this barangay's values were bounded during cleaning. */
  cappedCount: number;
};

export type Row = {
  geo_code: string;
  physical_factor: number | null;
  ip_pop: number | null;
  armed_conf: number | null;
  idp: number | null;
  four_ps: number | null;
  elcac_brgy: boolean | null;
  imr: number | null;
  ufmr: number | null;
  fic: number | null;
  abr: number | null;
  pre_natal: number | null;
  sba: number | null;
  water: number | null;
  imr_prov_ref: number | null;
  ufmr_prov_ref: number | null;
  fic_prov_ref: number | null;
  abr_prov_ref: number | null;
  pre_natal_prov_ref: number | null;
  sba_prov_ref: number | null;
  water_prov_ref: number | null;
  capped_indicators: string[];
};

const SELECT_COLS =
  "geo_code, physical_factor, ip_pop, armed_conf, idp, four_ps, elcac_brgy, imr, ufmr, fic, abr, pre_natal, sba, water, imr_prov_ref, ufmr_prov_ref, fic_prov_ref, abr_prov_ref, pre_natal_prov_ref, sba_prov_ref, water_prov_ref, capped_indicators" as const;

/**
 * Criterion (d)'s comparison: is this barangay worse than its province?
 *
 * The direction depends on what the indicator measures — a *higher* infant mortality is worse, a
 * *higher* immunisation coverage is better — which is why this cannot be one comparison applied to
 * all seven. Returns null when either side is missing: with no benchmark the test is not
 * evaluable, and saying "not worse" would be a claim the data does not make.
 */
export function comparesWorse(
  value: number | null,
  ref: number | null,
  higherIsWorse: boolean,
  max: number,
): boolean | null {
  if (value === null || ref === null) return null;
  // A benchmark the indicator cannot reach is not a comparison. FIC's provincial reference was
  // left uncapped in two provinces (102.15 and 101.00) while every barangay FIC was capped at
  // 100, so every barangay there would read as worse than its province on FIC — an artefact of
  // the cleaning, not a finding about those barangays.
  if (ref > max) return null;
  return higherIsWorse ? value > ref : value < ref;
}

/** Pure row → readings mapping. Exported for unit tests. */
export function toBarangayDetail(row: Row, geoName: string): UucPhcBarangayDetail {
  const capped = new Set(row.capped_indicators ?? []);

  const health: IndicatorReading[] = HEALTH_INDICATORS.map((meta) => {
    const value = row[meta.key];
    const provincialRef = row[`${meta.key}_prov_ref` as keyof Row] as number | null;
    return {
      key: meta.key,
      label: meta.label,
      unit: meta.unit,
      value,
      provincialRef,
      worseThanProvince: comparesWorse(value, provincialRef, meta.higherIsWorse, meta.max),
      benchmarkUnusable: provincialRef !== null && provincialRef > meta.max,
      capped: capped.has(meta.key),
    };
  });

  // Criterion (b) is summed, not either/or: the source marks it met when armed conflict + IDP
  // together reach 10%, which reproduces its own Pass/Fail on all 5,991 rows. Reading the order's
  // "or" as either-alone disagrees on 15 barangays. Following the file, with the note recorded —
  // see docs/UUC_PHC_2025_PLAN.md §1a.
  const conflict =
    row.armed_conf === null && row.idp === null ? null : (row.armed_conf ?? 0) + (row.idp ?? 0);

  const factors: QualifyingFactor[] = [
    { key: "ip_pop", label: "Indigenous Peoples", value: row.ip_pop, threshold: 10 },
    { key: "conflict", label: "Conflict-affected or displaced", value: conflict, threshold: 10 },
    { key: "four_ps", label: "4Ps / CCT enrolled", value: row.four_ps, threshold: 50 },
  ].map((f) => ({ ...f, met: f.value === null ? null : f.value >= f.threshold }));

  return {
    geoCode: row.geo_code,
    geoName,
    physicalFactor: row.physical_factor,
    factors,
    elcac: row.elcac_brgy,
    health,
    cappedCount: capped.size,
  };
}

/**
 * Indicator detail for every listed barangay of a city/municipality, in name order.
 *
 * Scoped to one city/municipality because that is the only level these render at — see the module
 * note on why there are no aggregates. Returns [] on any read failure or when none of the town's
 * barangays are listed.
 */
export const getUucPhcBarangayDetails = cache(
  async (citymunCode: string): Promise<UucPhcBarangayDetail[]> => {
    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
    if (datasetId === null) return [];

    const barangays = await getChildGeos(citymunCode, "citymun");
    if (barangays.length === 0) return [];

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("fact_uuc_phc_indicators")
      .select(SELECT_COLS)
      .eq("dataset_id", datasetId)
      .in(
        "geo_code",
        barangays.map((b) => b.geoCode),
      );

    if (error || !data) return [];

    const nameByCode = new Map(barangays.map((b) => [b.geoCode, b.geoName]));
    const orderByCode = new Map(barangays.map((b, i) => [b.geoCode, i]));
    return data
      .map((row) => toBarangayDetail(row, nameByCode.get(row.geo_code) ?? row.geo_code))
      .sort((a, b) => (orderByCode.get(a.geoCode) ?? 0) - (orderByCode.get(b.geoCode) ?? 0));
  },
);
