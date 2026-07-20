/**
 * Shared number formatters for display. Centralizes the inline helpers that
 * used to be duplicated across app/page.tsx and the explore figures, so every
 * count/percent/peso figure formats the same way everywhere.
 */
export const formatCount = (n: number | null): string => (n === null ? "—" : n.toLocaleString());

export const formatPct = (n: number | null): string => (n === null ? "—" : `${n}%`);

export const formatPeso = (n: number | null): string =>
  n === null ? "—" : `₱${Math.round(n).toLocaleString()}`;

/** Compact form for tight labels, e.g. 306,835 -> "306.8K". */
export const formatCompact = (n: number | null): string =>
  n === null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
