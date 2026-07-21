/**
 * Shared analysis thresholds — kept in a client-safe module (no `server-only`
 * import) so both server aggregation code (`lib/db/insights.ts`) and client
 * figures (the choropleth map's small-N signaling) read the same constant.
 */

/**
 * Minimum profiled BHWs before a place's rate is treated as stable enough to
 * rank/lead on. Below this, a single BHW moves the percentage by several
 * points, so the map desaturates the polygon and the ranked list flags it
 * (Explore enhancement E0.5). Insight generation uses the same floor.
 */
export const MIN_LEADER_N = 30;
