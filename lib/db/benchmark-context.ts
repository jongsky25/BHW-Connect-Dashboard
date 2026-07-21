import "server-only";
import { cache } from "react";
import { getGeoAncestors, type GeoAncestors } from "./geo";
import { getBhwOverview, type BhwOverview } from "./stepzero";
import { getBhwCounts, type BhwCounts } from "./indicators";
import { MIN_LEADER_N } from "@/lib/analysis/thresholds";
import { NATIONAL_GEO_CODE, type GeoLevel } from "@/lib/filters/schema";
import type { BenchmarkRow } from "@/components/place/benchmark";

/** The two figures every `benchmarkRowsFor` pick function reads from. */
type BenchmarkSource = { overview: BhwOverview; counts: BhwCounts | null };

/**
 * Everything the `FigureCard.benchmark` slot needs for one geo, in one call —
 * consolidates the hand-rolled ancestor/region/national fetches that used to
 * be duplicated on the place and explore pages (E1.2). `region` is null at and
 * above the region level (a region page never benchmarks against itself);
 * `national` is null only at the national level, where vertical benchmarks are
 * hidden entirely (`showBenchmarks`) in favor of adequacy + regional spread
 * (Risk R2).
 */
export type BenchmarkContext = {
  geo: { geoCode: string; geoLevel: GeoLevel; geoName: string };
  ancestors: GeoAncestors;
  self: BenchmarkSource;
  region: { geoName: string; overview: BhwOverview; counts: BhwCounts | null } | null;
  national: { overview: BhwOverview; counts: BhwCounts | null } | null;
  /** `geoLevel !== "national"` — whether vertical benchmark bars should render at all. */
  showBenchmarks: boolean;
  /** The adequacy signal (the n behind this geo's own figures): `n` is the
   * validated-profile count, `smallSample` flags n below `MIN_LEADER_N`. */
  adequacy: { n: number | null; smallSample: boolean };
};

/**
 * This geo vs. its region vs. the nation, ready for every figure on the page —
 * so no figure ever shows a number without answering "versus what?". Reuses
 * `getGeoAncestors`/`getBhwOverview`/`getBhwCounts`, each already `cache()`d at
 * their own definitions, so calling this alongside a page's other fetches for
 * the same geo costs nothing extra per request; it also gives the export path
 * (Increment 5) the identical numbers shown on screen.
 *
 * Wrapped in React's per-request `cache()` (string args are safe keys;
 * precedent: `getActiveDataset`, `lib/db/dataset.ts:35`).
 */
export const getBenchmarkContext = cache(
  async (geoCode: string, geoLevel: GeoLevel, geoName: string): Promise<BenchmarkContext> => {
    const showBenchmarks = geoLevel !== "national";
    const ancestors = await getGeoAncestors(geoCode, geoLevel);
    // Region row only below region level — the same rule the place/explore
    // pages already applied by hand: a region page never compares against itself.
    const regionAncestor =
      geoLevel !== "national" && geoLevel !== "region" ? ancestors.region : null;

    const [selfOverview, selfCounts, nationalPair, regionPair] = await Promise.all([
      getBhwOverview(geoCode, geoLevel),
      getBhwCounts(geoCode, geoLevel),
      showBenchmarks
        ? Promise.all([
            getBhwOverview(NATIONAL_GEO_CODE, "national"),
            getBhwCounts(NATIONAL_GEO_CODE, "national"),
          ])
        : Promise.resolve(null),
      regionAncestor
        ? Promise.all([
            getBhwOverview(regionAncestor.geoCode, "region"),
            getBhwCounts(regionAncestor.geoCode, "region"),
          ])
        : Promise.resolve(null),
    ]);

    const n = selfOverview.validatedProfiles;

    return {
      geo: { geoCode, geoLevel, geoName },
      ancestors,
      self: { overview: selfOverview, counts: selfCounts },
      region:
        regionAncestor && regionPair
          ? { geoName: regionAncestor.geoName, overview: regionPair[0], counts: regionPair[1] }
          : null,
      national: nationalPair ? { overview: nationalPair[0], counts: nationalPair[1] } : null,
      showBenchmarks,
      adequacy: { n, smallSample: n !== null && n < MIN_LEADER_N },
    };
  },
);

/**
 * Builds a `BenchmarkRow[]` (This place / region / Philippines) from a
 * `BenchmarkContext` for one indicator, via a `pick` function that reads the
 * indicator's value off a `BenchmarkSource` — e.g.
 * `benchmarkRowsFor(ctx, (s) => s.counts?.pctAccredited ?? null)`. Mirrors the
 * `benchmarkRows` closures the place/explore pages used to hand-roll, now
 * shared by both (and the export path). The region row is simply omitted when
 * `ctx.region` is null (region level and above); a `pick` returning null for
 * any source passes straight through as a null-valued row — `BenchmarkBars`
 * itself decides whether there's enough to render.
 */
export function benchmarkRowsFor(
  ctx: BenchmarkContext,
  pick: (source: BenchmarkSource) => number | null,
  selfLabel = "This place",
): BenchmarkRow[] {
  return [
    { label: selfLabel, value: pick(ctx.self), isPrimary: true },
    ...(ctx.region ? [{ label: ctx.region.geoName, value: pick(ctx.region) }] : []),
    ...(ctx.national ? [{ label: "Philippines", value: pick(ctx.national) }] : []),
  ];
}
