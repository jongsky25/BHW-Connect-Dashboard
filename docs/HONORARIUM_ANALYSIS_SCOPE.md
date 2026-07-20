# Honorarium analysis — scope & roadmap

Scoping note for how BHW honorarium data should be analyzed and surfaced on the
dashboard. Written alongside the home-dashboard replan (see the branch's home-page
changes). Reference points are the BHW Census 2025 deck slides 12–14, which show the
target analysis the owner wants to reach.

## What honorarium data exists today

- **`fact_honorarium`** (person level, service-role only): one row per BHW × paying
  level, with `receives`, `amount`, `frequency`, and `normalized_monthly_amount`.
  Paying level is one of region / province / citymun / barangay. A BHW can have rows
  at several levels — receipt is **not** mutually exclusive.
- **`agg_honorarium`** (public read): per geo × paying level, holds `n_receiving`,
  `pct_receiving`, `avg_monthly_amount`, `modal_frequency`.
- **`agg_bhw_counts.any_honorarium_pct`**: the rolled-up "receives from any level" %.

National values (2025) for reference:

| Paying level | % receiving | Avg ₱/month | Modal frequency |
|---|---|---|---|
| Barangay | 89.2% | 1,291 | monthly |
| City/Municipality | 69.2% | 1,159 | quarterly |
| Province | 52.7% | 572 | annual |
| Region | 1.9% | 3,698 | quarterly |

## Built this round (no schema change)

Both read from `getHonorarium()` (`lib/db/indicators.ts`), which already returned the
amount field though no figure charted it before:

1. **`HonorariumFigure`** — % of BHWs receiving honorarium by paying level. Mirrors
   deck slide 12. (Pre-existing; now also shown on the home page.)
2. **`HonorariumAmountFigure`** (new) — average monthly ₱ amount by paying level.
   Surfaces `avg_monthly_amount`, previously unused in any UI.

## Recommended follow-ups (need new aggregates / ingestion)

The deck goes well beyond what `agg_honorarium` can currently answer. Each item below
needs a migration and an ingestion re-run (`ingestion/build_aggregates.sql`), so they
are deliberately out of scope for the home-dashboard pass.

### A. Distribution, not just the mean (deck slide 13)

`avg_monthly_amount` alone hides a wide spread — the deck reports, per unit, the
**lowest, highest, median, and most-common** annual amount (e.g. barangay: ₱600 min,
₱240,000 max, ₱12,000 median, `<₱12,000` for 57%). A single average is easily skewed
by a few high payers.

- Add `min_amount`, `p25_amount`, `median_amount`, `p75_amount`, `max_amount`,
  `modal_amount_band` to `agg_honorarium` (annualized, per paying level).
- Surface as a box-plot or a min / median / max range per level.

### B. Cumulative honorarium per BHW (deck slide 14)

The most policy-relevant number: each BHW's **total** honorarium summed across every
level they receive from, then the distribution across BHWs. The deck bins this into
bands (None, 1–4,000, … , >24,000) and lands the headline **"59% receive less than
₱68 per day"** (≈ ₱300/month). This is **not computable from `agg_honorarium`**, which
is already grouped by paying level — it needs the per-`bhw_id` sum before aggregation.

- New table, e.g. `agg_honorarium_cumulative` (dataset × geo × amount-band → `n`, `pct`),
  built from `fact_honorarium` grouped by `bhw_id` with `sum(normalized_monthly_amount)`.
- Also expose an average/median cumulative monthly amount per BHW as a headline stat.
- Drive the "₱X per day" framing from the median cumulative monthly amount ÷ 30.

### C. Cross-cutting

- **Geo comparison** is already possible today: `getHonorarium` is parameterized by
  geo, so an avg-amount-by-province ranked list / choropleth (mirroring
  `components/explore/geo-comparison-figure.tsx`) can be built now — prioritize over
  the harder cumulative metric.
- **Correlation** of honorarium with accreditation / certification / years of service
  is interesting but lower priority; needs a bespoke person-level join, not a quick
  aggregate read.
- **Privacy**: any fine-grained amount breakdown must follow the existing n<5
  suppression convention (`agg_demographics.is_suppressed` / rollup) rather than
  inventing a new pattern.
