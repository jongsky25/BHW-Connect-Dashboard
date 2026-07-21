-- Increment 2: honorarium sufficiency ("is it enough?"), banded cumulative
-- per-BHW honorarium among ALL profiled BHWs (not just recipients). Each BHW's
-- total normalized monthly honorarium (summed across every paying level they
-- receive from; non-recipients get 0) is banded into 8 buckets and counted
-- per geo. National/region/province/citymun grain (barangay skipped, same
-- disk discipline as agg_training/agg_workload). Reproduces the deck's
-- "59% receive less than ₱68/day" headline.
--
-- Critical delta vs agg_honorarium_inequality (E3.5): that table's denominator
-- is receiving BHWs only (inner join fact_honorarium). This table's denominator
-- is ALL profiled BHWs (left join fact_honorarium from fact_bhw_raw) so
-- non-recipients land in the "None" band (band_order 0) rather than being
-- excluded — this is what makes "% below sufficiency" a statement about the
-- whole profiled population, not just those already receiving something.
--
-- Bands (R4 — scope doc's default 4k steps; deck slide 14 unavailable so kept
-- as documented default): 0 None (amt <= 0) - 1 ₱1-4,000 - 2 ₱4,001-8,000 -
-- 3 ₱8,001-12,000 - 4 ₱12,001-16,000 - 5 ₱16,001-20,000 - 6 ₱20,001-24,000 -
-- 7 Over ₱24,000.
--
-- R5 threshold resolution (empirical, run live against this dataset before
-- finalizing this migration): the scope doc's own arithmetic conflicted
-- ("₱68/day" implies ~₱2,040/month vs a separate "~₱300/month" parenthetical).
-- Querying the per-BHW cumulative CTE below (all 270,917 profiled BHWs)
-- gives: pct_below(amt < 300) = 3.6%, pct_below(amt < 2040) = 59.2%,
-- median = ₱1,750/month. 59.2% matches the deck's "59%" almost exactly, while
-- 3.6% is nowhere close. Threshold is therefore ₱2,040/month (₱68/day),
-- matching lib/analysis/thresholds.ts's HONORARIUM_SUFFICIENCY_MONTHLY_PHP.
--
-- Suppression: band cells with 0 < n < 5 have n/pct nulled and is_suppressed
-- set true (band membership at n<5 can out an individual's pay band); n = 0
-- stays visible (a true zero reveals nothing about any individual). Geos with
-- fewer than 5 total profiled BHWs have median_cumulative_monthly and
-- pct_below_sufficiency nulled and every one of their 8 band rows marked
-- is_suppressed (n_total itself, a plain headcount, stays visible — same
-- convention as agg_workload.n_bhw / agg_honorarium_inequality.n_receiving).
-- Idempotent; mirrored in build_aggregates.sql §16. Applied live via the
-- Supabase MCP.
create table if not exists agg_honorarium_cumulative (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  band_order smallint not null,
  band_label text not null,
  n integer,
  pct numeric,
  n_total integer not null,
  median_cumulative_monthly numeric,
  pct_below_sufficiency numeric,
  is_suppressed boolean not null default false,
  unique (dataset_id, geo_code, geo_level, band_order)
);

alter table agg_honorarium_cumulative enable row level security;

create policy "agg_honorarium_cumulative public read" on agg_honorarium_cumulative
  for select
  to anon, authenticated
  using (true);

delete from agg_honorarium_cumulative where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with per_bhw as (
  select f.bhw_id,
    coalesce(sum(h.normalized_monthly_amount) filter (where h.normalized_monthly_amount > 0), 0) as amt,
    dg.region_code, dg.province_code, dg.citymun_code
  from fact_bhw_raw f
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  left join fact_honorarium h on h.bhw_id = f.bhw_id
  group by f.bhw_id, dg.region_code, dg.province_code, dg.citymun_code
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
banded as (
  select geo_code, geo_level, amt,
    case
      when amt <= 0 then 0
      when amt <= 4000 then 1
      when amt <= 8000 then 2
      when amt <= 12000 then 3
      when amt <= 16000 then 4
      when amt <= 20000 then 5
      when amt <= 24000 then 6
      else 7
    end as band_order
  from fanned
),
geo_stats as (
  select geo_code, geo_level, count(*) as n_total,
    round((percentile_cont(0.5) within group (order by amt))::numeric, 2) as median_amt,
    round(100.0 * count(*) filter (where amt < 2040) / count(*), 1) as pct_below
  from banded
  group by geo_code, geo_level
),
band_counts as (
  select geo_code, geo_level, band_order, count(*) as n
  from banded
  group by geo_code, geo_level, band_order
),
bands as (
  select * from (values
    (0, 'None'),
    (1, '₱1-4,000'),
    (2, '₱4,001-8,000'),
    (3, '₱8,001-12,000'),
    (4, '₱12,001-16,000'),
    (5, '₱16,001-20,000'),
    (6, '₱20,001-24,000'),
    (7, 'Over ₱24,000')
  ) as b(band_order, band_label)
),
zero_filled as (
  select gs.geo_code, gs.geo_level, b.band_order, b.band_label,
    coalesce(bc.n, 0) as n,
    gs.n_total, gs.median_amt, gs.pct_below
  from geo_stats gs
  cross join bands b
  left join band_counts bc
    on bc.geo_code = gs.geo_code and bc.geo_level = gs.geo_level and bc.band_order = b.band_order
)
insert into agg_honorarium_cumulative
  (dataset_id, geo_code, geo_level, band_order, band_label, n, pct, n_total,
   median_cumulative_monthly, pct_below_sufficiency, is_suppressed)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  z.geo_code, z.geo_level, z.band_order, z.band_label,
  case when z.n_total < 5 then null
       when z.n > 0 and z.n < 5 then null
       else z.n end,
  case when z.n_total < 5 then null
       when z.n > 0 and z.n < 5 then null
       else round(100.0 * z.n / nullif(z.n_total, 0), 1) end,
  z.n_total,
  case when z.n_total < 5 then null else z.median_amt end,
  case when z.n_total < 5 then null else z.pct_below end,
  (z.n_total < 5 or (z.n > 0 and z.n < 5))
from zero_filled z;
