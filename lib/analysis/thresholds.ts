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
 * The DOH indicative-ratio caveat, verbatim, wherever a households-per-BHW
 * figure appears (Increment 4) — a footnote, never a chart marker/gauge. Kept
 * as one exported string so the wording can't drift between `/bhw`, `/explore`,
 * and `/place`, and the household count reads from the constant above rather
 * than being retyped.
 */
export const DOH_INDICATIVE_NOTE = `Indicative reference: DOH planning guidance suggests 1 BHW per ${DOH_INDICATIVE_HOUSEHOLDS_PER_BHW} households — a planning ratio, not a performance target.`;

/**
 * The honorarium-sufficiency cut used by the "is it enough?" figure (deck
 * headline: "59% receive less than ₱68/day" in cumulative, per-BHW, all-levels
 * honorarium). `HONORARIUM_SUFFICIENCY_DAILY_PHP` is a derived convenience
 * (monthly ÷ 30) for the day-rate phrasing; both read from this single
 * constant so the threshold is never hard-coded a second time anywhere else.
 *
 * **Resolved empirically (Risk R5)** against the live per-BHW cumulative
 * honorarium CTE (all 270,917 profiled BHWs, national scope): pct below
 * ₱300/month = 3.6%, pct below ₱2,040/month = 59.2%, national median =
 * ₱1,750/month. 59.2% matches the deck's "59%" almost exactly, while 3.6% is
 * nowhere close — so ₱2,040/month (₱68/day) is confirmed as the correct cut,
 * not merely provisional. Full resolution record lives in the header comment
 * of `supabase/migrations/20260721100000_honorarium_cumulative.sql`; a
 * DECISIONS.md entry documenting this follows in a later increment (docs pass).
 */
export const HONORARIUM_SUFFICIENCY_MONTHLY_PHP = 2040;
export const HONORARIUM_SUFFICIENCY_DAILY_PHP = HONORARIUM_SUFFICIENCY_MONTHLY_PHP / 30;
