create table agg_geo_summary (
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  geo_name text not null,
  parent_chain jsonb,
  n_total integer,
  pct_accredited numeric,
  top_training_gap text,
  any_honorarium_pct numeric,
  search_text tsvector,
  primary key (dataset_id, geo_code)
);

create index agg_geo_summary_search_text_idx on agg_geo_summary using gin (search_text);

alter table agg_geo_summary enable row level security;

create policy "agg_geo_summary public read" on agg_geo_summary
  for select
  to anon, authenticated
  using (true);
