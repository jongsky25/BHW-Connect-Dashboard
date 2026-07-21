/**
 * Min/max spread of a numeric indicator across a set of rows — e.g. every
 * region's accreditation rate — for a "ranges X–Y%" comparator on the national
 * page, which has no single ancestor to benchmark against (Risk R2: `/bhw` uses
 * regional spread + adequacy instead of vertical bars). Client-safe (no
 * `server-only` import): a plain closed-form summary over rows the page already
 * fetched, same pattern as `lib/analysis/data-quality-grade.ts`.
 */
export type RegionalSpread = { min: number; max: number };

/** Null `pick` values are ignored; returns null when nothing is usable. */
export function regionalSpread<T>(
  rows: T[],
  pick: (row: T) => number | null,
): RegionalSpread | null {
  const values = rows.map(pick).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}
