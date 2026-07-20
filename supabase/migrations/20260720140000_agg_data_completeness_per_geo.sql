-- Per-geo data completeness. agg_data_completeness was dataset-wide (one row per
-- field), which made it impossible to show completeness on a place page without
-- passing a national figure off as local. Add geo columns so the table holds one
-- row per (geo, field) at national/region/province/citymun — barangay is omitted
-- for the same disk-budget reason as agg_training (BUILD_PLAN.md §6).
--
-- Existing rows are dataset-wide, i.e. exactly the national figures, so they
-- default into geo_level='national'/'PH' rather than being dropped; the next
-- build_aggregates.sql run replaces them with explicitly per-geo rows anyway.
alter table agg_data_completeness
  add column geo_level geo_level_enum not null default 'national',
  add column geo_code text not null default 'PH';

alter table agg_data_completeness
  alter column geo_level drop default,
  alter column geo_code drop default;

alter table agg_data_completeness
  drop constraint agg_data_completeness_dataset_id_field_name_key;

alter table agg_data_completeness
  add constraint agg_data_completeness_dataset_geo_field_key
  unique (dataset_id, geo_level, geo_code, field_name);

create index agg_data_completeness_geo_idx on agg_data_completeness (geo_code, geo_level);
