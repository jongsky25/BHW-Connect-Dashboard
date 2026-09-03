-- D2.1 (docs/LEGISLATIVE_DISTRICTS_PLAN.md §5) — the /districts index needs, per district: a
-- member count, a BHW total, PSA population, and a match-quality badge. None of that is a column
-- anywhere; it is a join across geo_district_map's live rows and agg_bhw_counts, done once here
-- rather than pulled row-by-row into the app (geo_district_map alone is 3,513 rows, agg_bhw_counts
-- ~41k at citymun/barangay grain).
--
-- Two indexes dim_geo never needed before: this function's coverage check (below) filters it by
-- province_code and citymun_code, and without an index that is a 43k-row sequential scan per
-- lone district it has to check.
create index dim_geo_province_code_idx on dim_geo (province_code);
create index dim_geo_citymun_code_idx on dim_geo (citymun_code);

-- The match-quality badge the plan names is "all-exact / has-overrides / has-unresolved", but only
-- two of those three are honestly computable from this table alone:
--
--   all-exact / has-overrides read match_method on the district's own live rows and are exact.
--
--   has-unresolved (a district missing a member it should have) is NOT computable in general: the
--   23 uncovered LGUs and 41 unplaced barangays docs/LEGISLATIVE_DISTRICTS.md reports are known at
--   build time from the source text, not from anything geo_district_map records, and a province
--   split across several sibling districts gives no way to say *which* sibling a missing citymun
--   belongs to -- asserting one would be exactly the wrongly-attributed row guardrail 1 exists to
--   prevent. It IS computable, and unambiguous, for the one shape where a district IS its whole
--   scope: a lone district over a whole province or HUC has no sibling to share the gap with, so
--   any of that scope's children absent from its own live rows is unresolved BY this district,
--   full stop. That rung only (`gap` below) is what sets has-unresolved; every other kind of gap
--   stays unattributed here, same as the build report already treats it.
--
-- A district with zero live rows would fall through all three and read as clean, so it is called
-- out as its own 'no_members' state instead (none exist as of D1.6a, but the case is cheap to name
-- honestly rather than silently mislabel if it ever does).
create or replace function district_index(p_dataset_id bigint)
returns table (
  district_code text,
  district_name text,
  ordinal       smallint,
  is_lone       boolean,
  region_code   text,
  member_count  bigint,
  bhw_total     bigint,
  population    integer,
  match_quality text
)
language sql
stable
security invoker
set search_path = public
as $$
  with live as (
    select district_code, geo_code, geo_level, match_method
    from geo_district_map
    where superseded_by is null and status <> 'rejected'
  ),
  member_stats as (
    select
      district_code,
      count(*) as member_count,
      bool_or(match_method in ('manual_override', 'public_correction')) as has_override,
      bool_and(match_method = 'exact') as all_exact,
      -- Grain is homogeneous per district by construction (§1 of the plan: a district is either
      -- entirely citymun-grain or entirely barangay-grain), so min() just reads the one value.
      min(geo_level) as member_level
    from live
    group by district_code
  ),
  -- Only a lone district's own full scope, never a province/city shared with siblings (see above).
  lone_districts as (
    select d.district_code, d.parent_geo_code, ms.member_level
    from dim_legislative_district d
    join member_stats ms on ms.district_code = d.district_code
    where d.is_lone and d.parent_geo_code is not null
      and ms.member_level in ('citymun', 'barangay')
  ),
  lone_citymun_children as (
    select ld.district_code, c.geo_code
    from lone_districts ld
    join dim_geo c on c.geo_level = 'citymun' and c.province_code = ld.parent_geo_code
    where ld.member_level = 'citymun'
  ),
  -- A lone district over an HUC (dim_geo files the city as a province-level row -- see
  -- 20260902070000_district_independent_city.sql) resolves at barangay grain, so its "whole scope"
  -- is the barangay children of the one citymun the HUC container holds.
  lone_barangay_children as (
    select ld.district_code, c.geo_code
    from lone_districts ld
    join dim_geo hcity on hcity.geo_level = 'citymun' and hcity.province_code = ld.parent_geo_code
    join dim_geo c on c.geo_level = 'barangay' and c.citymun_code = hcity.geo_code
    where ld.member_level = 'barangay'
  ),
  expected as (
    select * from lone_citymun_children
    union all
    select * from lone_barangay_children
  ),
  gap as (
    select distinct e.district_code
    from expected e
    left join live lm on lm.district_code = e.district_code and lm.geo_code = e.geo_code
    where lm.geo_code is null
  ),
  bhw_agg as (
    select lm.district_code, sum(coalesce(a.n_total, 0)) as bhw_total
    from live lm
    join agg_bhw_counts a
      on a.geo_code = lm.geo_code and a.geo_level = lm.geo_level and a.dataset_id = p_dataset_id
    group by lm.district_code
  )
  select
    d.district_code,
    d.district_name,
    d.ordinal,
    d.is_lone,
    d.region_code,
    coalesce(ms.member_count, 0) as member_count,
    coalesce(ba.bhw_total, 0) as bhw_total,
    d.psa_population as population,
    case
      when coalesce(ms.member_count, 0) = 0 then 'no_members'
      when g.district_code is not null then 'has_unresolved'
      when ms.has_override then 'has_overrides'
      when ms.all_exact then 'all_exact'
      else 'resolved'
    end as match_quality
  from dim_legislative_district d
  left join member_stats ms on ms.district_code = d.district_code
  left join gap g on g.district_code = d.district_code
  left join bhw_agg ba on ba.district_code = d.district_code
  where d.status <> 'rejected'
  order by d.region_code nulls last, d.district_name;
$$;

grant execute on function district_index(bigint) to anon, authenticated;
