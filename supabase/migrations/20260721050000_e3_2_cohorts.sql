-- E3.2: year cohorts. One row per (geo × kind × cohort_year) counting how many
-- of today's profiled BHWs were registered / accredited / first became active in
-- that year — the "waves" figure. National→citymun grain (barangay is skipped for
-- the same disk-budget reason as agg_training). Only non-zero cells are stored, so
-- the table stays sparse (~104k rows). Framing is locked to the 2025 snapshot: the
-- years are as recorded in the 2025 dataset, and everyone in it is a current BHW —
-- this is not a time series of the workforce, only when today's BHWs reached each
-- milestone. Idempotent (delete-by-dataset then insert); mirrored in
-- ingestion/build_aggregates.sql. Applied live via the Supabase MCP.
create table if not exists agg_cohorts (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  kind text not null, -- 'registered' | 'accredited' | 'first_active'
  cohort_year smallint not null,
  n integer not null,
  unique (dataset_id, geo_code, geo_level, kind, cohort_year)
);

alter table agg_cohorts enable row level security;

create policy "agg_cohorts public read" on agg_cohorts
  for select
  to anon, authenticated
  using (true);

delete from agg_cohorts where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with fanned as (
  select f.registered_year, f.accreditation_year, f.first_active_year,
    lvl.geo_level, lvl.geo_code
  from fact_bhw_raw f
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  cross join lateral (values
    ('citymun'::geo_level_enum, dg.citymun_code),
    ('province'::geo_level_enum, dg.province_code),
    ('region'::geo_level_enum, dg.region_code),
    ('national'::geo_level_enum, 'PH')
  ) as lvl(geo_level, geo_code)
),
unioned as (
  select geo_code, geo_level, 'registered' as kind, registered_year as yr
  from fanned where registered_year between 1995 and 2025
  union all
  select geo_code, geo_level, 'accredited', accreditation_year
  from fanned where accreditation_year between 1995 and 2025
  union all
  select geo_code, geo_level, 'first_active', first_active_year
  from fanned where first_active_year between 1995 and 2025
)
insert into agg_cohorts (dataset_id, geo_code, geo_level, kind, cohort_year, n)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  geo_code, geo_level, kind, yr, count(*)
from unioned
group by geo_code, geo_level, kind, yr;
