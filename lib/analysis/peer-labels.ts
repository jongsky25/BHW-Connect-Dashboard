/**
 * Peer-standing labels shared by every page that shows a geo's rank among its
 * same-level siblings (E2.3/E1.5). Client-safe (no `server-only`): a plain
 * lookup + closed-form name pick over data the page already fetched, same
 * pattern as `lib/analysis/data-quality-grade.ts`. Lifted out of
 * `app/explore/page.tsx` so place/explore/compare share one definition instead
 * of drifting copies.
 */
import type { GeoAncestors } from "@/lib/db/geo";
import type { GeoLevel } from "@/lib/filters/schema";
// Type-only imports — erased at compile time, so this stays client-safe even
// though `peer-ranks.ts` is `server-only` and `figure-benchmark.tsx` is a
// component module.
import type { PeerRank } from "@/lib/db/peer-ranks";
import type { FigureBenchmarkPeer } from "@/components/narrative/figure-benchmark";

/**
 * Plural noun for a geo level's same-level siblings, for peer-rank sentences
 * ("ranks 3rd of 17 provinces"). Only region/province/citymun are ranked —
 * `agg_peer_ranks` has no national or barangay rows (Risk R1/R3) — so national
 * and barangay have no entry here.
 */
export const PEER_LEVEL_PLURAL: Partial<Record<GeoLevel, string>> = {
  region: "regions",
  province: "provinces",
  citymun: "cities/municipalities",
};

/**
 * The name of the parent geo a peer rank is computed within — e.g. "Region
 * VII" for a province, or "the Philippines" for a region — for the "... in
 * {parentName}" clause of a peer-rank sentence. Null when the geo level isn't
 * ranked or the relevant ancestor is unknown.
 */
export function peerParentName(geoLevel: GeoLevel, ancestors: GeoAncestors): string | null {
  switch (geoLevel) {
    case "region":
      return "the Philippines";
    case "province":
      return ancestors.region?.geoName ?? null;
    case "citymun":
      return ancestors.province?.geoName ?? null;
    default:
      return null;
  }
}

/**
 * Flattens a `PeerRank` (or its absence) into the plain `FigureBenchmarkPeer`
 * shape `FigureBenchmark` renders — one mapping shared by every page instead
 * of re-deriving it per figure. Returns null exactly when there's no rank to
 * show (indicator not covered by `agg_peer_ranks`, or this geo unranked) —
 * `FigureBenchmark` never fakes a rank (Risk R1).
 */
export function toFigurePeer(
  rank: PeerRank | null | undefined,
  parentName: string | null,
  siblingPlural: string,
  indicatorLabel: string,
): FigureBenchmarkPeer | null {
  if (!rank) return null;
  return {
    rankPosition: rank.rankPosition,
    nSiblings: rank.nSiblings,
    percentile: rank.percentile,
    parentName,
    siblingPlural,
    indicatorLabel,
    nTotal: rank.nTotal,
  };
}
