-- Facility counts by type per area (plan N2) — the long-form companion to agg_nhfr_counts.
--
-- Grain: (dataset_id, geo_code, geo_level, facility_type), national / region / province /
-- citymun. agg_nhfr_counts carries the four headline types as columns because the section leads
-- with them; this table carries all 45 so the breakdown table and its ordering are a query rather
-- than 45 more columns.
--
-- **Sparse by design: a row exists only where the count is non-zero.** This is the one place the
-- "a zero is data" rule from agg_nhfr_counts does not apply, and the reason is the shape. There
-- 1,788 areas × 1 row means an absent row is ambiguous, so zeros are stored. Here a dense table
-- would be 1,788 × 45 = 80,460 rows to say "no, this town has no COVID-19 testing laboratory"
-- 45 times over for every town. The reader's question at this grain is "what is here", not "which
-- of the 45 national categories is absent here", and the denominator for any share is
-- agg_nhfr_counts.n_facilities, which is always present. A caller listing types for an area with
-- no facilities gets an empty list, and agg_nhfr_counts tells it that area has 0 — the two read
-- together are unambiguous.
--
-- Computed in SQL from the fact table and idempotent, like every other aggregate here:
-- re-running this file recomputes it.
create table if not exists agg_nhfr_by_type (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,

  -- The source's own vocabulary, unmapped. 45 values, e.g. 'Barangay Health Station',
  -- 'Clinical Laboratory', 'Rural Health Unit'. Not an enum: NHFR is a live registry and adds
  -- types, and a new one should widen a breakdown table rather than fail a load.
  facility_type text not null,

  -- `facility_major_type` is deliberately NOT carried here, and the reason is a finding rather
  -- than a simplification. It looks like a property of the type, but it is not: 13 of the 45
  -- types appear under BOTH 'Health Facility' and 'Health Related Facility', and lopsidedly so —
  -- Rural Health Unit is 2,744 against 1, Birthing Home 3,562 against 3, Clinical Laboratory
  -- 4,346 against 3. Those are per-facility encoding inconsistencies in the source, so grouping
  -- by it here would either split one type across two rows or label a whole type from its
  -- majority value. It stays on fact_nhfr_facility, where it describes the facility it belongs to.

  n_facilities integer not null,
  n_government integer not null default 0,
  n_private integer not null default 0,

  unique (dataset_id, geo_code, geo_level, facility_type)
);

create index if not exists agg_nhfr_by_type_geo_idx on agg_nhfr_by_type (geo_code, geo_level);
create index if not exists agg_nhfr_by_type_type_idx
  on agg_nhfr_by_type (dataset_id, geo_level, facility_type);

comment on table agg_nhfr_by_type is
  'Facility counts by facility type per area from the NHFR September 2026 snapshot. Sparse: a row exists only where the count is non-zero — read the area total from agg_nhfr_counts. See docs/NHFR_2026_PLAN.md.';

alter table agg_nhfr_by_type enable row level security;

drop policy if exists "agg_nhfr_by_type public read" on agg_nhfr_by_type;
create policy "agg_nhfr_by_type public read" on agg_nhfr_by_type
  for select
  to anon, authenticated
  using (true);

-- Populate. Idempotent, and deletes first so a facility type that disappears from the source on a
-- re-load does not leave a stale row behind — an upsert alone cannot remove rows, and a lingering
-- "3 dialysis clinics" for a town that no longer has any is exactly the kind of quiet wrongness
-- this dataset must not publish.
delete from agg_nhfr_by_type
 where dataset_id = (select dataset_id from dim_dataset where slug = 'nhfr-2026-09');

with ds as (
  select dataset_id from dim_dataset where slug = 'nhfr-2026-09'
),
fac as (
  select
    f.geo_code as citymun_code,
    g.province_code,
    g.region_code,
    f.facility_type,
    f.ownership_major
  from fact_nhfr_facility f
  join dim_geo g on g.geo_code = f.geo_code
  where f.dataset_id = (select dataset_id from ds)
),
rolled as (
  select 'PH' as geo_code, 'national'::geo_level_enum as geo_level,
         facility_type,
         count(*)::int as n_facilities,
         count(*) filter (where ownership_major = 'Government')::int as n_government,
         count(*) filter (where ownership_major = 'Private')::int as n_private
    from fac group by facility_type
  union all
  select region_code, 'region'::geo_level_enum,
         facility_type,
         count(*)::int,
         count(*) filter (where ownership_major = 'Government')::int,
         count(*) filter (where ownership_major = 'Private')::int
    from fac group by region_code, facility_type
  union all
  select province_code, 'province'::geo_level_enum,
         facility_type,
         count(*)::int,
         count(*) filter (where ownership_major = 'Government')::int,
         count(*) filter (where ownership_major = 'Private')::int
    from fac group by province_code, facility_type
  union all
  select citymun_code, 'citymun'::geo_level_enum,
         facility_type,
         count(*)::int,
         count(*) filter (where ownership_major = 'Government')::int,
         count(*) filter (where ownership_major = 'Private')::int
    from fac group by citymun_code, facility_type
)
insert into agg_nhfr_by_type (
  dataset_id, geo_code, geo_level, facility_type,
  n_facilities, n_government, n_private
)
select (select dataset_id from ds), r.*
from rolled r
on conflict (dataset_id, geo_code, geo_level, facility_type) do update set
  n_facilities = excluded.n_facilities,
  n_government = excluded.n_government,
  n_private = excluded.n_private;

-- Assert this table and agg_nhfr_counts tell the same story. They are computed from the same
-- fact table by different paths, so a disagreement means one of the two rollups is wrong — and
-- the section renders both on the same page.
do $$
declare
  v_mismatch int;
begin
  select count(*) into v_mismatch
    from agg_nhfr_counts c
    left join (
      select dataset_id, geo_code, geo_level, sum(n_facilities)::int as n
        from agg_nhfr_by_type
       where dataset_id = (select dataset_id from dim_dataset where slug = 'nhfr-2026-09')
       group by dataset_id, geo_code, geo_level
    ) t
      on t.dataset_id = c.dataset_id
     and t.geo_code = c.geo_code
     and t.geo_level = c.geo_level
   where c.dataset_id = (select dataset_id from dim_dataset where slug = 'nhfr-2026-09')
     and coalesce(t.n, 0) <> c.n_facilities;

  if v_mismatch > 0 then
    raise exception
      '% areas where agg_nhfr_by_type does not sum to agg_nhfr_counts.n_facilities', v_mismatch;
  end if;
end $$;
