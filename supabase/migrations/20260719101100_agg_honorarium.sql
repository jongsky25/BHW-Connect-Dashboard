create table agg_honorarium (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  payer_level payer_level_enum not null,
  n_receiving integer,
  pct_receiving numeric,
  avg_monthly_amount numeric,
  modal_frequency honorarium_frequency_enum,
  unique (dataset_id, geo_code, geo_level, payer_level)
);

alter table agg_honorarium enable row level security;

create policy "agg_honorarium public read" on agg_honorarium
  for select
  to anon, authenticated
  using (true);
