create table dim_dataset (
  dataset_id bigint generated always as identity primary key,
  slug text unique not null,
  name text not null,
  source_name text,
  source_url text,
  license text,
  methodology_md text,
  geo_join_level geo_level_enum,
  as_of_date date,
  version text,
  last_updated_at timestamptz not null default now(),
  status text
);

alter table dim_dataset enable row level security;

create policy "dim_dataset public read" on dim_dataset
  for select
  to anon, authenticated
  using (true);
