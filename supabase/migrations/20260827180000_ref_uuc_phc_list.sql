-- UUC for PHC 2025 — the list as rows, one relation (docs/UUC_PHC_2025_PLAN.md U11).
--
-- U4 published a one-page PNG and deliberately left the indicator values off it: a picture has
-- nowhere to carry the † marker a bounded value needs, and reproducing 886 Water readings that
-- read as exactly 100% without saying they are ceilings is the unmarked artefact U3 was built to
-- avoid. **A spreadsheet can carry the marker.** So U11 publishes the rows — with
-- `capped_indicators` as a column of its own — and this view is the row.
--
-- It is a join, not a computation. `fact_uuc_phc_barangay` is the *record* (which barangays are on
-- the list, and the names the workbook supplied) and `fact_uuc_phc_indicators` is the *evidence*
-- (what each was assessed on); U1 kept them apart on purpose. The export is the first thing in the
-- build that needs both on one line, together with the geography resolved, so the join is named
-- once here rather than assembled in the read layer.
--
-- **Why a relation at all, rather than two reads joined in TypeScript.** A national export is 5,987
-- barangays, and neither fact table carries an ancestor code — scoping either one to a region means
-- naming its barangays, which at national grain is 41,958 identifiers in a URL. `dim_geo`'s
-- denormalized `region_code` / `province_code` / `citymun_code` are what make "every listed
-- barangay under this area" a single indexed predicate, and this view is where they meet the facts.
-- The same gap closes for the internal assistant: `queryDataset` performs no joins at all, so until
-- now no registered relation could answer "the listed barangays of this province, with their
-- values" — `fact_uuc_phc_indicators` has a `geo_code` and nothing above it.
--
-- **A view, not a table**, on `ref_uuc_phc_quality`'s precedent (U10): it recomputes on every read,
-- so it cannot go stale against the two fact tables beneath it, and staleness is the failure that
-- matters for a file somebody downloads and works from. `security_invoker = true` on
-- `ref_uuc_phc_provincial`'s precedent (U5): both fact tables and `dim_geo` are public-read, and
-- their own policies decide access rather than this view's owner.
--
-- **Display names come from `dim_geo`; the four `source_*` names are provenance.** That is the rule
-- `fact_uuc_phc_barangay`'s own header sets, and an export is exactly where it would otherwise be
-- broken — the workbook's names are the ones a spreadsheet user would reach for first. Both are
-- here, and the column dictionary says which is which.
create or replace view ref_uuc_phc_list
with (security_invoker = true) as
select
  b.dataset_id,

  -- Geography, resolved. `geo_code` is dim_geo's; `source_geo_code` is the workbook's, and they
  -- differ for Sulu's 87 barangays (source '09066…' under Region IX, dim_geo '19066…' under
  -- BARMM). Both travel, so a downloaded file can be joined back to either side.
  b.geo_code,
  g.geo_name,
  g.citymun_code,
  cm.geo_name as citymun_name,
  g.province_code,
  pr.geo_name as province_name,
  g.region_code,
  rg.geo_name as region_name,
  b.source_geo_code,
  b.source_region,
  b.source_province,
  b.source_citymun,
  b.source_barangay,

  -- The four qualifying routes of DOH AO No. 2020-0023 §VI.A, per barangay.
  --
  -- **These are the same four expressions `agg_uuc_phc_criteria` sums (U7), written a second time
  -- — and the assertion at the foot of this file is what stops one being edited alone.** The
  -- aggregate counts them per area; an export needs them per row, and there is no way to get one
  -- from the other. So they are asserted to roll up to it exactly, on every one of its 1,788 geo
  -- rows and all five measures, and a disagreement aborts the migration.
  --
  -- The physical factor is not a route: it holds in every row by construction, since a
  -- barangay below the AO's 25% floor never entered the list. Its measured value is a column below.
  (coalesce(i.ip_pop, 0) >= 10) as route_ip,
  -- Criterion (b) is the summed conflict/displacement test OR the ELCAC designation. Summed, not
  -- the order's "or": that is what reproduces the source's own Pass/Fail on every row it scored, and
  -- an either-alone reading disagrees on 15. See docs/UUC_PHC_2025_PLAN.md §1a.
  ((coalesce(i.armed_conf, 0) + coalesce(i.idp, 0) >= 10)
     or coalesce(i.elcac_brgy, false)) as route_conflict,
  (coalesce(i.four_ps, 0) >= 50) as route_four_ps,
  -- Whether criterion (d) can be evaluated here at all: the largest of this barangay's seven
  -- provincial benchmarks exists and is above 1. 226 barangays in 5 provinces fail this — every
  -- reference a placeholder 1, a zero-fill, a fraction or absent — and for them route (d) is not
  -- "false", it is not asked. An export that shipped `route_health = false` for those rows would
  -- assert they were tested and passed nothing.
  coalesce(greatest(i.imr_prov_ref, i.ufmr_prov_ref, i.fic_prov_ref, i.abr_prov_ref,
                    i.pre_natal_prov_ref, i.sba_prov_ref, i.water_prov_ref) > 1,
           false) as health_evaluable,
  coalesce(greatest(i.imr_prov_ref, i.ufmr_prov_ref, i.fic_prov_ref, i.abr_prov_ref,
                    i.pre_natal_prov_ref, i.sba_prov_ref, i.water_prov_ref) > 1
             and i.health_indicators >= 4,
           false) as route_health,

  -- The 12 measured indicators, then the ELCAC flag, exactly as loaded.
  i.physical_factor,
  i.ip_pop,
  i.armed_conf,
  i.idp,
  i.four_ps,
  i.elcac_brgy,
  i.imr,
  i.ufmr,
  i.fic,
  i.abr,
  i.pre_natal,
  i.sba,
  i.water,

  -- The seven provincial benchmarks criterion (d) compares against. Never capped — which is why
  -- FIC's reference reads above 100 in two provinces while every barangay FIC was bounded to it.
  i.imr_prov_ref,
  i.ufmr_prov_ref,
  i.fic_prov_ref,
  i.abr_prov_ref,
  i.pre_natal_prov_ref,
  i.sba_prov_ref,
  i.water_prov_ref,

  -- The source office's own criterion (d) score, loaded and never recomputed.
  i.health_indicators,

  -- **The column this increment exists for.** Which of this barangay's values were bounded during
  -- cleaning, by column name: a bounded value is a ceiling the source overshot, not a measurement,
  -- and once bounded it is indistinguishable from a genuine one. 1,584 values across 1,397
  -- barangays. Empty array where nothing was bounded — never null, so a spreadsheet reads a blank
  -- cell as "nothing bounded here" rather than as "not known".
  i.capped_indicators

