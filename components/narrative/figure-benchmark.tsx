import { BenchmarkBars, type BenchmarkRow } from "@/components/place/benchmark";
import { peerRankSentence } from "@/components/explore/peer-rank-chip";
import { MIN_LEADER_N } from "@/lib/analysis/thresholds";
import type { ValueFormatKind } from "@/lib/format";

/** The subset of `PeerRank` a `FigureBenchmark` needs to render a peer-standing
 * sentence — deliberately flat (not a nested `PeerRank`) so this stays plain,
 * fully serializable data across the client-component boundary (Risk R8). */
export type FigureBenchmarkPeer = {
  rankPosition: number | null;
  nSiblings: number | null;
  percentile: number | null;
  parentName: string | null;
  siblingPlural: string;
  indicatorLabel: string;
  nTotal: number | null;
};

export type FigureBenchmarkProps = {
  /** Vertical benchmark rows (This place / region / Philippines). Omitted or
   * fewer than 2 usable values → `BenchmarkBars` renders nothing. */
  rows?: BenchmarkRow[];
  format?: ValueFormatKind;
  /** Suffix appended after each formatted value, e.g. "yrs" or "hh/BHW". */
  unitSuffix?: string;
  /** Horizontal (peer) standing among same-level siblings. Only present for
   * the 6 indicators covered by `agg_peer_ranks` — absent everywhere else,
   * never approximated (Risk R1). */
  peer?: FigureBenchmarkPeer | null;
  /** The n behind this figure — the adequacy signal. */
  n?: number | null;
  /** Noun for `n`, e.g. "validated profiles" or "BHWs reporting a household count". */
  nLabel?: string;
  /** True when the underlying value itself is withheld (n < 5). */
  suppressed?: boolean;
  /** Optional muted footnote line, e.g. the DOH indicative-ratio caveat or a
   * barangay-fallback explanation. */
  note?: string;
};

const DEFAULT_N_LABEL = "validated profiles";

/**
 * The adequacy signal: how much weight the number above can bear. Three
 * states — normal, small-sample (n < `MIN_LEADER_N`, wording matches
 * `compare-summary.tsx`'s small-sample banner), and suppressed (n < 5, the
 * individual-level privacy floor used throughout `lib/db`). Renders nothing
 * when there's no n to report and nothing is suppressed.
 */
function AdequacyNote({
  n,
  nLabel = DEFAULT_N_LABEL,
  suppressed,
}: {
  n?: number | null;
  nLabel?: string;
  suppressed?: boolean;
}) {
  if (suppressed) {
    return (
      <p className="mt-2 text-xs text-muted">
        Withheld — fewer than 5 individuals; suppressed to protect privacy.
      </p>
    );
  }
  if (n === null || n === undefined) return null;
  if (n < MIN_LEADER_N) {
    return (
      <p className="mt-2 text-xs text-muted">
        Small sample — n = {n.toLocaleString()} (fewer than {MIN_LEADER_N}); rates can swing widely.
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs text-muted">
      Based on n = {n.toLocaleString()} {nLabel}.
    </p>
  );
}

/**
 * Fills the existing `FigureCard.benchmark` slot with the full "no naked
 * numbers" stack (top to bottom): vertical benchmark bars (this place vs.
 * region vs. nation), a compact peer-standing sentence, the adequacy note, and
 * an optional muted footnote. So every headline figure answers "versus what?"
 * and "how much can I trust this?" without duplicating that logic per figure.
 *
 * Props are fully serializable (no `ReactNode`/function fields — Risk R8):
 * `CompareColumn` and other client components can receive a
 * `FigureBenchmarkProps` built entirely on the server and render this
 * directly, the same as any other plain-data prop.
 */
export function FigureBenchmark({ rows, format, unitSuffix, peer, n, nLabel, suppressed, note }: FigureBenchmarkProps) {
  const peerSentence = peer
    ? peerRankSentence({
        rank: { rankPosition: peer.rankPosition, nSiblings: peer.nSiblings, nTotal: peer.nTotal },
        parentName: peer.parentName,
        siblingPlural: peer.siblingPlural,
        indicatorLabel: peer.indicatorLabel,
      })
    : null;

  return (
    <div>
      <BenchmarkBars rows={rows ?? []} format={format} unitSuffix={unitSuffix} />
      {peerSentence && <p className="mt-2 text-xs text-muted">{peerSentence}</p>}
      <AdequacyNote n={n} nLabel={nLabel} suppressed={suppressed} />
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </div>
  );
}
