create table agg_data_completeness (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  field_name text not null,
  n_missing integer,
  pct_missing numeric,
  unique (dataset_id, field_name)
);

alter table agg_data_completeness enable row level security;

create policy "agg_data_completeness public read" on agg_data_completeness
  for select
  to anon, authenticated
  using (true);
