/**
 * Spearman rank correlation, translated to plain words for the Explore
 * relationships view (E1.4 / review S7). Client-safe (no `server-only`): the
 * relationship figure computes this from the plotted points in the browser
 * (n ≤ ~120 at worst — trivial). Thresholds are documented in `/methodology`.
 */

/** |ρ| cut-offs for the plain-language strength buckets (documented in /methodology). */
export const CORRELATION_THRESHOLDS = { weak: 0.2, moderate: 0.4, strong: 0.7 } as const;

/** Fewer than this many places → refuse to characterize a pattern at all. */
export const MIN_CORRELATION_N = 10;

/** Average ranks (1-based), assigning tied values the mean of their positions. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k].i] = avgRank;
    i = j + 1;
  }
  return out;
}

function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 2) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return null; // one variable is constant — undefined
  return num / Math.sqrt(da * db);
}

/**
 * Spearman's ρ for the (x, y) pairs, or null when it's undefined (fewer than 2
 * pairs, or either variable constant).
 */
export function spearmanRho(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 2) return null;
  return pearson(
    ranks(pairs.map((p) => p[0])),
    ranks(pairs.map((p) => p[1])),
  );
}

export type CorrelationStrength = "none" | "weak" | "moderate" | "strong";

export function correlationStrength(absRho: number): CorrelationStrength {
  if (absRho < CORRELATION_THRESHOLDS.weak) return "none";
  if (absRho < CORRELATION_THRESHOLDS.moderate) return "weak";
  if (absRho < CORRELATION_THRESHOLDS.strong) return "moderate";
  return "strong";
}

export type CorrelationDescription =
  | { kind: "insufficient"; n: number }
  | { kind: "described"; n: number; rho: number; strength: CorrelationStrength; direction: "positive" | "negative" };

/**
 * Characterize the correlation for display. Returns `insufficient` below
 * `MIN_CORRELATION_N` places (or when ρ is undefined) — the figure then says
 * "too few places to assess a pattern" rather than a coefficient.
 */
export function describeCorrelation(pairs: Array<[number, number]>): CorrelationDescription {
  const n = pairs.length;
  if (n < MIN_CORRELATION_N) return { kind: "insufficient", n };
  const rho = spearmanRho(pairs);
  if (rho === null) return { kind: "insufficient", n };
  return {
    kind: "described",
    n,
    rho,
    strength: correlationStrength(Math.abs(rho)),
    direction: rho >= 0 ? "positive" : "negative",
  };
}
