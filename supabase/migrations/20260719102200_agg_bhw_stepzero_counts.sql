-- StepZero quick-count aggregate (see docs/DECISIONS.md and ingestion/ingest_stepzero.py).
--
-- A separate table from agg_bhw_counts, not a shared one: this dataset's three BHW
-- buckets (registered-only / registered & accredited / non-registered) and its
-- population/household context have no equivalent in agg_bhw_counts, and its
-- "accredited" figure is a self-reported barangay tally rather than agg_bhw_counts'
-- per-person verified accreditation flag - keeping them separate avoids conflating two
-- differently-measured notions of the same word under one column.
create table agg_bhw_stepzero_counts (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  n_registered integer,
  n_registered_accredited integer,
  n_non_registered integer,
  n_total_bhw integer,
  pct_registered_accredited numeric,
  population integer,
  households integer,
  unique (dataset_id, geo_code, geo_level)
);

alter table agg_bhw_stepzero_counts enable row level security;

create policy "agg_bhw_stepzero_counts public read" on agg_bhw_stepzero_counts
  for select
  to anon, authenticated
  using (true);
