-- E2.3 + E2.4: a thin peer-rank/outlier table (one row per geo × indicator),
-- rather than sprawling rank/outlier columns across agg_geo_summary. Ranks each
-- geo among its same-level siblings (within its parent; regions among all
-- regions) for the six base indicators, and flags MAD outliers. Covers
-- region/province/citymun — barangay is excluded, same disk-budget cut as
-- agg_training. Idempotent: recreated + repopulated in place, and mirrored in
-- ingestion/build_aggregates.sql. Applied live via the Supabase MCP.
create table if not exists agg_peer_ranks (
  id bigserial primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  indicator text not null,
  value numeric,
  n_total integer,
  rank_position integer,
  n_siblings integer,
  percentile numeric,
  median numeric,
  mad numeric,
  is_outlier boolean not null default false,
  unique (dataset_id, geo_code, geo_level, indicator)
);

delete from agg_peer_ranks
where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with ds as (
  select
    (select dataset_id from dim_dataset where slug = 'bhw-2025') as main_id,
    (select dataset_id from dim_dataset where slug = 'bhw-stepzero-2026') as sz_id
),
base as (
  select c.geo_code, c.geo_level, dg.parent_code, 'pct_accredited' as ind, c.pct_accredited as val
  from agg_bhw_counts c
  join dim_geo dg on dg.geo_code = c.geo_code and dg.geo_level = c.geo_level
  where c.dataset_id = (select main_id from ds) and c.geo_level in ('region','province','citymun')
    and c.pct_accredited is not null
  union all
  select c.geo_code, c.geo_level, dg.parent_code, 'avg_active_years', c.avg_active_years
  from agg_bhw_counts c
  join dim_geo dg on dg.geo_code = c.geo_code and dg.geo_level = c.geo_level
  where c.dataset_id = (select main_id from ds) and c.geo_level in ('region','province','citymun')
    and c.avg_active_years is not null
  union all
  select c.geo_code, c.geo_level, dg.parent_code, 'any_honorarium_pct', c.any_honorarium_pct
  from agg_bhw_counts c
  join dim_geo dg on dg.geo_code = c.geo_code and dg.geo_level = c.geo_level
  where c.dataset_id = (select main_id from ds) and c.geo_level in ('region','province','citymun')
    and c.any_honorarium_pct is not null
  union all
  select s.geo_code, s.geo_level, dg.parent_code, 'households_per_bhw',
    round(s.households::numeric / s.n_total_bhw, 1)
  from agg_bhw_stepzero_counts s
  join dim_geo dg on dg.geo_code = s.geo_code and dg.geo_level = s.geo_level
  where s.dataset_id = (select sz_id from ds) and s.geo_level in ('region','province','citymun')
    and s.households > 0 and s.n_total_bhw > 0
  union all
  select s.geo_code, s.geo_level, dg.parent_code, 'bhw_per_1000',
    round(1000.0 * s.n_total_bhw / s.population, 1)
  from agg_bhw_stepzero_counts s
  join dim_geo dg on dg.geo_code = s.geo_code and dg.geo_level = s.geo_level
  where s.dataset_id = (select sz_id from ds) and s.geo_level in ('region','province','citymun')
    and s.n_total_bhw > 0 and s.population > 0
  union all
  select c.geo_code, c.geo_level, dg.parent_code, 'coverage_pct',
    least(100, round(100.0 * c.n_total / nullif(s.n_registered + s.n_registered_accredited, 0), 1))
  from agg_bhw_counts c
  join agg_bhw_stepzero_counts s on s.geo_code = c.geo_code and s.geo_level = c.geo_level
    and s.dataset_id = (select sz_id from ds)
  join dim_geo dg on dg.geo_code = c.geo_code and dg.geo_level = c.geo_level
  where c.dataset_id = (select main_id from ds) and c.geo_level in ('region','province','citymun')
    and c.n_total is not null and (s.n_registered + s.n_registered_accredited) > 0
),
grp as (
  select parent_code, geo_level, ind, count(*) as n_sib,
    percentile_cont(0.5) within group (order by val) as med
  from base group by parent_code, geo_level, ind
),
dev as (
  select b.*, g.n_sib, g.med, abs(b.val - g.med) as adev
  from base b join grp g on g.parent_code = b.parent_code and g.geo_level = b.geo_level and g.ind = b.ind
),
madc as (
  select parent_code, geo_level, ind, percentile_cont(0.5) within group (order by adev) as mad
  from dev group by parent_code, geo_level, ind
),
ranked as (
  select d.geo_code, d.geo_level, d.ind, d.val, d.n_sib, d.med, m.mad,
    rank() over (partition by d.parent_code, d.geo_level, d.ind order by d.val desc) as rank_pos,
    round((percent_rank() over (partition by d.parent_code, d.geo_level, d.ind order by d.val asc) * 100)::numeric, 1) as pctile
  from dev d join madc m on m.parent_code = d.parent_code and m.geo_level = d.geo_level and m.ind = d.ind
)
insert into agg_peer_ranks
  (dataset_id, geo_code, geo_level, indicator, value, n_total, rank_position, n_siblings, percentile, median, mad, is_outlier)
select (select main_id from ds), r.geo_code, r.geo_level, r.ind, r.val, cc.n_total,
  r.rank_pos, r.n_sib, r.pctile, r.med, r.mad,
  (r.n_sib >= 8 and r.mad > 0 and abs(r.val - r.med) > 3 * r.mad)
from ranked r
left join agg_bhw_counts cc on cc.geo_code = r.geo_code and cc.geo_level = r.geo_level
  and cc.dataset_id = (select main_id from ds);
