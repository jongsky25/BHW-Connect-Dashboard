create table agg_bhw_counts (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  n_total integer,
  n_accredited integer,
  pct_accredited numeric,
  avg_active_years numeric,
  any_honorarium_pct numeric,
  unique (dataset_id, geo_code, geo_level)
);

alter table agg_bhw_counts enable row level security;

create policy "agg_bhw_counts public read" on agg_bhw_counts
  for select
  to anon, authenticated
  using (true);
