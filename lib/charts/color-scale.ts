import { sequentialRamp } from "./palette";

/** Colorblind-safe-safe sequential fill for a value, bucketed across the 7-step ramp. */
export function colorForValue(value: number, min: number, max: number): string {
  if (max === min) return sequentialRamp[Math.floor(sequentialRamp.length / 2)];
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const index = Math.min(sequentialRamp.length - 1, Math.floor(t * sequentialRamp.length));
  return sequentialRamp[index];
}

/** Fill for a geo with no data at all — distinct from every ramp step. */
export const NO_DATA_COLOR = "#e5e7eb";
