-- UUC for PHC 2025 aggregate — how many barangays in an area are on the list, and how many
-- barangays the area has in total (docs/UUC_PHC_2025_PLAN.md increment U2).
--
-- Keyed like every other aggregate in this repo: (dataset_id, geo_code, geo_level), seeded at
-- national / region / province / city-municipality. Two columns only, because this dataset is a
-- membership list rather than a measurement:
--
--   n_listed     — barangays in this area on the 2025 UUC for PHC list
--   n_barangays  — barangays in this area at all, from dim_geo
--
-- The share (n_listed / n_barangays) is derived in the read layer, not stored, so the definition
-- lives in one place — the same discipline as agg_bhw_profiling_status' stage totals.
--
-- **The denominator is dim_geo's, deliberately.** The source workbook also assessed 9,395
-- barangays it did not list, but those are not loaded (U1's scope decision), and they are not the
-- universe anyway: "3 of the 42 barangays in this town are UUC for PHC" is the statement a reader
-- wants, and 42 comes from dim_geo. Using the workbook's assessed set would silently answer a
-- different question — share of *assessed* barangays — with a denominator that is missing 769
-- barangays it could not resolve.
--
-- **Rows exist for every geo, including those with none listed.** A province with no UUC barangays
-- reads 0 of N, which is a finding; leaving the row out would render as "no data", which is not
-- the same thing and is the failure mode the profiling-status card had to message around. This is
-- affordable precisely because the aggregate is small: 1,788 rows (1 national + 18 regions +
-- 118 provinces + 1,651 city/municipalities).
--
-- **No barangay-level rows.** They would be 41,958 rows of n_listed ∈ {0,1} restating the fact
-- table. A city/municipality page lists its own barangays from fact_uuc_phc_barangay directly.
--
-- Derived entirely in SQL from fact_uuc_phc_barangay + dim_geo, so there is no generated seed to
-- drift: re-running this file recomputes it. dim_geo's parent chain is verified complete — every
-- barangay has a non-null citymun/province/region code and every one of those codes exists in
-- dim_geo at its level — so the rollups lose nothing.
create table if not exists agg_uuc_phc_counts (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  -- Barangays in this area on the 2025 UUC for PHC list.
  n_listed integer not null default 0,
  -- Barangays in this area in total (dim_geo). The share's denominator.
  n_barangays integer not null default 0,
  unique (dataset_id, geo_code, geo_level)
);

-- Read paths: exact (geo_code, geo_level) for one area, and (dataset_id, geo_level) for the
-- child-unit breakdown — mirrors agg_bhw_profiling_status' pair.
create index if not exists agg_uuc_phc_counts_geo_idx
  on agg_uuc_phc_counts (geo_code, geo_level);
create index if not exists agg_uuc_phc_counts_level_idx
  on agg_uuc_phc_counts (dataset_id, geo_level);

comment on table agg_uuc_phc_counts is
  'Per-geo counts of barangays on the 2025 UUC for PHC list (n_listed) against all barangays in the area (n_barangays, from dim_geo). Rolled up national/region/province/citymun. Share derived in the read layer. See docs/UUC_PHC_2025_PLAN.md.';

alter table agg_uuc_phc_counts enable row level security;

-- Public, aggregate-only (no personal data): anyone may read; no client writes.
drop policy if exists "agg_uuc_phc_counts public read" on agg_uuc_phc_counts;
create policy "agg_uuc_phc_counts public read" on agg_uuc_phc_counts
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------------------------
-- Populate. Idempotent: recomputes and upserts every row, so re-running after a fact reload is
-- the refresh procedure. Deletes nothing — the (dataset_id, geo_code, geo_level) unique key makes
-- every row a stable target.
with ds as (
  select dataset_id from dim_dataset where slug = 'uuc-phc-2025'
),
brgy as (
  -- One row per barangay in the country, flagged with whether it is on the list. A LEFT JOIN,
  -- not an inner one: the zero rows are the point (see the header note).
  select
    g.citymun_code,
    g.province_code,
    g.region_code,
    case when f.geo_code is null then 0 else 1 end as listed
  from dim_geo g
  left join fact_uuc_phc_barangay f
    on f.geo_code = g.geo_code
   and f.dataset_id = (select dataset_id from ds)
  where g.geo_level = 'barangay'
),
rolled as (
  select 'PH' as geo_code, 'national'::geo_level_enum as geo_level,
         sum(listed)::int as n_listed, count(*)::int as n_barangays
    from brgy
  union all
  select region_code, 'region'::geo_level_enum, sum(listed)::int, count(*)::int
    from brgy group by region_code
  union all
  select province_code, 'province'::geo_level_enum, sum(listed)::int, count(*)::int
    from brgy group by province_code
  union all
  select citymun_code, 'citymun'::geo_level_enum, sum(listed)::int, count(*)::int
    from brgy group by citymun_code
)
insert into agg_uuc_phc_counts (dataset_id, geo_code, geo_level, n_listed, n_barangays)
select (select dataset_id from ds), r.geo_code, r.geo_level, r.n_listed, r.n_barangays
from rolled r
on conflict (dataset_id, geo_code, geo_level) do update set
  n_listed = excluded.n_listed,
  n_barangays = excluded.n_barangays;
