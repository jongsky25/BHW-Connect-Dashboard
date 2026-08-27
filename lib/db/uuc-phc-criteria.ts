import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase";
import { DATASET_SLUGS, getDatasetIdBySlug } from "./dataset";
import { getChildGeos } from "./geo";
import type { GeoLevel } from "@/lib/filters/schema";

/**
 * UUC for PHC 2025 — which socio-economic route carried each listed barangay onto the list
 * (plan U7).
 *
 * DOH AO No. 2020-0023 §VI.A lists a barangay only when a physical factor **and** a socio-economic
 * factor are both present. The physical factor is not a figure worth counting: it holds in all
 * 5,991 rows by construction, because a barangay below the 25% floor never entered the list. What
 * varies is the socio-economic route, and until this module that was legible only one barangay at
 * a time, inside a `<details>` on a city page.
 *
 * **The four routes overlap.** A barangay can qualify on three at once, and the counts therefore do
 * not sum to the area's listed count — nationally they come to about 147% of it. Everything here is
 * shaped to make that impossible to render wrongly: each route carries **its own denominator** and
 * its own share, and `shareSumPct` is exposed precisely so a page can state the overshoot in words
 * rather than let a reader infer a partition that does not exist. There is no "other" or
 * "remainder" figure, because there is no remainder to have.
 *
 * **Route (d) has a different denominator from the other three.** For 226 barangays in 5 provinces
 * the provincial benchmark is a placeholder, a zero-fill, missing, or recorded as a fraction, so
 * the comparison criterion (d) is built on cannot be evaluated at all. Those barangays are excluded
 * from the health route's denominator — `healthEvaluable`, not `nListed` — and `healthExcluded`
 * carries the count so the page can say so. Their listing is not in doubt; the socio-economic test
 * passes on any one of four routes. See `docs/UUC_PHC_2025_CLEANING_REPORT.md` §6.
 *
 * **This aggregate is safe where U3's per-indicator ones were not.** U3 published no indicator
 * aggregates because a mean absorbs the capped ceilings and reports coverage the source does not
 * support — a † marker travels with one rendered value and cannot survive an average. A route count
 * counts *classifications*, never measurements, so it does not average a bounded value at all.
 */

/** The four socio-economic routes of AO §VI.A, in the order the order itself lists them. */
export const QUALIFYING_ROUTES = [
  {
    key: "ip",
    criterion: "a",
    label: "Indigenous Peoples",
    test: "At least 10% of the population are Indigenous Peoples",
  },
  {
    key: "conflict",
    criterion: "b",
    label: "Conflict-affected or displaced",
    // The two components are summed rather than read as the order's "or": that is what reproduces
    // the source's own Pass/Fail on all 5,991 rows (docs/UUC_PHC_2025_PLAN.md §1a). The ELCAC
    // designation is a genuine "or" — a separate way in, not part of the sum.
    test: "Armed conflict and displacement together reach 10%, or the barangay is ELCAC-designated",
  },
  {
    key: "fourPs",
    criterion: "c",
    label: "4Ps / CCT enrolled",
    test: "At least 50% of the population enrolled in 4Ps/CCT",
  },
  {
    key: "health",
    criterion: "d",
    label: "Worse than province on health",
    test: "Worse than the province on at least 4 of the 7 health indicators",
  },
] as const;

export type UucPhcRouteKey = (typeof QUALIFYING_ROUTES)[number]["key"];

/** One route's count against the denominator that route is a share of. */
export type UucPhcRoute = {
  key: UucPhcRouteKey;
  /** The AO's own letter for this criterion — 'a' … 'd'. */
  criterion: string;
  label: string;
  test: string;
  count: number;
  /** `nListed` for routes (a)–(c); `healthEvaluable` for route (d). Never assume they are equal. */
  denominator: number;
  /** `count` as a rounded % of `denominator`, or null when the denominator is 0. */
  sharePct: number | null;
  /** `count` as a share of a 0–100% track (0..1). 0 when the denominator is 0. */
  fraction: number;
};

export type UucPhcCriteria = {
  geoCode: string;
  geoLevel: GeoLevel;
  /** Barangays in this area on the 2025 list — the denominator for routes (a), (b) and (c). */
  nListed: number;
  routes: UucPhcRoute[];
  /** Listed barangays here whose provincial reference can support criterion (d). */
  healthEvaluable: number;
  /** Listed barangays here where criterion (d) cannot be evaluated: `nListed - healthEvaluable`. */
  healthExcluded: number;
  /**
   * The four shares added together. Above 100 wherever barangays qualify on more than one route,
   * which is almost everywhere — the number a page prints to say plainly that these are four
   * overlapping shares and not four slices of one whole. Null when nothing is listed.
   */
  shareSumPct: number | null;
};

