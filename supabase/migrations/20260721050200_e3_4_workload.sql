-- E3.4: workload distribution. Per-BHW assigned-household counts summarized per
-- geo into p10/p25/median/p75/p90 + mean, plus the share of all assigned
-- households covered by the busiest 10% of BHWs. National/region/province/citymun
-- grain (barangay skipped, same disk cut as agg_training; barangay place pages
-- fall back to their citymun). The distribution columns are suppressed (nulled,
-- is_suppressed=true) for any geo with fewer than 5 BHWs reporting a household
-- count, mirroring agg_honorarium's small-n rule. household = 0 / null is excluded
-- (not a real caseload). Idempotent; mirrored in build_aggregates.sql. Applied
-- live via the Supabase MCP.
create table if not exists agg_workload (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  n_bhw integer not null, -- BHWs with a reported household count > 0
  p10 numeric,
  p25 numeric,
  median numeric,
  p75 numeric,
  p90 numeric,
  mean numeric,
  busiest_decile_share numeric, -- % of all households covered by the top 10% of BHWs
  is_suppressed boolean not null default false,
  unique (dataset_id, geo_code, geo_level)
);

alter table agg_workload enable row level security;

create policy "agg_workload public read" on agg_workload
  for select
  to anon, authenticated
  using (true);

delete from agg_workload where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with fanned as (
  select f.household, lvl.geo_level, lvl.geo_code
  from fact_bhw_raw f
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  cross join lateral (values
    ('citymun'::geo_level_enum, dg.citymun_code),
    ('province'::geo_level_enum, dg.province_code),
    ('region'::geo_level_enum, dg.region_code),
    ('national'::geo_level_enum, 'PH')
  ) as lvl(geo_level, geo_code)
  where f.household is not null and f.household > 0
),
dist as (
  select geo_code, geo_level, count(*) as n_bhw,
    round((percentile_cont(0.10) within group (order by household))::numeric, 1) as p10,
    round((percentile_cont(0.25) within group (order by household))::numeric, 1) as p25,
    round((percentile_cont(0.50) within group (order by household))::numeric, 1) as median,
    round((percentile_cont(0.75) within group (order by household))::numeric, 1) as p75,
    round((percentile_cont(0.90) within group (order by household))::numeric, 1) as p90,
    round(avg(household)::numeric, 1) as mean,
    sum(household) as total_hh
  from fanned group by geo_code, geo_level
),
ranked as (
  select geo_code, geo_level, household,
    percent_rank() over (partition by geo_code, geo_level order by household desc) as pr
  from fanned
),
top_decile as (
  select geo_code, geo_level,
    sum(household) filter (where pr < 0.10) as top_hh
  from ranked group by geo_code, geo_level
)
insert into agg_workload
  (dataset_id, geo_code, geo_level, n_bhw, p10, p25, median, p75, p90, mean, busiest_decile_share, is_suppressed)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  d.geo_code, d.geo_level, d.n_bhw,
  case when d.n_bhw < 5 then null else d.p10 end,
  case when d.n_bhw < 5 then null else d.p25 end,
  case when d.n_bhw < 5 then null else d.median end,
  case when d.n_bhw < 5 then null else d.p75 end,
  case when d.n_bhw < 5 then null else d.p90 end,
  case when d.n_bhw < 5 then null else d.mean end,
  case when d.n_bhw < 5 then null else round(100.0 * td.top_hh / nullif(d.total_hh, 0), 1) end,
  (d.n_bhw < 5)
from dist d
join top_decile td on td.geo_code = d.geo_code and td.geo_level = d.geo_level;
