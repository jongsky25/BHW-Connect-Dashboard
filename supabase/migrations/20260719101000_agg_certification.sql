create table agg_certification (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  cert_type text not null,
  n integer,
  pct numeric,
  unique (dataset_id, geo_code, geo_level, cert_type)
);

alter table agg_certification enable row level security;

create policy "agg_certification public read" on agg_certification
  for select
  to anon, authenticated
  using (true);
