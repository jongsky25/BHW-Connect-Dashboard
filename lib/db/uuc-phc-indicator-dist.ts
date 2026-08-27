import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";
import { HEALTH_INDICATORS, type IndicatorKey } from "./uuc-phc-indicators";
import type { GeoLevel } from "@/lib/filters/schema";

/**
 * UUC for PHC 2025 — the 12 indicators above barangay grain, as distributions (plan U9).
 *
 * U3 set the rule this module lives under: **mark the value, never average it.** 1,584 values were
 * bounded during cleaning, and 886 Water and 456 FIC readings now sit at exactly 100 with only
 * `capped_indicators` to separate them from genuine full coverage. That marker travels with one
 * rendered value and cannot survive a mean, so U3 honoured the rule by publishing no aggregates at
 * all — which left the 12 indicators legible one barangay at a time, inside a `<details>` on a city
 * page.
 *
 * **A distribution is not a mean, and that is the whole increment.** Every value stays at its own
 * position; the bounded ones pile up in the top bin where `bin_capped` counts them and the page
 * labels them. What an average does to those 886 readings — dissolve them into a figure that
 * asserts near-universal water coverage — is exactly what a histogram refuses to do.
 *
 * So: no mean, no median, no bin-midpoint estimate, here or on any page reading this module. The
 * temptation is real and the page says so out loud rather than leaving the refusal implicit.
 */

/** Ten bins, fixed. The migration's `bin_counts` array is this long, and a check constraint on the
 * table keeps it so — a distribution whose bin count varied between areas would not be comparable
 * across the drill-down. */
export const BIN_COUNT = 10;

/** Which group of the AO's test an indicator belongs to — the page's three sections. */
export type UucPhcIndicatorGroup = "physical" | "socio" | "health";

export type UucPhcIndicatorMeta = {
  key: string;
  label: string;
  unit: string;
  /** Top of the indicator's domain, and the cap cleaning bounded it to. Bin width is `max / 10`. */
  max: number;
  group: UucPhcIndicatorGroup;
  /** Criterion (d)'s direction, or null for the five indicators criterion (d) does not test. */
  higherIsWorse: boolean | null;
  /** One line on what the value is and what the AO does with it, printed under the histogram. */
  note: string;
};

/**
 * The five indicators of the physical and socio-economic tests. Criterion (d) does not test them,
 * so they carry no provincial benchmark and no worse-than-province count — and none of them was
 * bounded during cleaning either (§4 of the cleaning report: all five were already inside 0–100).
 */
const QUALIFYING_META = [
  {
    key: "physical_factor",
    label: "Puroks over an hour from care",
    unit: "%",
    max: 100,
    group: "physical",
    higherIsWorse: null,
    note: "The physical factor of AO §VI.A. It never reads below 25 here, because a barangay under that floor never entered the list — this distribution has no low tail to find, by construction.",
  },
  {
    key: "ip_pop",
    label: "Indigenous Peoples",
    unit: "%",
    max: 100,
    group: "socio",
    higherIsWorse: null,
    note: "Criterion (a): a barangay qualifies on this route at 10% or more.",
  },
  {
    key: "armed_conf",
    label: "Affected by armed conflict",
    unit: "%",
    max: 100,
    group: "socio",
    higherIsWorse: null,
    note: "Half of criterion (b). Read alongside displacement: the route is met when the two together reach 10%, or the barangay is ELCAC-designated — neither of which this one distribution shows on its own.",
  },
  {
    key: "idp",
    label: "Internally displaced",
    unit: "%",
    max: 100,
    group: "socio",
    higherIsWorse: null,
    note: 'The other half of criterion (b), and summed with armed conflict rather than read as the order\'s "or" — see the methodology page.',
  },
  {
    key: "four_ps",
    label: "4Ps / CCT enrolled",
    unit: "%",
    max: 100,
    group: "socio",
    higherIsWorse: null,
    note: "Criterion (c): a barangay qualifies on this route at 50% or more.",
  },
] as const satisfies readonly UucPhcIndicatorMeta[];

/** What criterion (d) asks of each health indicator, in the direction it asks it. */
const HEALTH_NOTES: Record<IndicatorKey, string> = {
  imr: "Criterion (d) counts a barangay worse than its province when this reads higher.",
  ufmr: "Criterion (d) counts a barangay worse than its province when this reads higher.",
  abr: "Criterion (d) counts a barangay worse than its province when this reads higher.",
  fic: "A coverage figure: criterion (d) counts a barangay worse than its province when this reads lower.",
  pre_natal:
    "A coverage figure: criterion (d) counts a barangay worse than its province when this reads lower.",
  sba: "A coverage figure: criterion (d) counts a barangay worse than its province when this reads lower.",
  water:
    "A coverage figure: criterion (d) counts a barangay worse than its province when this reads lower.",
};

