-- D3.1 (docs/LEGISLATIVE_DISTRICTS_PLAN.md §6) -- district aggregates, rolled up from the leaf
-- grain. First dataset only: agg_bhw_by_district for the profiled census (bhw-2025). The plan asks
-- for the UUC-PHC and profiling-status datasets too, "once the first one is proven" -- deferred to
-- a follow-up increment rather than built speculatively here.
--
-- Same shape as agg_bhw_counts (n_total, n_accredited, pct_accredited, avg_active_years,
-- any_honorarium_pct), keyed (dataset_id, district_code) instead of (dataset_id, geo_code,
-- geo_level) -- a district is not a geo_level (plan §1), so it gets its own aggregate rather than
-- a sixth value jammed into geo_level_enum.
--
-- THE ONE ARITHMETIC TRAP (plan §6, stated once so it is never re-discovered): a multi-district
-- city's BHW count must be summed from its barangay rows, not from its citymun row. geo_district_map
-- already carries each district's members at whatever grain they were resolved at -- citymun for a
-- province-level district, barangay for a split city -- so this migration resolves every member down
-- to its barangay children before counting, never trusts a citymun-grain figure for a district that
-- might share that city with a sibling, and asserts the result before publishing it.
create table agg_bhw_by_district (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  district_code text not null references dim_legislative_district (district_code) on delete cascade,
  n_total integer not null,
  n_accredited integer not null,
  pct_accredited numeric,
  avg_active_years numeric,
  any_honorarium_pct numeric,
  unique (dataset_id, district_code)
);

comment on table agg_bhw_by_district is
  'BHW counts and rates per legislative district, rolled up from the LEAF grain (barangay), never from a member citymun row -- a multi-district city''s headcount would otherwise land on whichever sibling district''s citymun row it hit, or be double-counted across all of them. Same column shape as agg_bhw_counts, at the district grain instead of geo_level. Only districts with at least one matching BHW get a row, same convention as agg_bhw_counts. A district''s figure excludes any of its own gap (docs/LEGISLATIVE_DISTRICTS.md''s uncovered/unplaced lists) by construction -- those places carry no district in geo_district_map at all, so they contribute to no district''s total. See docs/LEGISLATIVE_DISTRICTS_PLAN.md §6 D3.1.';
comment on column agg_bhw_by_district.n_total is
  'Profiled BHWs (fact_bhw_raw) whose barangay resolves, directly or via its citymun, to a live geo_district_map row for this district. Summed from barangay grain -- see the table comment.';
comment on column agg_bhw_by_district.any_honorarium_pct is
  'Share of this district''s BHWs with at least one fact_honorarium row, same definition as agg_bhw_counts.any_honorarium_pct.';

alter table agg_bhw_by_district enable row level security;

create policy "agg_bhw_by_district public read" on agg_bhw_by_district
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------------------------
-- 1. Resolve every live district member down to its barangay children -- the leaf-set step the
-- table comment names. A citymun-grain row fans out to that city's own barangays; a barangay-grain
-- row (the split-city case) stays itself. Materialized so the population insert and the assertions
-- below read the exact same resolution rather than risking two copies of this join drifting apart.
--
-- lineage: table:agg_bhw_by_district derived-from table:geo_district_map
-- lineage: table:agg_bhw_by_district derived-from table:fact_bhw_raw
drop table if exists _district_leaf_map;
create table _district_leaf_map as
with live as (
  select district_code, geo_code, geo_level
  from geo_district_map
  where superseded_by is null and status <> 'rejected'
)
select l.district_code, b.geo_code as barangay_code
from live l
join dim_geo b on b.geo_level = 'barangay' and b.citymun_code = l.geo_code
where l.geo_level = 'citymun'
union all
select l.district_code, l.geo_code as barangay_code
from live l
where l.geo_level = 'barangay';

create index on _district_leaf_map (barangay_code);

-- Guardrail 3 (plan §7), checked before a single row is published: no barangay may resolve to more
-- than one district. A citymun-grain row and a barangay-grain row both claiming the same barangay
-- -- across the same district or different ones -- is exactly the double-count this table exists to
-- prevent, and the QA report's own double_claimed_count already asserts zero at the source-table
-- level (docs/LEGISLATIVE_DISTRICTS.md); this re-checks it at the leaf grain this table actually
-- sums over.
do $$
declare
  n_bad integer;
begin
  select count(*) into n_bad
  from (
    select barangay_code
    from _district_leaf_map
    group by barangay_code
    having count(distinct district_code) > 1
  ) dupes;
  if n_bad > 0 then
    raise exception '% barangay(s) resolve to more than one district in _district_leaf_map', n_bad;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Populate. Idempotent: a full delete-then-insert for this dataset, same as build_aggregates.sql
-- does for every other geo-level aggregate, so re-running after a re-ingest or a mapping correction
-- is the refresh procedure.
delete from agg_bhw_by_district
where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with base as (
  select f.bhw_id, f.accredited, f.active_years_count, m.district_code
  from fact_bhw_raw f
  join _district_leaf_map m on m.barangay_code = f.geo_code
),
honorarium_any as (
  select distinct bhw_id from fact_honorarium
)
insert into agg_bhw_by_district (dataset_id, district_code, n_total, n_accredited, pct_accredited, avg_active_years, any_honorarium_pct)
select
  (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  b.district_code,
  count(*),
  count(*) filter (where b.accredited),
  round(100.0 * count(*) filter (where b.accredited) / nullif(count(*), 0), 2),
  round(avg(b.active_years_count), 2),
  round(100.0 * count(*) filter (where ha.bhw_id is not null) / nullif(count(*), 0), 2)
from base b
left join honorarium_any ha on ha.bhw_id = b.bhw_id
group by b.district_code;

-- ---------------------------------------------------------------------------------------------
-- 3. Assertions. Both abort the migration rather than publish a wrong total.
do $$
declare
  n_bad integer;
  sum_n_total bigint;
  national_total integer;
  gap_bhws integer;
begin
  -- No count exceeds its own denominator.
  select count(*) into n_bad
  from agg_bhw_by_district
  where n_accredited > n_total or n_total < 0 or n_accredited < 0;
  if n_bad > 0 then
    raise exception '% row(s) carry a count outside its denominator', n_bad;
  end if;

  -- The arithmetic-trap check itself: every district total plus the known, published gap
  -- (docs/LEGISLATIVE_DISTRICTS.md's uncovered LGUs and unplaced barangays, counted here as the
  -- BHWs whose barangay resolves to no live district row) must reproduce the national total exactly.
  -- The mapping does not cover the country yet (23 uncovered LGUs, 41 unplaced barangays as of the
  -- last build), so the honest equality carries that residual explicitly rather than pretending
  -- coverage is complete -- same posture 20260827190000_agg_bhw_by_uuc_status.sql takes with
  -- unallocated_n_bhw. A double-count would break this: a barangay wrongly attributed to two
  -- districts inflates the sum without shrinking the gap, so the two sides would stop matching.
  select coalesce(sum(n_total), 0) into sum_n_total
  from agg_bhw_by_district
  where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

  select n_total into national_total
  from agg_bhw_counts
  where geo_code = 'PH' and geo_level = 'national'
    and dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

  select count(*) into gap_bhws
  from fact_bhw_raw f
  where not exists (select 1 from _district_leaf_map m where m.barangay_code = f.geo_code);

  if sum_n_total + gap_bhws <> national_total then
    raise exception 'district totals (%) + gap (%) <> national total (%)',
      sum_n_total, gap_bhws, national_total;
  end if;
end $$;

drop table _district_leaf_map;
