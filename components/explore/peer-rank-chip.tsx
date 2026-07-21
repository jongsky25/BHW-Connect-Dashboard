import { MIN_LEADER_N } from "@/lib/analysis/thresholds";
import type { PeerRank } from "@/lib/db/peer-ranks";

/** English ordinal: 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Plain-text peer-rank sentence, e.g. "On % accredited, Manila ranks 3rd of 17
 * cities/municipalities in Metro Manila." — extracted from `PeerRankChip` so
 * both the boxed chip and the compact `FigureBenchmark` slot (E1.5) render
 * identical wording from one place. Returns null under the same suppression
 * gate as the chip: no row (national/barangay/unranked indicator), or too few
 * profiled BHWs at this geo for the rank to be reliable (E0.5 `MIN_LEADER_N`).
 *
 * `geoName` is optional: the chip (which stands alone on the page) names the
 * geo explicitly; `FigureBenchmark` (which already sits directly under that
 * geo's own figure) omits it for a shorter, still-unambiguous sentence.
 */
export function peerRankSentence({
  rank,
  geoName,
  parentName,
  siblingPlural,
  indicatorLabel,
}: {
  rank: Pick<PeerRank, "rankPosition" | "nSiblings" | "nTotal"> | null;
  geoName?: string;
  parentName: string | null;
  siblingPlural: string;
  indicatorLabel: string;
}): string | null {
  if (
    !rank ||
    rank.rankPosition === null ||
    rank.nSiblings === null ||
    (rank.nTotal !== null && rank.nTotal < MIN_LEADER_N)
  ) {
    return null;
  }

  const place = parentName ? ` in ${parentName}` : "";
  if (!geoName) {
    return `Ranks ${ordinal(rank.rankPosition)} of ${rank.nSiblings} ${siblingPlural}${place} on ${indicatorLabel.toLowerCase()}.`;
  }
  return `On ${indicatorLabel.toLowerCase()}, ${geoName} ranks ${ordinal(rank.rankPosition)} of ${rank.nSiblings} ${siblingPlural}${place}.`;
}

/**
 * Peer-standing chip (E2.3): where this geo ranks among its same-level siblings
 * for the active indicator. Suppressed when the geo has too few profiled BHWs
 * for the value to be reliable (the E0.5 MIN_LEADER_N rule), or when it isn't
 * ranked (no row — national/barangay). E2.4 adds the outlier flourish.
 */
export function PeerRankChip({
  rank,
  geoName,
  parentName,
  siblingPlural,
  indicatorLabel,
}: {
  rank: PeerRank | null;
  geoName: string;
  parentName: string | null;
  siblingPlural: string;
  indicatorLabel: string;
}) {
  const sentence = peerRankSentence({ rank, geoName, parentName, siblingPlural, indicatorLabel });
  if (!sentence) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm">
      {rank?.isOutlier && (
        <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
          Stands out
        </span>
      )}
      <span>{sentence}</span>
    </div>
  );
}