/**
 * All 12, in the order the AO's test runs: the physical factor, then the three socio-economic
 * routes, then the seven health indicators of criterion (d).
 *
 * The health half is **derived from `HEALTH_INDICATORS` rather than restated**, because `max` is
 * load-bearing twice over — it is the cap cleaning bounded the indicator to, the top of this
 * histogram's axis, *and* the threshold `comparesWorse` refuses a benchmark above. A second copy
 * that drifted would put the axis and the comparison on different scales without either looking
 * wrong on its own.
 */
export const UUC_PHC_INDICATORS: UucPhcIndicatorMeta[] = [
  ...QUALIFYING_META,
  ...HEALTH_INDICATORS.map((meta): UucPhcIndicatorMeta => ({
    key: meta.key,
    label: meta.label,
    unit: meta.unit,
    max: meta.max,
    group: "health",
    higherIsWorse: meta.higherIsWorse,
    note: HEALTH_NOTES[meta.key],
  })),
];

const META_BY_KEY = new Map(UUC_PHC_INDICATORS.map((meta) => [meta.key, meta]));

/** One bar. `lo`/`hi` are the bin's own edges, in the indicator's units. */
export type UucPhcBin = {
  index: number;
  lo: number;
  hi: number;
  /** The top bin closes inclusive, which is what puts an exactly-capped value inside it. */
  inclusive: boolean;
  count: number;
  /** Of `count`, how many are values bounded during cleaning. Non-zero only in the top bin. */
  capped: number;
  /** `count` against the tallest bin here (0..1) — the bar's height, not a share of anything. */
  fraction: number;
};

/**
 * Why a provincial benchmark is or is not drawn on this indicator's axis. Five reasons, and they
 * are genuinely different statements — collapsing them into "no line" would hide two data-quality
 * findings the section exists to surface.
 */
export type UucPhcBenchmarkState =
  /** Criterion (d) does not test this indicator; there is no benchmark to draw. */
  | "none"
  /** The area spans more than one province, so there is no single benchmark — not a gap. */
  | "aggregate"
  /** The province supplied no benchmark at all (57 barangays in 2 provinces). */
  | "missing"
  /** The benchmark exceeds what the indicator can take, so no barangay could reach it. FIC in
   * Ilocos Sur (102.15) and City of Butuan (100.96), against a barangay value capped at 100. */
  | "unreachable"
  /** A benchmark exists but is a placeholder — every value 1, or 0, or a fraction. */
  | "placeholder"
  /** Usable: the line is drawn. */
  | "drawn";

export type UucPhcIndicatorDist = {
  meta: UucPhcIndicatorMeta;
  geoCode: string;
  geoLevel: GeoLevel;
  /** Barangays in this area on the 2025 list — what the bars account for. */
  nListed: number;
  bins: UucPhcBin[];
  /** Listed barangays with no value recorded for this indicator. Bars + this = `nListed`. */
  nMissing: number;
  /** Values bounded during cleaning across the whole distribution — all of them in the top bin. */
  cappedTotal: number;
  /** The province's benchmark, where the area has exactly one. Null above province level. */
  provincialRef: number | null;
  benchmark: UucPhcBenchmarkState;
  /** Where the line is drawn, as a 0..1 position on the axis. Null unless `benchmark` is drawn. */
  refFraction: number | null;
  /** Listed barangays whose criterion (d) comparison can be made for this indicator. */
  nComparable: number;
  /** Of `nComparable`, how many are worse than their province. A count, never a share. */
  nWorse: number;
  /** `nListed - nComparable`: listed barangays the comparison could not be made for. */
  nNotComparable: number;
};

export type Row = {
  geo_code: string;
  geo_level: GeoLevel;
  indicator: string;
  value_max: number;
  n_listed: number;
  bin_counts: number[];
  bin_capped: number[];
  n_missing: number;
  provincial_ref: number | null;
  n_comparable: number;
  n_worse: number;
};

const SELECT_COLS =
  "geo_code, geo_level, indicator, value_max, n_listed, bin_counts, bin_capped, n_missing, provincial_ref, n_comparable, n_worse" as const;

