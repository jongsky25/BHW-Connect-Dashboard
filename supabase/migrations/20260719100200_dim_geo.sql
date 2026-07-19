create table dim_geo (
  geo_code text primary key,
  geo_level geo_level_enum not null,
  geo_name text not null,
  parent_code text references dim_geo (geo_code),
  region_code text,
  province_code text,
  citymun_code text,
  income_class smallint,
  psgc_vintage text
);

create index dim_geo_parent_code_idx on dim_geo (parent_code);
create index dim_geo_geo_level_idx on dim_geo (geo_level);
create index dim_geo_geo_name_trgm_idx on dim_geo using gin (geo_name extensions.gin_trgm_ops);

alter table dim_geo enable row level security;

create policy "dim_geo public read" on dim_geo
  for select
  to anon, authenticated
  using (true);
