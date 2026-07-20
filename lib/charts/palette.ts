/**
 * Mirrors the CSS custom properties in app/globals.css. Chart libraries need
 * real color values (not CSS var() refs), so this is the one place both
 * stay in sync — update together.
 */
export const accent = "#0a6e6e";
export const muted = "#57616a";
export const border = "#dde1e3";
export const danger = "#b3261e";
export const warning = "#8a5a00";

/** Colorblind-safe sequential ramp, light -> dark, for ordered/quantitative encodings. */
export const sequentialRamp = [
  "#e3f1f1",
  "#b3d9d8",
  "#7fc0be",
  "#4aa39f",
  "#237f7c",
  "#0a6e6e",
  "#054a49",
];

/** Curated bar-color choices for the chart recolor control — a spread across
 * the sequential ramp plus the two semantic hues, all already used elsewhere
 * in the app so a recolored chart never introduces an off-brand color. */
export const chartColorSwatches: { label: string; value: string }[] = [
  { label: "Teal (default)", value: accent },
  { label: "Light teal", value: sequentialRamp[2] },
  { label: "Dark teal", value: sequentialRamp[6] },
  { label: "Amber", value: warning },
  { label: "Red", value: danger },
];
