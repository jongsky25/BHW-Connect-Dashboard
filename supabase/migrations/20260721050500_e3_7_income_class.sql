-- E3.7: income-class equity view. National-scope indicator summaries grouped by
-- the LGU (city/municipality) income class (1st–6th) each BHW's barangay belongs
-- to — a "do lower-income municipalities support their BHWs less?" lens. Uses only
-- internal data (dim_geo.income_class); E4.3 will refresh those classes from the
-- 2024 DOF/BLGF reclassification. Six rows, national only. Pooled BHW-level rates
-- for accreditation and any-honorarium; median of the per-payment normalized
-- monthly honorarium among receiving BHWs. Idempotent; mirrored in
-- build_aggregates.sql. Applied live via the Supabase MCP.
create table if not exists agg_by_income_class (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  income_class smallint not null, -- 1..6
  n_bhw integer not null,
  n_citymun integer,
  pct_accredited numeric,
  any_honorarium_pct numeric,
  median_honorarium_amount numeric,
  unique (dataset_id, income_class)
);

alter table agg_by_income_class enable row level security;

create policy "agg_by_income_class public read" on agg_by_income_class
  for select
  to anon, authenticated
  using (true);

delete from agg_by_income_class where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with hon_bhw as (select distinct bhw_id from fact_honorarium),
base as (
  select f.bhw_id, f.accredited, dg.income_class, (hb.bhw_id is not null) as any_hon
  from fact_bhw_raw f
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  left join hon_bhw hb on hb.bhw_id = f.bhw_id
  where dg.income_class between 1 and 6
),
agg as (
  select income_class, count(*) as n_bhw,
    round(100.0 * count(*) filter (where accredited) / nullif(count(*), 0), 2) as pct_accredited,
    round(100.0 * count(*) filter (where any_hon) / nullif(count(*), 0), 2) as any_honorarium_pct
  from base group by income_class
),
hon_amt as (
  select dg.income_class,
    round((percentile_cont(0.5) within group (order by h.normalized_monthly_amount))::numeric, 2) as med
  from fact_honorarium h
  join fact_bhw_raw f on f.bhw_id = h.bhw_id
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  where dg.income_class between 1 and 6 and h.normalized_monthly_amount > 0
  group by dg.income_class
),
cm as (
  select income_class, count(*) as n_citymun
  from dim_geo where geo_level = 'citymun' and income_class between 1 and 6
  group by income_class
)
insert into agg_by_income_class
  (dataset_id, income_class, n_bhw, n_citymun, pct_accredited, any_honorarium_pct, median_honorarium_amount)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  a.income_class, a.n_bhw, cm.n_citymun, a.pct_accredited, a.any_honorarium_pct, hon_amt.med
from agg a
left join cm on cm.income_class = a.income_class
left join hon_amt on hon_amt.income_class = a.income_class
order by a.income_class;