/**
 * Which of the five reasons applies. Written as one function so a page cannot render a line by
 * checking only some of them — the `unreachable` and `placeholder` cases are precisely the ones a
 * naive `ref !== null` would get wrong, and both are real in this data.
 */
export function benchmarkStateOf(
  meta: UucPhcIndicatorMeta,
  geoLevel: GeoLevel,
  ref: number | null,
  nListed: number,
  nComparable: number,
): UucPhcBenchmarkState {
  if (meta.higherIsWorse === null) return "none";
  if (geoLevel !== "province" && geoLevel !== "citymun") return "aggregate";
  if (nListed === 0) return "none";
  if (ref === null) return "missing";
  // comparesWorse's rule, applied to the axis rather than to one barangay: a benchmark the
  // indicator cannot reach would put the line off the end of the chart and mark every barangay
  // here as worse than its province by construction.
  if (ref > meta.max) return "unreachable";
  // A benchmark that compares fine and means nothing. n_comparable is 0 for exactly these areas,
  // because the aggregate applies the same placeholder rule agg_uuc_phc_criteria does.
  if (nComparable === 0) return "placeholder";
  return "drawn";
}

/**
 * Pure row → renderable distribution. Exported for unit tests.
 *
 * Returns null for an indicator this build does not know, which is what a row written by a newer
 * migration than the deployed code would be. Dropping it is right: rendering a histogram with no
 * label, no units and no idea whether criterion (d) tests it would be worse than omitting it.
 */
export function toIndicatorDist(row: Row): UucPhcIndicatorDist | null {
  const meta = META_BY_KEY.get(row.indicator);
  if (!meta) return null;

  const counts = row.bin_counts ?? [];
  const capped = row.bin_capped ?? [];
  // Against the tallest bar, not against nListed: a distribution's shape is the point, and scaling
  // ten bars to the area's total would flatten every one of them into invisibility wherever the
  // values are spread out — which is most of them.
  const tallest = counts.reduce((most, n) => Math.max(most, n), 0);
  const width = meta.max / BIN_COUNT;

  const bins: UucPhcBin[] = Array.from({ length: BIN_COUNT }, (_, i) => {
    const count = counts[i] ?? 0;
    return {
      index: i,
      lo: width * i,
      hi: width * (i + 1),
      inclusive: i === BIN_COUNT - 1,
      count,
      capped: capped[i] ?? 0,
      fraction: tallest <= 0 ? 0 : count / tallest,
    };
  });

  const benchmark = benchmarkStateOf(
    meta,
    row.geo_level,
    row.provincial_ref,
    row.n_listed,
    row.n_comparable,
  );

  return {
    meta,
    geoCode: row.geo_code,
    geoLevel: row.geo_level,
    nListed: row.n_listed,
    bins,
    nMissing: row.n_missing,
    cappedTotal: bins.reduce((total, bin) => total + bin.capped, 0),
    provincialRef: row.provincial_ref,
    benchmark,
    refFraction:
      benchmark === "drawn" && row.provincial_ref !== null
        ? Math.min(1, Math.max(0, row.provincial_ref / meta.max))
        : null,
    nComparable: row.n_comparable,
    nWorse: row.n_worse,
    nNotComparable: Math.max(0, row.n_listed - row.n_comparable),
  };
}

/**
 * Every indicator's distribution for one geo, in the AO's own order.
 *
 * Returns [] on a read failure. **An area with nothing listed is not that**: it has 12 real rows,
 * all reading zero, on the same reasoning `agg_uuc_phc_counts` carries a zero row for NCR. The
 * page tells the two apart by reading `getUucPhcCounts` alongside this, so a transient failure
 * renders as unavailable rather than as an area with no unserved barangays.
 */
export const getUucPhcIndicatorDist = cache(
  async (geoCode: string, geoLevel: GeoLevel): Promise<UucPhcIndicatorDist[]> => {
    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
    if (datasetId === null) return [];

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_uuc_phc_indicator_dist")
      .select(SELECT_COLS)
      .eq("dataset_id", datasetId)
      .eq("geo_code", geoCode)
      .eq("geo_level", geoLevel);

    if (error || !data) return [];

    const byKey = new Map(data.map((row) => [row.indicator, row]));
    return UUC_PHC_INDICATORS.map((meta) => {
      const row = byKey.get(meta.key);
      return row ? toIndicatorDist(row) : null;
    }).filter((dist): dist is UucPhcIndicatorDist => dist !== null);
  },
);
