create table agg_demographics (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  dimension demographic_dimension_enum not null,
  category text not null,
  n integer,
  pct numeric,
  is_suppressed boolean not null default false,
  rollup_geo_code text references dim_geo (geo_code),
  rollup_geo_level geo_level_enum,
  unique (dataset_id, geo_code, geo_level, dimension, category)
);

alter table agg_demographics enable row level security;

create policy "agg_demographics public read" on agg_demographics
  for select
  to anon, authenticated
  using (true);
