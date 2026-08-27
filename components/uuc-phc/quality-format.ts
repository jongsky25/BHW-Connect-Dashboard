import type { UucPhcBenchmarkGap } from "@/lib/db/uuc-phc-quality";

/**
 * The display rules of `/uuc-phc/data-quality` (plan U10), kept out of the JSX so they can be
 * tested — on `components/present/deck-logic.ts`'s precedent.
 *
 * Each of the three exists because rounding or omitting the wrong thing on a data-quality page
 * makes the page say the opposite of what the data says. They are small, and they are the parts
 * that would fail silently.
 */

/**
 * Two decimals, for a benchmark whose whole significance is how far past a ceiling it sits.
 *
 * One decimal rounds City of Butuan's FIC reference of 100.96 to 101 — a figure the plan and the
 * cleaning report both carried in error until U9 corrected them, and the last number this page
 * should reintroduce. The distance above 100 is the finding; round it away and a reader is left
 * wondering what the fuss is.
 */
export function benchmark(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * A share to one decimal, floored at "<0.1%" rather than rounded down to zero.
 *
 * Two bounded ABR values out of 5,991 is 0.03%. Printing that as "0%" says none were bounded,
 * which is the opposite of what the row exists to report — and it is the one indicator whose
 * bounding is rare enough for a reader to conclude the cap never binds.
 */
export function share(part: number, whole: number): string {
  if (whole <= 0) return "—";
  if (part <= 0) return "0%";
  const pct = (100 * part) / whole;
  if (pct < 0.05) return "<0.1%";
  return `${(Math.round(pct * 10) / 10).toLocaleString()}%`;
}

/**
 * Whether to print the benchmark value beside the description of what is wrong with it.
 *
 * "Every value exactly 1 (1)" and "every value zero (0)" say the same thing twice. The value earns
 * its place only where the words cannot carry it: an FIC benchmark, where *how far* above 100 it
 * sits is the finding, and a fraction, where a reader wants to see what one looked like.
 */
export function showsWitness(gap: UucPhcBenchmarkGap): boolean {
  if (gap.witnessValue === null) return false;
  if (gap.finding === "fic_only") return true;
  return gap.witnessValue > 0 && gap.witnessValue < 1;
}
