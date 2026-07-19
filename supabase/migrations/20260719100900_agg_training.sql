create table agg_training (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  topic_slug text not null,
  topic_label text,
  n_trained integer,
  n_total integer,
  coverage_pct numeric,
  median_training_year smallint,
  unique (dataset_id, geo_code, geo_level, topic_slug)
);

alter table agg_training enable row level security;

create policy "agg_training public read" on agg_training
  for select
  to anon, authenticated
  using (true);