from fact_uuc_phc_barangay b
-- Inner join: every listed barangay has an indicator row and vice versa (asserted below). An
-- outer join would quietly publish a row of empty measurements as if it were a measured zero.
join fact_uuc_phc_indicators i
  on i.geo_code = b.geo_code and i.dataset_id = b.dataset_id
join dim_geo g on g.geo_code = b.geo_code
left join dim_geo cm on cm.geo_code = g.citymun_code
left join dim_geo pr on pr.geo_code = g.province_code
left join dim_geo rg on rg.geo_code = g.region_code;

comment on view ref_uuc_phc_list is
  'The 2025 UUC for PHC list as rows: one row per listed barangay with its geography resolved, the four qualifying routes, the 12 indicators, the 7 provincial benchmarks and capped_indicators. Joins fact_uuc_phc_barangay to fact_uuc_phc_indicators; security_invoker. capped_indicators names the values bounded during cleaning — read it before quoting any of the seven boundable indicators. See docs/UUC_PHC_2025_PLAN.md §9 U11.';

comment on column ref_uuc_phc_list.capped_indicators is
  'Which of this barangay''s indicators were bounded during cleaning, by column name. A named value is a ceiling the source overshot, not a measurement: 886 Water and 456 FIC readings now read as exactly 100% because of it. Empty array where nothing was bounded.';

comment on column ref_uuc_phc_list.health_evaluable is
  'Whether criterion (d) can be evaluated for this barangay at all. False for 226 barangays in 5 provinces whose provincial benchmarks are placeholders, zeroes, fractions or absent — for them route_health is not a failed test, it is a test that was not asked.';

-- ---------------------------------------------------------------------------------------------
-- Assert, after creation, what a downloaded file depends on. A failure aborts the migration
-- rather than publishing a wrong export — and unlike a page, a spreadsheet leaves the building.
do $$
declare
  n_rows integer;
  n_bad integer;
  n_capped integer;
