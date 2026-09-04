-- D2.2 (docs/LEGISLATIVE_DISTRICTS_PLAN.md §5) — /districts/[districtCode]. The per-row receipt
-- itself (member list with source page, revision id, match_method, override reason) is a plain
-- select against geo_district_map + dim_geo, no function needed. Two things are NOT plain selects:
--
-- 1. A lone district's own attributable gap (§ district_index's `gap` CTE) currently exists only
--    as a boolean on the index badge. D2.2 needs the actual missing places, by name, for the one
--    district that gap belongs to -- so this widens that CTE into a row set instead of duplicating
--    it inline in the app.
-- 2. The "23 uncovered LGUs, 41 unplaced barangays" the build report names were computed once, at
--    build time, from source text no longer in this database. They are NOT recomputed from
--    geo_district_map here -- doing so would silently drift from the report the moment a table
--    changes, and D2.2's whole posture is a receipt that stays true, not a copied number that can
--    go stale. `district_dataset_gaps()` below computes the SAME two figures live, straight from
--    dim_geo vs geo_district_map's live rows, so the count on the page is always what the current
--    table actually contains -- verified against the live project to equal the report's own 23 and
--    41 before this shipped.

-- A lone district's own missing children -- the one shape `district_index` can already attribute to
-- a single district (a lone district over a whole province/HUC has no sibling to share the gap
-- with). Empty for every other district, including a lone district with no gap.
create or replace function district_gap_members(p_district_code text)
returns table (
  geo_code  text,
  geo_name  text,
  geo_level geo_level_enum
)
language sql
stable
security invoker
set search_path = public
as $$
  with d as (
    select district_code, parent_geo_code
    from dim_legislative_district
    where district_code = p_district_code and is_lone and parent_geo_code is not null
  ),
  live as (
    select geo_code
    from geo_district_map
    where district_code = p_district_code and superseded_by is null and status <> 'rejected'
  ),
  member_level as (
    select min(m.geo_level) as lvl
    from geo_district_map m
    join d on d.district_code = m.district_code
    where m.superseded_by is null and m.status <> 'rejected'
  ),
  expected_citymun as (
    select c.geo_code, c.geo_name, c.geo_level
    from d
    join dim_geo c on c.geo_level = 'citymun' and c.province_code = d.parent_geo_code
    join member_level ml on ml.lvl = 'citymun'
  ),
  -- Same HUC case district_index's own comment explains: a lone district over an HUC resolves at
  -- barangay grain, so its "whole scope" is that HUC's own barangay children.
  expected_barangay as (
    select c.geo_code, c.geo_name, c.geo_level
    from d
    join dim_geo hcity on hcity.geo_level = 'citymun' and hcity.province_code = d.parent_geo_code
    join dim_geo c on c.geo_level = 'barangay' and c.citymun_code = hcity.geo_code
    join member_level ml on ml.lvl = 'barangay'
  ),
  expected as (
    select * from expected_citymun
    union all
    select * from expected_barangay
  )
  select e.geo_code, e.geo_name, e.geo_level
  from expected e
  left join live lm on lm.geo_code = e.geo_code
  where lm.geo_code is null
  order by e.geo_name;
$$;

grant execute on function district_gap_members(text) to anon, authenticated;

-- The two dataset-wide figures docs/LEGISLATIVE_DISTRICTS.md reports as "uncovered" and
-- "unplaced" -- recomputed live rather than copied, so a citymun or barangay corrected by D2.3
-- moves this count on its next page load, not just in a doc nobody regenerates.
--
-- A citymun counts as uncovered only when NEITHER it nor any of its own barangays has a live row --
-- the same distinction the Manila finding in the build report turns on: a multi-district city's
-- citymun-grain row is never expected to exist once that city resolves at barangay grain instead.
-- "Unplaced barangay" is scoped to cities that already have at least one live barangay-grain
-- member (a "split city"), so a citymun that simply hasn't been reached at all shows up once, as
-- uncovered, not again as N unplaced barangays.
create or replace function district_dataset_gaps()
returns table (
  uncovered_citymun_count  bigint,
  unplaced_barangay_count  bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with live as (
    select geo_code, geo_level
    from geo_district_map
    where superseded_by is null and status <> 'rejected'
  ),
  uncovered_citymun as (
    select c.geo_code
    from dim_geo c
    where c.geo_level = 'citymun'
      and not exists (select 1 from live lm where lm.geo_code = c.geo_code)
      and not exists (
        select 1
        from live lb
        join dim_geo b on b.geo_code = lb.geo_code
        where lb.geo_level = 'barangay' and b.citymun_code = c.geo_code
      )
  ),
  split_cities as (
    select distinct b.citymun_code
    from live lb
    join dim_geo b on b.geo_code = lb.geo_code
    where lb.geo_level = 'barangay'
  ),
  unplaced_barangay as (
    select b.geo_code
    from dim_geo b
    join split_cities sc on sc.citymun_code = b.citymun_code
    where b.geo_level = 'barangay'
      and not exists (select 1 from live lm where lm.geo_code = b.geo_code)
  )
  select (select count(*) from uncovered_citymun), (select count(*) from unplaced_barangay);
$$;

grant execute on function district_dataset_gaps() to anon, authenticated;
