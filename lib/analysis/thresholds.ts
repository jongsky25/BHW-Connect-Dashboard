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

/**
 * DOH's barangay health worker deployment planning guidance of roughly 1 BHW
 * per 20 households. Surfaced only as an **indicative reference caveat** —
 * a footnote alongside a place's own households-per-BHW figure — never as a
 * pass/fail gauge or target marker on any chart. Dataset-relative comparisons
 * (this place vs. its region vs. the nation) remain the primary status
 * signal; this ratio exists purely so a reader can sanity-check "is this
 * generally light or heavy?" against outside planning practice.
 *
 * This reverses the earlier stance recorded in docs/DECISIONS.md ("Deliberately
 * did not cite a specific DOH ideal ratio", per docs/HOME_SEARCH_REVIEW.md §6) —
 * see the dated DECISIONS.md entry accompanying this constant's introduction
 * for the sanctioned rationale.
 */
export const DOH_INDICATIVE_HOUSEHOLDS_PER_BHW = 20;

/**
 * The honorarium-sufficiency cut used by the "is it enough?" figure (deck
 * headline: "59% receive less than ₱68/day" in cumulative, per-BHW, all-levels
 * honorarium). `HONORARIUM_SUFFICIENCY_DAILY_PHP` is a derived convenience
 * (monthly ÷ 30) for the day-rate phrasing; both read from this single
 * constant so the threshold is never hard-coded a second time anywhere else.
 *
 * These are **provisional** values pending empirical resolution against the
 * live `agg_honorarium_cumulative` table built in the DB increment (Risk R5):
 * the scope doc's own arithmetic conflicts — "₱68/day" implies ≈₱2,040/month,
 * but its own parenthetical elsewhere reads "≈₱300/month" — and only running
 * the real cumulative-honorarium query against the dataset can say which cut
 * actually reproduces the deck's ≈59% nationally. Do not print a "≈59%"
 * headline anywhere until that increment confirms (or corrects) this value.
 */
export const HONORARIUM_SUFFICIENCY_MONTHLY_PHP = 2040;
export const HONORARIUM_SUFFICIENCY_DAILY_PHP = HONORARIUM_SUFFICIENCY_MONTHLY_PHP / 30;