begin
  -- 1. The view is the list, whole and once. Anything other than 5,987 distinct barangays means
  --    the join dropped or duplicated rows, and a short export is worse than a failed one when
  --    5,987 is the headline figure.
  select count(*), count(distinct geo_code) into n_rows, n_bad from ref_uuc_phc_list;
  if n_rows <> (select count(*) from fact_uuc_phc_barangay) then
    raise exception 'ref_uuc_phc_list has % rows against fact_uuc_phc_barangay''s %',
      n_rows, (select count(*) from fact_uuc_phc_barangay);
  end if;
  if n_bad <> n_rows then
    raise exception 'ref_uuc_phc_list carries % rows for % distinct barangays', n_rows, n_bad;
  end if;

  -- 2. Every row can be scoped. The export filters on exactly these three columns, so a null one
  --    is a barangay that would silently vanish from its own region's file.
  select count(*) into n_bad from ref_uuc_phc_list
   where citymun_code is null or province_code is null or region_code is null
      or geo_name is null or citymun_name is null or province_name is null or region_name is null;
  if n_bad > 0 then
    raise exception '% ref_uuc_phc_list row(s) cannot be scoped or named from dim_geo', n_bad;
  end if;

  -- 3. **Every area's export is exactly the count that area's page prints.** For all 1,788 geos of
  --    agg_uuc_phc_counts, the rows this view yields under that geo equal n_listed. This is what
  --    makes "a city/municipality export matches that page's barangay list" true by construction
  --    rather than by inspection, at every level at once.
  select count(*) into n_bad
  from agg_uuc_phc_counts c
  where c.n_listed <> (
    select count(*) from ref_uuc_phc_list l
    where l.dataset_id = c.dataset_id
      and case c.geo_level
            when 'national' then true
            when 'region'   then l.region_code = c.geo_code
            when 'province' then l.province_code = c.geo_code
            when 'citymun'  then l.citymun_code = c.geo_code
          end
  );
  if n_bad > 0 then
    raise exception '% geo(s) where ref_uuc_phc_list disagrees with agg_uuc_phc_counts.n_listed', n_bad;
  end if;

  -- 4. The four route flags and the evaluability test roll up to agg_uuc_phc_criteria exactly, on
  --    every geo and all five measures. They are the same rules written twice — once summed there
  --    (U7), once per row here, because an export needs the row — so this is the assertion that
  --    stops one copy being edited without the other.
  select count(*) into n_bad
  from agg_uuc_phc_criteria a
  where (a.n_route_ip, a.n_route_conflict, a.n_route_four_ps, a.n_route_health, a.n_health_evaluable)
     is distinct from (
    select (
      count(*) filter (where l.route_ip)::int,
      count(*) filter (where l.route_conflict)::int,
      count(*) filter (where l.route_four_ps)::int,
      count(*) filter (where l.route_health)::int,
      count(*) filter (where l.health_evaluable)::int
    )
    from ref_uuc_phc_list l
    where l.dataset_id = a.dataset_id
      and case a.geo_level
            when 'national' then true
            when 'region'   then l.region_code = a.geo_code
            when 'province' then l.province_code = a.geo_code
            when 'citymun'  then l.citymun_code = a.geo_code
          end
  );
  if n_bad > 0 then
    raise exception '% geo(s) where ref_uuc_phc_list route flags disagree with agg_uuc_phc_criteria', n_bad;
  end if;

  -- 5. The capping marker survives the join. The whole justification for this increment is that a
  --    spreadsheet can carry what U4's PNG could not, so the count of barangays carrying one must
  --    match what the data-quality page computes (U10) — 1,397, not the 1,584 values.
  select count(*) into n_capped from ref_uuc_phc_list where cardinality(capped_indicators) > 0;
  if n_capped <> (select n_barangays_capped from ref_uuc_phc_quality) then
    raise exception 'ref_uuc_phc_list marks % barangays capped against ref_uuc_phc_quality''s %',
      n_capped, (select n_barangays_capped from ref_uuc_phc_quality);
  end if;
  -- Never null: a null array would read in a spreadsheet as "not known" where the truth is
  -- "nothing was bounded", which is the one confusion this column exists to remove.
  select count(*) into n_bad from ref_uuc_phc_list where capped_indicators is null;
  if n_bad > 0 then
    raise exception '% ref_uuc_phc_list row(s) carry a null capped_indicators', n_bad;
  end if;
end $$;
