import { sequentialRamp } from "./palette";

/** Fill for a geo with no data at all — distinct from every ramp step. */
export const NO_DATA_COLOR = "#e5e7eb";

/** One choropleth color bin: values in `[min, max]` render as `color`. */
export type ColorBin = { min: number; max: number; color: string };

/** Pick a ramp color by fraction 0..1 (light -> dark). */
function rampColor(fraction: number): string {
  const i = Math.round(fraction * (sequentialRamp.length - 1));
  return sequentialRamp[Math.min(sequentialRamp.length - 1, Math.max(0, i))];
}

/**
 * Quantile ("quintile" by default) color bins computed from the values actually
 * shown, each carrying a light->dark ramp color. This is the honest replacement
 * for continuous min-max normalization: bins reflect where the data sits, and
 * the legend renders the exact same ranges the map paints.
 *
 * - No values -> `[]` (everything renders as no-data).
 * - One distinct value -> a single mid-ramp bin (keeps the old single-value
 *   behavior — a lone polygon shouldn't be painted "lowest").
 * - Fewer than `count` distinct values -> fewer bins, so ties never produce
 *   zero-width or duplicate ranges.
 */
export function computeQuantileBins(
  values: Array<number | null | undefined>,
  count = 5,
): ColorBin[] {
  const nums = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (nums.length === 0) return [];

  const distinct = Array.from(new Set(nums));
  if (distinct.length === 1) {
    const mid = sequentialRamp[Math.floor(sequentialRamp.length / 2)];
    return [{ min: distinct[0], max: distinct[0], color: mid }];
  }

  const nBins = Math.min(count, distinct.length);

  // Quantile with linear interpolation over the sorted values.
  const quantile = (p: number): number => {
    const idx = p * (nums.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? nums[lo] : nums[lo] + (nums[hi] - nums[lo]) * (idx - lo);
  };

  // Edges: min, interior quantile breaks, max — deduped (ascending-strict) so a
  // clustered distribution collapses to fewer, real bins instead of degenerate
  // zero-width ones.
  const rawEdges = [nums[0]];
  for (let k = 1; k < nBins; k++) rawEdges.push(quantile(k / nBins));
  rawEdges.push(nums[nums.length - 1]);

  const edges: number[] = [];
  for (const e of rawEdges) {
    if (edges.length === 0 || e > edges[edges.length - 1]) edges.push(e);
  }

  const finalBins = edges.length - 1;
  const bins: ColorBin[] = [];
  for (let i = 0; i < finalBins; i++) {
    bins.push({
      min: edges[i],
      max: edges[i + 1],
      color: rampColor(finalBins === 1 ? 0.5 : i / (finalBins - 1)),
    });
  }
  return bins;
}

/**
 * Index of the bin a value falls in, or -1 when there are no bins. Assigns each
 * value to the highest bin whose lower edge it clears, so the maximum value
 * lands in the top bin — fixing the old `floor(t * ramp.length)` overflow that
 * pushed `t = 1` out of range (it was silently clamped).
 */
export function binIndexForValue(value: number, bins: ColorBin[]): number {
  if (bins.length === 0) return -1;
  for (let i = bins.length - 1; i >= 0; i--) {
    if (value >= bins[i].min) return i;
  }
  return 0;
}

/** Bin color for a value, or `NO_DATA_COLOR` when unbinnable. */
export function colorForValue(value: number, bins: ColorBin[]): string {
  const i = binIndexForValue(value, bins);
  return i < 0 ? NO_DATA_COLOR : bins[i].color;
}
