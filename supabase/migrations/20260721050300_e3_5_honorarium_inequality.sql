-- E3.5: honorarium inequality among receiving BHWs, per geo. Each BHW's total
-- normalized monthly honorarium (summed across every paying level they receive
-- from) is the unit; among BHWs receiving any honorarium in a geo we compute the
-- Gini coefficient and the p90:p10 ratio. National/region/province/citymun grain
-- (barangay skipped). Suppressed (nulled, is_suppressed=true) for any geo with
-- fewer than 5 receiving BHWs, since an inequality statistic on 1-4 amounts can
-- reveal an individual's pay. Gini uses the standard rank formula on ascending
-- amounts: G = 2*Σ(i·x_i)/(n·Σx_i) − (n+1)/n. Idempotent; mirrored in
-- build_aggregates.sql. Applied live via the Supabase MCP.
create table if not exists agg_honorarium_inequality (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  n_receiving integer not null,
  gini numeric,
  p10_amount numeric,
  p90_amount numeric,
  p90_p10_ratio numeric,
  is_suppressed boolean not null default false,
  unique (dataset_id, geo_code, geo_level)
);

alter table agg_honorarium_inequality enable row level security;

create policy "agg_honorarium_inequality public read" on agg_honorarium_inequality
  for select
  to anon, authenticated
  using (true);

delete from agg_honorarium_inequality where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with per_bhw as (
  select h.bhw_id, sum(h.normalized_monthly_amount) as amt,
    dg.region_code, dg.province_code, dg.citymun_code
  from fact_honorarium h
  join fact_bhw_raw f on f.bhw_id = h.bhw_id
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  where h.normalized_monthly_amount is not null and h.normalized_monthly_amount > 0
  group by h.bhw_id, dg.region_code, dg.province_code, dg.citymun_code
),
fanned as (
  select amt, lvl.geo_level, lvl.geo_code
  from per_bhw
  cross join lateral (values
    ('citymun'::geo_level_enum, citymun_code),
    ('province'::geo_level_enum, province_code),
    ('region'::geo_level_enum, region_code),
    ('national'::geo_level_enum, 'PH')
  ) as lvl(geo_level, geo_code)
),
ranked as (
  select geo_code, geo_level, amt,
    row_number() over (partition by geo_code, geo_level order by amt) as rn,
    count(*) over (partition by geo_code, geo_level) as n
  from fanned
),
gini_calc as (
  select geo_code, geo_level, max(n) as n_receiving,
    round(((2.0 * sum(rn * amt)) / nullif(max(n) * sum(amt), 0)
      - (max(n) + 1.0) / max(n))::numeric, 3) as gini
  from ranked group by geo_code, geo_level
),
pcts as (
  select geo_code, geo_level,
    round((percentile_cont(0.10) within group (order by amt))::numeric, 2) as p10,
    round((percentile_cont(0.90) within group (order by amt))::numeric, 2) as p90
  from fanned group by geo_code, geo_level
)
insert into agg_honorarium_inequality
  (dataset_id, geo_code, geo_level, n_receiving, gini, p10_amount, p90_amount, p90_p10_ratio, is_suppressed)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  g.geo_code, g.geo_level, g.n_receiving,
  case when g.n_receiving < 5 then null else g.gini end,
  case when g.n_receiving < 5 then null else p.p10 end,
  case when g.n_receiving < 5 then null else p.p90 end,
  case when g.n_receiving < 5 or p.p10 is null or p.p10 = 0 then null
    else round(p.p90 / p.p10, 1) end,
  (g.n_receiving < 5)
from gini_calc g
join pcts p on p.geo_code = g.geo_code and p.geo_level = g.geo_level;
