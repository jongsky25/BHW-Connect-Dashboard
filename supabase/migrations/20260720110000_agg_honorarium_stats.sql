-- Distribution stats for agg_honorarium (min/p25/median/p75/max), plus a
-- suppression flag for small-n cells whose distribution could reveal an
-- individual amount. See docs/HONORARIUM_ANALYSIS_SCOPE.md item A.
alter table agg_honorarium
  add column min_amount numeric,
  add column p25_amount numeric,
  add column median_amount numeric,
  add column p75_amount numeric,
  add column max_amount numeric,
  add column is_suppressed boolean not null default false;