/** One child unit with its route counts, for the breakdown table. */
export type UucPhcCriteriaChild = UucPhcCriteria & { geoName: string };

export type Row = {
  geo_code: string;
  geo_level: GeoLevel;
  n_listed: number;
  n_route_ip: number;
  n_route_conflict: number;
  n_route_four_ps: number;
  n_route_health: number;
  n_health_evaluable: number;
};

const SELECT_COLS =
  "geo_code, geo_level, n_listed, n_route_ip, n_route_conflict, n_route_four_ps, n_route_health, n_health_evaluable" as const;

const COUNT_BY_KEY: Record<UucPhcRouteKey, keyof Row> = {
  ip: "n_route_ip",
  conflict: "n_route_conflict",
  fourPs: "n_route_four_ps",
  health: "n_route_health",
};

/** Pure row → routes-with-their-own-denominators mapping. Exported for unit tests. */
export function toUucPhcCriteria(row: Row): UucPhcCriteria {
  const listed = row.n_listed;
  const evaluable = row.n_health_evaluable;

  const routes: UucPhcRoute[] = QUALIFYING_ROUTES.map((meta) => {
    const count = row[COUNT_BY_KEY[meta.key]] as number;
    // Route (d) is a share of the barangays it could be evaluated for, never of the whole list.
    // Handing every route the same denominator would overstate exactly the route whose evidence is
    // weakest, which is the opposite of what the caveat is for.
    const denominator = meta.key === "health" ? evaluable : listed;
    return {
      key: meta.key,
      criterion: meta.criterion,
      label: meta.label,
      test: meta.test,
      count,
      denominator,
      sharePct: denominator <= 0 ? null : Math.round((100 * count) / denominator),
      // Clamped for the same reason ShareBar clamps: a share above 1 is impossible by
      // construction, and a bar that cannot overflow its track is worth making impossible.
      fraction: denominator <= 0 ? 0 : Math.min(1, count / denominator),
    };
  });

  // Summed from the rounded shares, so the figure a page prints is the sum of the figures beside
  // it. A reader who adds up the four percentages on screen must get this number back.
  const shareSumPct =
    listed <= 0 ? null : routes.reduce((total, route) => total + (route.sharePct ?? 0), 0);

  return {
    geoCode: row.geo_code,
    geoLevel: row.geo_level,
    nListed: listed,
    routes,
    healthEvaluable: evaluable,
    healthExcluded: Math.max(0, listed - evaluable),
    shareSumPct,
  };
}

/**
 * Route counts for one geo. Null when the dataset or the row is missing — a read failure, not an
 * area with none listed, which is a real row reading 0 (`agg_uuc_phc_criteria` carries a row for
 * every geo, on U2's reasoning). Per-request `cache()`d.
 */
export const getUucPhcCriteria = cache(
  async (geoCode: string, geoLevel: GeoLevel): Promise<UucPhcCriteria | null> => {
    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
    if (datasetId === null) return null;

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_uuc_phc_criteria")
      .select(SELECT_COLS)
      .eq("dataset_id", datasetId)
      .eq("geo_code", geoCode)
      .eq("geo_level", geoLevel)
      .maybeSingle();

    if (error || !data) return null;
    return toUucPhcCriteria(data);
  },
);

/**
 * The child units of `parentCode` one level down, each with its route counts — the same shape and
 * ordering as `getUucPhcChildren`, so the two breakdowns on the section read alike.
 *
 * Children with nothing listed are dropped here, unlike on the coverage breakdown. There a zero is
 * the finding ("no barangay in NCR is on the list"); here every route would read "— of 0", which is
 * four empty tracks restating that same zero once per row.
 */
export const getUucPhcCriteriaChildren = cache(
  async (parentCode: string, parentLevel: GeoLevel): Promise<UucPhcCriteriaChild[]> => {
    if (parentLevel === "citymun" || parentLevel === "barangay") return [];

    const datasetId = await getDatasetIdBySlug(DATASET_SLUGS.uucPhc);
    if (datasetId === null) return [];

    const children = await getChildGeos(parentCode, parentLevel);
    if (children.length === 0) return [];

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("agg_uuc_phc_criteria")
      .select(SELECT_COLS)
      .eq("dataset_id", datasetId)
      .in(
        "geo_code",
        children.map((c) => c.geoCode),
      );

    if (error || !data) return [];

    const nameByCode = new Map(children.map((c) => [c.geoCode, c.geoName]));
    const orderByCode = new Map(children.map((c, i) => [c.geoCode, i]));
    return data
      .map((row) => ({
        ...toUucPhcCriteria(row),
        geoName: nameByCode.get(row.geo_code) ?? row.geo_code,
      }))
      .filter((child) => child.nListed > 0)
      .sort((a, b) => (orderByCode.get(a.geoCode) ?? 0) - (orderByCode.get(b.geoCode) ?? 0));
  },
);
