-- Align the 2025 UUC for PHC dataset to the source office's final list (5,991 -> 5,987).
--
-- **What changed, and why it is a membership change rather than a data change.** Everything in
-- this dataset was built from `ingestion/data/GIDA reconciled data.xlsx`, whose `NEW` sheet
-- classifies 5,991 barangays `UUA`. The source office has since supplied the final national list,
-- "2025 UUC FOR PHC LIST" — the same list whose regional distribution the 2027 Budget Cue Cards
-- p37 publishes — and it carries 5,987. The two disagree on six barangays and on nothing else:
-- the remaining 5,986 match name for name across all 17 regions.
--
--   Removed (5)   CAVITE / CITY OF BACOOR / MOLINO IV, SAN NICOLAS II, TALABA 2, TALABA 3
--                 CAVITE / CITY OF CAVITE / BARANGAY 38
--   Added (1)     BASILAN / SUMISIP / SUMISIP CENTRAL  (PSGC 1900705019)
--
-- That is exactly the delta `ref_uuc_phc_published_delta` has been reporting since U10: BARMM
-- 399 -> 400 and CALABARZON 200 -> 195, a national +4 that closes to zero. **So this migration
-- empties that table** — every geography now agrees with p37 — and the reconciliation the
-- methodology page carried becomes a settled question rather than an open one.
--
-- **It also settles the vintage reading, in the opposite direction to the one plan §3 inferred.**
-- §3 reasoned from the file name `Submissions_UUA_2025_filled_1` that the workbook was the later
-- revision and p37 the older snapshot, and the owner's decision followed from that: publish 5,991,
-- footnote 5,987. The final list is dated later than both and lands on p37's figures by making
-- precisely the two corrections p37 implies, so the inference ran backwards. 5,991 is the
-- pre-correction submission; 5,987 is the list as issued. Recorded in docs/DECISIONS.md.
--
-- **Where the added barangay's numbers come from, and the one caveat that carries.** The
-- reconciled workbook has no row for SUMISIP CENTRAL at all — `NEW` scores it `NOT UUA`, which is
-- why it never entered this pipeline. The same workbook's `2025 LIST` sheet does have it, with a
-- complete set of indicator values under PSGC 1900705019, so the row is recovered rather than
-- invented. But `2025 LIST` is a *pre-reconciliation* extract: it disagrees with the reconciled
-- sheet somewhere on 473 of the 5,989 barangays they share. This one row is therefore of a
-- different vintage to the other 5,986, and two of its columns have no counterpart there at all:
--
--   elcac_brgy         NULL. Criterion (b) for this row rests on armed_conf + idp alone
--                      (30 + 11 = 41), which passes without it.
--   health_indicators  NULL. The source office's own criterion (d) score, which this pipeline
--                      loads and never recomputes (see the column note in
--                      20260826150000_fact_uuc_phc_indicators.sql). Route (d) therefore does not
--                      count this barangay. Its listing does not depend on that: ip_pop is 100,
--                      so criterion (a) carries it alone.
--
-- **Idempotent, and it converges from either state.** A database already seeded at 5,991 is
-- brought to 5,987 by this file. A fresh replay gets 5,987 from the regenerated seeds
-- (20260826121300 / 20260826150100, both rebuilt from the realigned extract) and every statement
-- below is then a no-op. Re-running is safe in both cases.
--
-- The aggregate rebuilds in sections 3-7 are the populate blocks of the migrations that own those
-- tables, re-executed verbatim — which is the refresh procedure each of them documents. They are
-- copied rather than referenced because a migration is a point-in-time script: this is what those
-- blocks said when this change was applied.

-- ---------------------------------------------------------------------------------------------
-- 1. The five barangays the final list omits.
--
-- Indicators first: fact_uuc_phc_indicators has no FK to fact_uuc_phc_barangay, but the criteria
-- aggregate asserts the two tables cover the same barangays, so they must never be left apart.
-- None of the five is a Sulu code, so geo_code is the source code unchanged.
delete from fact_uuc_phc_indicators
where dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  and geo_code in ('0402103047', '0402103064', '0402103066', '0402103091', '0402105032');

delete from fact_uuc_phc_barangay
where dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  and geo_code in ('0402103047', '0402103064', '0402103066', '0402103091', '0402105032');

-- ---------------------------------------------------------------------------------------------
-- 2. The one barangay the final list adds.
--
-- Written the way the seeds write it — through map_psgc_to_dim_geo() rather than as a literal
-- geo_code — so this file resolves geography by the same rule as every other row in the table.
with ds as (
  select dataset_id from dim_dataset where slug = 'uuc-phc-2025'
)
insert into fact_uuc_phc_barangay (
  dataset_id, geo_code, source_geo_code,
  source_region, source_province, source_citymun, source_barangay
)
select
  (select dataset_id from ds),
  map_psgc_to_dim_geo('1900705019', 'post-2024 Sulu transfer (Sulu under Region IX)'),
  '1900705019',
  'BANGSAMORO AUTONOMOUS REGION IN MUSLIM MINDANAO (BARMM)', 'BASILAN', 'SUMISIP', 'SUMISIP CENTRAL'
on conflict (dataset_id, geo_code) do update set
  source_geo_code = excluded.source_geo_code,
  source_region = excluded.source_region,
  source_province = excluded.source_province,
  source_citymun = excluded.source_citymun,
  source_barangay = excluded.source_barangay;

-- The twelve indicator values come from the `2025 LIST` sheet (see the header). The seven
-- provincial benchmarks are NOT from there — that sheet has none — they are Basilan's own, the
-- same constants its other 36 listed barangays carry, which is what keeps ref_uuc_phc_provincial's
-- one-value-per-province assertion true. capped_indicators is empty: every value is in range.
with ds as (
  select dataset_id from dim_dataset where slug = 'uuc-phc-2025'
)
insert into fact_uuc_phc_indicators (
  dataset_id, geo_code,
  physical_factor, ip_pop, armed_conf, idp, four_ps, elcac_brgy,
  imr, ufmr, fic, abr, pre_natal, sba, water,
  imr_prov_ref, ufmr_prov_ref, fic_prov_ref, abr_prov_ref,
  pre_natal_prov_ref, sba_prov_ref, water_prov_ref,
  health_indicators, capped_indicators
)
select
  (select dataset_id from ds),
  map_psgc_to_dim_geo('1900705019', 'post-2024 Sulu transfer (Sulu under Region IX)'),
  83.0, 100.0, 30.0, 11.0, 42.0, null,
  0.0, 0.0, 63.0, 14.7, 63.0, 52.9, 66.67,
  12.21, 14.01, 31.01, 15.11, 58.78, 57.89, 77.54,
  null, '{}'::text[]
on conflict (dataset_id, geo_code) do update set
  physical_factor = excluded.physical_factor,
  ip_pop = excluded.ip_pop,
  armed_conf = excluded.armed_conf,
  idp = excluded.idp,
  four_ps = excluded.four_ps,
  elcac_brgy = excluded.elcac_brgy,
  imr = excluded.imr,
  ufmr = excluded.ufmr,
  fic = excluded.fic,
  abr = excluded.abr,
  pre_natal = excluded.pre_natal,
  sba = excluded.sba,
  water = excluded.water,
  imr_prov_ref = excluded.imr_prov_ref,
  ufmr_prov_ref = excluded.ufmr_prov_ref,
  fic_prov_ref = excluded.fic_prov_ref,
  abr_prov_ref = excluded.abr_prov_ref,
  pre_natal_prov_ref = excluded.pre_natal_prov_ref,
  sba_prov_ref = excluded.sba_prov_ref,
  water_prov_ref = excluded.water_prov_ref,
  health_indicators = excluded.health_indicators,
  capped_indicators = excluded.capped_indicators;

-- The membership change, asserted on the end state rather than on rows affected, so a re-run
-- checks the same thing a first run does.
do $$
declare
  ds_id bigint := (select dataset_id from dim_dataset where slug = 'uuc-phc-2025');
  n_list integer;
  n_ind integer;
  n_bad integer;
begin
  select count(*) into n_list from fact_uuc_phc_barangay where dataset_id = ds_id;
  if n_list <> 5987 then
    raise exception 'fact_uuc_phc_barangay holds % rows, expected 5,987', n_list;
  end if;

  select count(*) into n_ind from fact_uuc_phc_indicators where dataset_id = ds_id;
  if n_ind <> 5987 then
    raise exception 'fact_uuc_phc_indicators holds % rows, expected 5,987', n_ind;
  end if;

  -- The two tables must cover the same barangays. agg_uuc_phc_criteria asserts this indirectly
  -- through its denominator; stated here so a failure names the cause rather than a row count.
  select count(*) into n_bad
  from fact_uuc_phc_barangay b
  left join fact_uuc_phc_indicators i
    on i.dataset_id = b.dataset_id and i.geo_code = b.geo_code
  where b.dataset_id = ds_id and i.geo_code is null;
  if n_bad > 0 then
    raise exception '% listed barangay(s) have no indicator row', n_bad;
  end if;

  select count(*) into n_bad
  from fact_uuc_phc_barangay
  where dataset_id = ds_id
    and geo_code in ('0402103047', '0402103064', '0402103066', '0402103091', '0402105032');
  if n_bad > 0 then
    raise exception '% of the 5 delisted Cavite barangay(s) are still on the list', n_bad;
  end if;

  select count(*) into n_bad
  from fact_uuc_phc_barangay where dataset_id = ds_id and geo_code = '1900705019';
  if n_bad <> 1 then
    raise exception 'SUMISIP CENTRAL (1900705019) is not on the list';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Comments that quote the old total.
comment on table fact_uuc_phc_barangay is
  'The 5,987 barangays on the 2025 Unserved and Underserved Communities for Primary Health Care list (DC No. 2025-0549; criteria per DOH AO No. 2020-0023). Presence = listed. See docs/UUC_PHC_2025_PLAN.md.';


-- =============================================================================================
-- 3. Rebuild agg_uuc_phc_counts — the listed/total counts every page reads.
--
-- Re-executed verbatim from supabase/migrations/20260826140000_agg_uuc_phc_counts.sql.
-- =============================================================================================

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

-- =============================================================================================
-- 4. Rebuild agg_uuc_phc_criteria — the four qualifying routes and route (d)'s denominator.
--
-- Re-executed verbatim from supabase/migrations/20260827100000_agg_uuc_phc_criteria.sql.
-- =============================================================================================

-- Populate. Idempotent: recomputes and upserts every row, so re-running after a fact reload is
-- the refresh procedure. The (dataset_id, geo_code, geo_level) unique key makes every row a
-- stable target, so nothing is deleted.
--
-- A row exists for every geo, including those with nothing listed — U2's decision, for U2's
-- reason: omitting them would render "0 of this area's barangays qualified on any route" as
-- "no data", and NCR's zero is a result rather than a gap.
with ds as (
  select dataset_id from dim_dataset where slug = 'uuc-phc-2025'
),
brgy as (
  -- One row per barangay in the country, carrying its route flags where it is listed and zeroes
  -- where it is not. A LEFT JOIN, not an inner one: the zero rows are the point.
  select
    g.citymun_code,
    g.province_code,
    g.region_code,
    (i.geo_code is not null)::int as listed,
    (coalesce(i.ip_pop, 0) >= 10)::int as route_ip,
    -- Criterion (b) is the union of the summed conflict/displacement test and the ELCAC
    -- designation. Nulls read as 0 in the sum, which cannot manufacture a pass: a pass needs 10.
    ((coalesce(i.armed_conf, 0) + coalesce(i.idp, 0) >= 10)
       or coalesce(i.elcac_brgy, false))::int as route_conflict,
    (coalesce(i.four_ps, 0) >= 50)::int as route_four_ps,
    -- Evaluable: the largest of this barangay's seven benchmarks exists and is above 1. greatest()
    -- ignores nulls, so it is null only when the source supplied none of the seven — and the
    -- comparison is then null too, which coalesce resolves to false. That also covers the
    -- barangays this LEFT JOIN found nothing for: not listed is not evaluable.
    coalesce(greatest(i.imr_prov_ref, i.ufmr_prov_ref, i.fic_prov_ref, i.abr_prov_ref,
                      i.pre_natal_prov_ref, i.sba_prov_ref, i.water_prov_ref) > 1,
             false)::int as evaluable,
    coalesce(greatest(i.imr_prov_ref, i.ufmr_prov_ref, i.fic_prov_ref, i.abr_prov_ref,
                      i.pre_natal_prov_ref, i.sba_prov_ref, i.water_prov_ref) > 1
               and i.health_indicators >= 4,
             false)::int as route_health
  from dim_geo g
  left join fact_uuc_phc_indicators i
    on i.geo_code = g.geo_code
   and i.dataset_id = (select dataset_id from ds)
  where g.geo_level = 'barangay'
),
rolled as (
  select 'PH' as geo_code, 'national'::geo_level_enum as geo_level,
         sum(listed)::int as n_listed,
         sum(route_ip)::int as n_route_ip,
         sum(route_conflict)::int as n_route_conflict,
         sum(route_four_ps)::int as n_route_four_ps,
         sum(route_health)::int as n_route_health,
         sum(evaluable)::int as n_health_evaluable
    from brgy
  union all
  select region_code, 'region'::geo_level_enum, sum(listed)::int, sum(route_ip)::int,
         sum(route_conflict)::int, sum(route_four_ps)::int, sum(route_health)::int,
         sum(evaluable)::int
    from brgy group by region_code
  union all
  select province_code, 'province'::geo_level_enum, sum(listed)::int, sum(route_ip)::int,
         sum(route_conflict)::int, sum(route_four_ps)::int, sum(route_health)::int,
         sum(evaluable)::int
    from brgy group by province_code
  union all
  select citymun_code, 'citymun'::geo_level_enum, sum(listed)::int, sum(route_ip)::int,
         sum(route_conflict)::int, sum(route_four_ps)::int, sum(route_health)::int,
         sum(evaluable)::int
    from brgy group by citymun_code
)
insert into agg_uuc_phc_criteria (
  dataset_id, geo_code, geo_level, n_listed,
  n_route_ip, n_route_conflict, n_route_four_ps, n_route_health, n_health_evaluable
)
select (select dataset_id from ds), r.geo_code, r.geo_level, r.n_listed,
       r.n_route_ip, r.n_route_conflict, r.n_route_four_ps, r.n_route_health, r.n_health_evaluable
from rolled r
on conflict (dataset_id, geo_code, geo_level) do update set
  n_listed = excluded.n_listed,
  n_route_ip = excluded.n_route_ip,
  n_route_conflict = excluded.n_route_conflict,
  n_route_four_ps = excluded.n_route_four_ps,
  n_route_health = excluded.n_route_health,
  n_health_evaluable = excluded.n_health_evaluable;

-- ---------------------------------------------------------------------------------------------
-- Assert, after loading, the invariants the page depends on. Each of these is cheap and each has
-- a way of being violated silently by a future edit, which is the test for whether an assertion
-- earns its place. A failure aborts the migration rather than publishing a wrong share.
do $$
declare
  n_bad integer;
begin
  -- 1. This table's denominator must be the one agg_uuc_phc_counts publishes. They are computed
  --    from different fact tables (classification vs. indicators), so agreement is a real check
  --    that every listed barangay has an indicator row and vice versa.
  select count(*) into n_bad
  from agg_uuc_phc_criteria c
  join agg_uuc_phc_counts n
    on n.dataset_id = c.dataset_id and n.geo_code = c.geo_code and n.geo_level = c.geo_level
  where n.n_listed <> c.n_listed;
  if n_bad > 0 then
    raise exception 'agg_uuc_phc_criteria.n_listed disagrees with agg_uuc_phc_counts on % row(s)', n_bad;
  end if;

  select count(*) into n_bad
  from agg_uuc_phc_criteria c
  left join agg_uuc_phc_counts n
    on n.dataset_id = c.dataset_id and n.geo_code = c.geo_code and n.geo_level = c.geo_level
  where n.geo_code is null;
  if n_bad > 0 then
    raise exception '% criteria row(s) have no matching agg_uuc_phc_counts row', n_bad;
  end if;

  -- 2. No route count may exceed the denominator it is a share of, and none may be negative.
  --    This is what makes the rendered percentages safe to draw on a 0–100% track.
  select count(*) into n_bad
  from agg_uuc_phc_criteria
  where n_route_ip > n_listed
     or n_route_conflict > n_listed
     or n_route_four_ps > n_listed
     or n_health_evaluable > n_listed
     or n_route_health > n_health_evaluable
     or least(n_route_ip, n_route_conflict, n_route_four_ps, n_route_health,
              n_health_evaluable, n_listed) < 0;
  if n_bad > 0 then
    raise exception '% row(s) have a route count outside its denominator', n_bad;
  end if;

  -- 3. Each level must roll up to the same national totals. A region/province/citymun that lost
  --    or double-counted a barangay shows up here and nowhere else.
  select count(*) into n_bad
  from (
    select geo_level, sum(n_listed) as l, sum(n_route_ip) as a, sum(n_route_conflict) as b,
           sum(n_route_four_ps) as c, sum(n_route_health) as d, sum(n_health_evaluable) as e
    from agg_uuc_phc_criteria
    group by geo_level
  ) t
  cross join (
    select n_listed as l, n_route_ip as a, n_route_conflict as b, n_route_four_ps as c,
           n_route_health as d, n_health_evaluable as e
    from agg_uuc_phc_criteria where geo_level = 'national'
  ) nat
  where t.l <> nat.l or t.a <> nat.a or t.b <> nat.b
     or t.c <> nat.c or t.d <> nat.d or t.e <> nat.e;
  if n_bad > 0 then
    raise exception '% level(s) do not roll up to the national totals', n_bad;
  end if;
end $$;

-- The two column comments that quoted the old totals. Nationally 5,761 of 5,987 barangays can now
-- support criterion (d); the 226 that cannot are unchanged by this alignment — the five removed
-- Cavite barangays all carried real benchmarks, and the added one carries Basilan's.
comment on column agg_uuc_phc_criteria.n_route_conflict is
  'Criterion (b): armed_conf + idp >= 10, or the barangay is ELCAC-designated. The two are summed rather than read as the order''s "or" — that is what reproduces the source''s own Pass/Fail on every row it scored. See docs/UUC_PHC_2025_PLAN.md §1a.';

comment on column agg_uuc_phc_criteria.n_health_evaluable is
  'Listed barangays in this area whose provincial reference can support criterion (d). Nationally 5,761 of 5,987: 226 barangays in 5 provinces carry benchmarks that are placeholders, zeroes, missing or fractions. n_listed - n_health_evaluable is the excluded count, derived in the read layer. One further barangay — SUMISIP CENTRAL, added by the final-list alignment — is counted evaluable, because Basilan''s benchmarks are real, but carries no recorded criterion (d) score of its own, so route (d) does not count it.';

-- =============================================================================================
-- 5. Rebuild agg_uuc_phc_indicator_dist — the per-indicator distributions and comparability.
--
-- Re-executed verbatim from supabase/migrations/20260827160000_agg_uuc_phc_indicator_dist.sql.
-- =============================================================================================

-- Populate. Idempotent: recomputes and upserts every row, so re-running after a fact reload is
-- the refresh procedure. The (dataset_id, geo_code, geo_level, indicator) unique key makes every
-- row a stable target, so nothing is deleted.
--
-- A row exists for every geo and every indicator, including areas with nothing listed — U2's
-- decision, for U2's reason: NCR's zero is a result, not a gap, and the page renders it as an
-- empty state rather than as an unavailable one.
with ds as (
  select dataset_id from dim_dataset where slug = 'uuc-phc-2025'
),
brgy as (
  -- One row per listed barangay, carrying the criterion (d) evaluability test once so all seven
  -- health indicators apply the same one. This is U7's rule verbatim: the largest of the seven
  -- benchmarks exists and is above 1. greatest() ignores nulls, so it is null only where the
  -- source supplied none of the seven, and the comparison is then null too. It selects exactly
  -- the 226 barangays in 5 provinces whose benchmarks are placeholders, zero-fills, missing or
  -- fractions — computed, never a hard-coded list of province codes, so a corrected extract makes
  -- the rule stop firing rather than makes it wrong.
  select
    i.*,
    coalesce(greatest(i.imr_prov_ref, i.ufmr_prov_ref, i.fic_prov_ref, i.abr_prov_ref,
                      i.pre_natal_prov_ref, i.sba_prov_ref, i.water_prov_ref) > 1,
             false) as evaluable
  from fact_uuc_phc_indicators i
  where i.dataset_id = (select dataset_id from ds)
),
val as (
  -- One row per (listed barangay, indicator). The lateral VALUES list is the single place the 12
  -- columns, their domains, their cap flags and criterion (d)'s direction are stated together —
  -- the alternative is twelve near-identical subqueries, which is twelve chances to pair a value
  -- with the wrong benchmark.
  select
    b.geo_code,
    v.indicator, v.val, v.capped, v.ref, v.mx, v.higher_is_worse,
    b.evaluable
  from brgy b
  cross join lateral (values
    -- Qualifying factors (AO §VI.A). No provincial benchmark: criterion (d) does not test these.
    ('physical_factor', b.physical_factor, false,                                 null::numeric, 100::numeric, null::boolean),
    ('ip_pop',          b.ip_pop,          false,                                 null,          100,          null),
    ('armed_conf',      b.armed_conf,      false,                                 null,          100,          null),
    ('idp',             b.idp,             false,                                 null,          100,          null),
    ('four_ps',         b.four_ps,         false,                                 null,          100,          null),
    -- Health indicators (criterion d). A higher rate is worse; a higher coverage is better.
    ('imr',             b.imr,             'imr'       = any(b.capped_indicators), b.imr_prov_ref,       1000, true),
    ('ufmr',            b.ufmr,            'ufmr'      = any(b.capped_indicators), b.ufmr_prov_ref,      1000, true),
    ('abr',             b.abr,             'abr'       = any(b.capped_indicators), b.abr_prov_ref,       1000, true),
    ('fic',             b.fic,             'fic'       = any(b.capped_indicators), b.fic_prov_ref,        100, false),
    ('pre_natal',       b.pre_natal,       'pre_natal' = any(b.capped_indicators), b.pre_natal_prov_ref,  100, false),
    ('sba',             b.sba,             'sba'       = any(b.capped_indicators), b.sba_prov_ref,        100, false),
    ('water',           b.water,           'water'     = any(b.capped_indicators), b.water_prov_ref,      100, false)
  ) as v(indicator, val, capped, ref, mx, higher_is_worse)
),
scored as (
  -- comparesWorse, in SQL. Kept identical to lib/db/uuc-phc-indicators.ts's function plus U7's
  -- placeholder rule, so the count on /uuc-phc/indicators and the verdict in one barangay's
  -- disclosure cannot say different things about the same barangay.
  select
    v.*,
    (v.evaluable and v.val is not null and v.ref is not null and v.ref <= v.mx) as comparable,
    (v.evaluable and v.val is not null and v.ref is not null and v.ref <= v.mx
      and case when v.higher_is_worse then v.val > v.ref else v.val < v.ref end) as worse,
    -- least(9, ...) closes the top bin inclusive; greatest(0, ...) is belt and braces — the
    -- cleaning report records zero negative values, and a future extract with one would land it
    -- in the first bin rather than outside the array.
    least(9, greatest(0, floor(v.val / (v.mx / 10.0))))::int as bin
  from val v
),
-- Each listed barangay contributes to its own four ancestor rows. Written once here rather than
-- as four near-identical group-bys, which is how a level quietly loses or double-counts one.
geo_map as (
  select g.geo_code as brgy_code, 'PH' as geo_code, 'national'::geo_level_enum as geo_level
    from dim_geo g where g.geo_level = 'barangay'
  union all
  select g.geo_code, g.region_code, 'region'::geo_level_enum
    from dim_geo g where g.geo_level = 'barangay'
  union all
  select g.geo_code, g.province_code, 'province'::geo_level_enum
    from dim_geo g where g.geo_level = 'barangay'
  union all
  select g.geo_code, g.citymun_code, 'citymun'::geo_level_enum
    from dim_geo g where g.geo_level = 'barangay'
),
binned as (
  select m.geo_code, m.geo_level, s.indicator, s.bin,
         count(*)::int as n,
         count(*) filter (where s.capped)::int as n_cap
  from scored s
  join geo_map m on m.brgy_code = s.geo_code
  where s.val is not null
  group by 1, 2, 3, 4
),
-- Every (geo, indicator, bin) that must exist, including the empty ones. Built from
-- agg_uuc_phc_counts because that is the table which already decides what "every geo" means.
scaffold as (
  select c.geo_code, c.geo_level, ind.indicator, ind.mx, s.bin
  from agg_uuc_phc_counts c
  cross join (values
    ('physical_factor', 100::numeric), ('ip_pop', 100), ('armed_conf', 100), ('idp', 100),
    ('four_ps', 100), ('imr', 1000), ('ufmr', 1000), ('abr', 1000), ('fic', 100),
    ('pre_natal', 100), ('sba', 100), ('water', 100)
  ) as ind(indicator, mx)
  cross join generate_series(0, 9) as s(bin)
  where c.dataset_id = (select dataset_id from ds)
),
arrays as (
  select s.geo_code, s.geo_level, s.indicator, s.mx,
         array_agg(coalesce(b.n, 0) order by s.bin) as bin_counts,
         array_agg(coalesce(b.n_cap, 0) order by s.bin) as bin_capped
  from scaffold s
  left join binned b
    on b.geo_code = s.geo_code and b.geo_level = s.geo_level
   and b.indicator = s.indicator and b.bin = s.bin
  group by 1, 2, 3, 4
),
scalars as (
  select m.geo_code, m.geo_level, s.indicator,
         count(*)::int as n_listed,
         count(*) filter (where s.val is null)::int as n_missing,
         count(*) filter (where s.comparable)::int as n_comparable,
         count(*) filter (where s.worse)::int as n_worse,
         -- The province's benchmark, taken from the area's own listed barangays. Unambiguous
         -- below region: every barangay of a city/municipality shares one province, and the seed
         -- migration for fact_uuc_phc_indicators asserts no province carries two different
         -- reference values. Discarded above province by the CASE in the final select.
         max(s.ref) as provincial_ref
  from scored s
  join geo_map m on m.brgy_code = s.geo_code
  group by 1, 2, 3
)
insert into agg_uuc_phc_indicator_dist (
  dataset_id, geo_code, geo_level, indicator, value_max, n_listed,
  bin_counts, bin_capped, n_missing, provincial_ref, n_comparable, n_worse
)
select
  (select dataset_id from ds),
  a.geo_code, a.geo_level, a.indicator, a.mx,
  coalesce(sc.n_listed, 0),
  a.bin_counts, a.bin_capped,
  coalesce(sc.n_missing, 0),
  -- A single reference line exists only within one province. Above that the area spans 87 of
  -- them and any one value would be an arbitrary province's standing in for the rest.
  case when a.geo_level in ('province', 'citymun') then sc.provincial_ref end,
  coalesce(sc.n_comparable, 0),
  coalesce(sc.n_worse, 0)
from arrays a
left join scalars sc
  on sc.geo_code = a.geo_code and sc.geo_level = a.geo_level and sc.indicator = a.indicator
on conflict (dataset_id, geo_code, geo_level, indicator) do update set
  value_max = excluded.value_max,
  n_listed = excluded.n_listed,
  bin_counts = excluded.bin_counts,
  bin_capped = excluded.bin_capped,
  n_missing = excluded.n_missing,
  provincial_ref = excluded.provincial_ref,
  n_comparable = excluded.n_comparable,
  n_worse = excluded.n_worse;

-- ---------------------------------------------------------------------------------------------
-- Assert, after loading, the invariants the page depends on. Each is cheap, and each has a way of
-- being violated silently by a future edit — which is the test for whether an assertion earns its
-- place. A failure aborts the migration rather than publishing a wrong histogram.
do $$
declare
  n_bad integer;
begin
  -- 1. Every geo carries all 12 indicators, and the denominator is the one agg_uuc_phc_counts
  --    publishes. A histogram drawn against a different n_listed than the coverage page prints
  --    for the same area is the drift this check exists to catch.
  select count(*) into n_bad
  from agg_uuc_phc_counts c
  left join (
    select dataset_id, geo_code, geo_level, count(*) as n_ind, min(n_listed) as lo, max(n_listed) as hi
    from agg_uuc_phc_indicator_dist group by 1, 2, 3
  ) d on d.dataset_id = c.dataset_id and d.geo_code = c.geo_code and d.geo_level = c.geo_level
  where d.geo_code is null or d.n_ind <> 12 or d.lo <> c.n_listed or d.hi <> c.n_listed;
  if n_bad > 0 then
    raise exception '% geo(s) lack all 12 indicator rows or disagree with agg_uuc_phc_counts.n_listed', n_bad;
  end if;

  -- 2. The bars account for every listed barangay. A histogram whose bins sum to less than the
  --    area's list is a histogram of an unstated subset, which is the failure mode this whole
  --    table exists to avoid.
  select count(*) into n_bad
  from agg_uuc_phc_indicator_dist
  where (select coalesce(sum(x), 0) from unnest(bin_counts) x) + n_missing <> n_listed;
  if n_bad > 0 then
    raise exception '% row(s) have bins + n_missing <> n_listed', n_bad;
  end if;

  -- 3. Capped counts are a subset of their bin, and live only in the top bin. The second half is
  --    what lets the page label the top bar "of which N were bounded" without qualifying where in
  --    the distribution the bounded values are: a bounded value equals value_max by definition.
  select count(*) into n_bad
  from agg_uuc_phc_indicator_dist d
  where (select coalesce(sum(x), 0) from unnest(d.bin_capped[1:9]) x) > 0
     or exists (
       select 1 from generate_series(1, 10) i
       where d.bin_capped[i] > d.bin_counts[i] or d.bin_capped[i] < 0 or d.bin_counts[i] < 0
     );
  if n_bad > 0 then
    raise exception '% row(s) have capped values outside the top bin or above their bin count', n_bad;
  end if;

  -- 4. The national capped totals are the fact table's own, per indicator — the figure the page
  --    prints on the top bar. docs/UUC_PHC_2025_CLEANING_REPORT.md §4 records 886 Water, 456 FIC,
  --    208 Pre-natal, 30 SBA, 2 ABR, 1 IMR, 1 UFMR; this compares against the data rather than
  --    against those numbers, so a regenerated extract moves both together.
  select count(*) into n_bad
  from agg_uuc_phc_indicator_dist d
  join (
    select unnest(capped_indicators) as indicator, count(*)::int as n
    from fact_uuc_phc_indicators
    where dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
    group by 1
  ) f on f.indicator = d.indicator
  where d.geo_level = 'national'
    and (select coalesce(sum(x), 0) from unnest(d.bin_capped) x) <> f.n;
  if n_bad > 0 then
    raise exception '% national indicator(s) disagree with fact_uuc_phc_indicators.capped_indicators', n_bad;
  end if;

  -- 5. Comparison counts nest inside their denominators, and the five socio-economic indicators
  --    have no comparison at all — criterion (d) does not test them, so a non-zero count there
  --    would mean a benchmark had been paired with the wrong column.
  select count(*) into n_bad
  from agg_uuc_phc_indicator_dist
  where n_worse > n_comparable
     or n_comparable > n_listed
     or least(n_worse, n_comparable, n_missing, n_listed) < 0
     or (indicator in ('physical_factor', 'ip_pop', 'armed_conf', 'idp', 'four_ps')
         and (n_comparable > 0 or n_worse > 0 or provincial_ref is not null));
  if n_bad > 0 then
    raise exception '% row(s) have a comparison count outside its denominator, or one on an indicator criterion (d) does not test', n_bad;
  end if;

  -- 6. A reference line exists only where a single province's benchmark does.
  select count(*) into n_bad
  from agg_uuc_phc_indicator_dist
  where provincial_ref is not null and geo_level not in ('province', 'citymun');
  if n_bad > 0 then
    raise exception '% row(s) carry a provincial benchmark above province level', n_bad;
  end if;

  -- 7. n_comparable must agree with agg_uuc_phc_criteria's evaluable count wherever this
  --    indicator's own benchmark is usable everywhere in the area. The two are computed from the
  --    same rule in two files; this is what stops one of them being edited alone. FIC is exempt
  --    because 113 barangays additionally fail the benchmark-exceeds-maximum test, which is an
  --    indicator-level exclusion agg_uuc_phc_criteria has no column for.
  select count(*) into n_bad
  from agg_uuc_phc_indicator_dist d
  join agg_uuc_phc_criteria c
    on c.dataset_id = d.dataset_id and c.geo_code = d.geo_code and c.geo_level = d.geo_level
  where d.indicator in ('imr', 'ufmr', 'abr', 'pre_natal', 'sba', 'water')
    and d.n_comparable <> c.n_health_evaluable;
  if n_bad > 0 then
    raise exception '% row(s) disagree with agg_uuc_phc_criteria.n_health_evaluable', n_bad;
  end if;

  -- 8. Each level rolls up to the same national totals, per indicator. A region, province or
  --    city that lost or double-counted a barangay shows up here and nowhere else.
  select count(*) into n_bad
  from (
    select indicator, geo_level,
           sum(n_listed) as l, sum(n_missing) as m,
           sum(n_comparable) as c, sum(n_worse) as w,
           sum((select coalesce(sum(x), 0) from unnest(bin_capped) x)) as k
    from agg_uuc_phc_indicator_dist
    group by 1, 2
  ) t
  join (
    select indicator,
           n_listed as l, n_missing as m, n_comparable as c, n_worse as w,
           (select coalesce(sum(x), 0) from unnest(bin_capped) x) as k
    from agg_uuc_phc_indicator_dist where geo_level = 'national'
  ) nat on nat.indicator = t.indicator
  where t.l <> nat.l or t.m <> nat.m or t.c <> nat.c or t.w <> nat.w or t.k <> nat.k;
  if n_bad > 0 then
    raise exception '% level/indicator pair(s) do not roll up to the national totals', n_bad;
  end if;
end $$;

-- =============================================================================================
-- 6. Rebuild agg_bhw_by_uuc_status — BHW coverage split by list membership.
--
-- Re-executed verbatim from supabase/migrations/20260827190000_agg_bhw_by_uuc_status.sql. Its own
-- internal step numbering (2, 3, 4, 5 below) is that file's, left untouched so the two can be
-- diffed line for line.
--
-- Note this is the one rebuild whose *shape* changes: Cavite's listed side falls to three
-- barangays, which is inside the 0 < n < 5 suppression rule, so the province leaves the comparison
-- and CALABARZON stops badging an area against the pattern.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 2. Populate, unsuppressed. Idempotent: recomputes and upserts every row, so re-running after a
-- fact reload is the refresh procedure — the same discipline as the other three UUC aggregates.
--
-- Suppression is applied as a separate pass at step 4, deliberately: the assertions at step 3 then
-- run against complete values, which is a stronger check than anything they could make of a table
-- whose small cells have already been nulled.
--
-- The two sources this table is built from. Stated outright because the generator reads
-- `create table` and `create view` bodies for provenance, and this table is populated by a
-- separate `insert ... select` — a real derivation no DDL statement expresses.
-- lineage: table:agg_bhw_by_uuc_status derived-from table:agg_bhw_stepzero_counts
-- lineage: table:agg_bhw_by_uuc_status derived-from table:fact_uuc_phc_barangay
with uuc as (select dataset_id from dim_dataset where slug = 'uuc-phc-2025'),
stepzero as (select dataset_id from dim_dataset where slug = 'bhw-stepzero-2026'),
profiled as (select dataset_id from dim_dataset where slug = 'bhw-2025'),

-- One row per barangay: its ancestors, its UUC status, its StepZero figures and its profiled
-- count. `listed` is presence in the fact table — membership is presence, there is no decision
-- column (plan U1).
barangay as (
  select
    g.geo_code,
    g.region_code,
    g.province_code,
    g.citymun_code,
    exists (
      select 1 from fact_uuc_phc_barangay f
      where f.geo_code = g.geo_code and f.dataset_id = (select dataset_id from uuc)
    ) as listed,
    s.n_total_bhw,
    s.households,
    -- Mirrors getStepzeroCounts' registeredUniverse: null only when both parts are null, so a
    -- barangay reporting one and not the other is not silently dropped from the base.
    case
      when s.n_registered is null and s.n_registered_accredited is null then null
      else coalesce(s.n_registered, 0) + coalesce(s.n_registered_accredited, 0)
    end as registered_universe,
    coalesce(c.n_total, 0) as n_profiled
  from dim_geo g
  left join agg_bhw_stepzero_counts s
    on s.geo_code = g.geo_code and s.geo_level = 'barangay'
   and s.dataset_id = (select dataset_id from stepzero)
  left join agg_bhw_counts c
    on c.geo_code = g.geo_code and c.geo_level = 'barangay'
   and c.dataset_id = (select dataset_id from profiled)
  where g.geo_level = 'barangay'
),

-- Fan each barangay out to the four levels it rolls up into, exactly as build_aggregates.sql §1
-- does for the BHW census. One pass, four levels.
fanned as (
  -- Columns listed rather than `b.*`: the barangay's own geo_code would collide with the level's
  -- and make every later reference to it ambiguous.
  select
    lvl.geo_level,
    lvl.geo_code,
    b.listed,
    b.n_total_bhw,
    b.households,
    b.registered_universe,
    b.n_profiled
  from barangay b
  cross join lateral (values
    ('citymun'::geo_level_enum, b.citymun_code),
    ('province'::geo_level_enum, b.province_code),
    ('region'::geo_level_enum, b.region_code),
    ('national'::geo_level_enum, 'PH')
  ) as lvl(geo_level, geo_code)
),

split as (
  select
    f.geo_code,
    f.geo_level,
    count(*) filter (where f.listed) as n_barangays_listed,
    count(*) filter (where not f.listed) as n_barangays_other,
    count(*) filter (where f.listed and f.n_total_bhw is not null) as n_listed_with_data,
    count(*) filter (where not f.listed and f.n_total_bhw is not null) as n_other_with_data,
    count(*) filter (where f.listed and f.n_total_bhw = 0) as n_listed_no_bhw,
    count(*) filter (where not f.listed and f.n_total_bhw = 0) as n_other_no_bhw,
    coalesce(sum(f.n_total_bhw) filter (where f.listed), 0) as listed_n_bhw,
    coalesce(sum(f.n_total_bhw) filter (where not f.listed), 0) as other_n_bhw,
    coalesce(sum(f.households) filter (where f.listed), 0) as listed_households,
    coalesce(sum(f.households) filter (where not f.listed), 0) as other_households,
    coalesce(sum(f.registered_universe) filter (where f.listed), 0) as listed_registered_universe,
    coalesce(sum(f.registered_universe) filter (where not f.listed), 0) as other_registered_universe,
    coalesce(sum(f.n_profiled) filter (where f.listed), 0) as listed_n_profiled,
    coalesce(sum(f.n_profiled) filter (where not f.listed), 0) as other_n_profiled
  from fanned f
  group by f.geo_code, f.geo_level
)
insert into agg_bhw_by_uuc_status (
  dataset_id, geo_code, geo_level,
  n_barangays_listed, n_barangays_other,
  n_listed_with_data, n_other_with_data,
  n_listed_no_bhw, n_other_no_bhw,
  listed_n_bhw, other_n_bhw,
  listed_households, other_households,
  listed_registered_universe, other_registered_universe,
  listed_n_profiled, other_n_profiled,
  unallocated_n_bhw, unallocated_households
)
select
  (select dataset_id from uuc),
  s.geo_code, s.geo_level,
  s.n_barangays_listed, s.n_barangays_other,
  s.n_listed_with_data, s.n_other_with_data,
  s.n_listed_no_bhw, s.n_other_no_bhw,
  s.listed_n_bhw, s.other_n_bhw,
  s.listed_households, s.other_households,
  s.listed_registered_universe, s.other_registered_universe,
  s.listed_n_profiled, s.other_n_profiled,
  -- The area's own StepZero row minus both sides. Zero everywhere except the three regions (and
  -- their ancestors) whose barangay rows do not account for the whole area total.
  coalesce(area.n_total_bhw, s.listed_n_bhw + s.other_n_bhw) - (s.listed_n_bhw + s.other_n_bhw),
  coalesce(area.households, s.listed_households + s.other_households)
    - (s.listed_households + s.other_households)
from split s
left join agg_bhw_stepzero_counts area
  on area.geo_code = s.geo_code and area.geo_level = s.geo_level
 and area.dataset_id = (select dataset_id from stepzero)
on conflict (dataset_id, geo_code, geo_level) do update set
  n_barangays_listed = excluded.n_barangays_listed,
  n_barangays_other = excluded.n_barangays_other,
  n_listed_with_data = excluded.n_listed_with_data,
  n_other_with_data = excluded.n_other_with_data,
  n_listed_no_bhw = excluded.n_listed_no_bhw,
  n_other_no_bhw = excluded.n_other_no_bhw,
  listed_n_bhw = excluded.listed_n_bhw,
  other_n_bhw = excluded.other_n_bhw,
  listed_households = excluded.listed_households,
  other_households = excluded.other_households,
  listed_registered_universe = excluded.listed_registered_universe,
  other_registered_universe = excluded.other_registered_universe,
  listed_n_profiled = excluded.listed_n_profiled,
  other_n_profiled = excluded.other_n_profiled,
  unallocated_n_bhw = excluded.unallocated_n_bhw,
  unallocated_households = excluded.unallocated_households,
  -- Re-running must clear a suppression the new data no longer warrants, or a corrected load
  -- would leave a permanently blank cell that reads as a rule rather than as stale state.
  listed_is_suppressed = false,
  other_is_suppressed = false;

-- Drop any geo that has stopped existing between runs, so a shrinking dim_geo empties rows rather
-- than leaving a stale comparison behind (ref_uuc_phc_published_delta's rule).
delete from agg_bhw_by_uuc_status a
where a.dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  and not exists (
    select 1 from dim_geo g
    where g.geo_code = a.geo_code and g.geo_level = a.geo_level
  );

-- ---------------------------------------------------------------------------------------------
-- 3. Assertions on the complete values, before suppression nulls anything.
--
-- Every one aborts the migration rather than publish a wrong comparison. Numbered as the docs
-- refer to them.
do $$
declare
  n_bad integer;
  n_rows integer;
begin
  -- 1. Row count and coverage: one row per geo that agg_uuc_phc_counts covers, and no others.
  --    The two aggregates are built from different fact tables, so this also checks they see the
  --    same geography. The expected count is read from that aggregate rather than typed — the
  --    section's rule is that a figure is computed or it is not stated, and 1,788 in a `<>` is a
  --    figure.
  select
    (select count(*) from agg_bhw_by_uuc_status),
    (select count(*) from agg_uuc_phc_counts
      where dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025'))
  into n_rows, n_bad;
  if n_rows <> n_bad then
    raise exception 'agg_bhw_by_uuc_status has % rows, agg_uuc_phc_counts has %', n_rows, n_bad;
  end if;

  select count(*) into n_bad
  from agg_uuc_phc_counts c
  where c.dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
    and not exists (
      select 1 from agg_bhw_by_uuc_status a
      where a.geo_code = c.geo_code and a.geo_level = c.geo_level
    );
  if n_bad > 0 then
    raise exception '% geo(s) in agg_uuc_phc_counts have no agg_bhw_by_uuc_status row', n_bad;
  end if;

  -- 2. The partition agrees with the section's own aggregate, barangay for barangay. Reached by a
  --    different path (dim_geo fan-out vs agg_uuc_phc_counts' own build), so a disagreement means
  --    one of the two is wrong about which barangays are listed.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status a
  join agg_uuc_phc_counts c
    on c.geo_code = a.geo_code and c.geo_level = a.geo_level
   and c.dataset_id = a.dataset_id
  where a.n_barangays_listed <> c.n_listed;
  if n_bad > 0 then
    raise exception '% row(s) disagree with agg_uuc_phc_counts.n_listed', n_bad;
  end if;

  -- 3. The two sides partition the area: listed + other is every barangay in it. This is the
  --    plan's own Verify line, and the thing that makes "other" mean what the dictionary says.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status a
  join agg_uuc_phc_counts c
    on c.geo_code = a.geo_code and c.geo_level = a.geo_level
   and c.dataset_id = a.dataset_id
  where a.n_barangays_listed + a.n_barangays_other <> c.n_barangays;
  if n_bad > 0 then
    raise exception '% row(s) where listed + other <> the area''s barangay count', n_bad;
  end if;

  -- 4. Recombination is exact, including the residual. The plan asks that the split reproduce the
  --    unsplit figure; StepZero's area rows exceed the sum of its barangay rows in three regions,
  --    so the equality holds only with `unallocated_*` in it — which is precisely why that column
  --    is stored rather than the discrepancy swallowed.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status a
  join agg_bhw_stepzero_counts s
    on s.geo_code = a.geo_code and s.geo_level = a.geo_level
   and s.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-stepzero-2026')
  where a.listed_n_bhw + a.other_n_bhw + a.unallocated_n_bhw is distinct from s.n_total_bhw
     or a.listed_households + a.other_households + a.unallocated_households
        is distinct from s.households;
  if n_bad > 0 then
    raise exception '% row(s) do not recombine to agg_bhw_stepzero_counts', n_bad;
  end if;

  -- 4b. The residual is a shortfall in the barangay rows, never a surplus. A negative would mean
  --     the barangay rows carry BHWs the area row does not, which is a different defect entirely
  --     and must not be published as "unallocated".
  select count(*) into n_bad
  from agg_bhw_by_uuc_status
  where unallocated_n_bhw < 0 or unallocated_households < 0;
  if n_bad > 0 then
    raise exception '% row(s) carry a negative unallocated residual', n_bad;
  end if;

  -- 5. The profiled counts recombine exactly. agg_bhw_counts is fanned out from each BHW's own
  --    barangay, so unlike StepZero its levels roll up with no residual — and if that ever stops
  --    being true, the profiling-coverage caveat on the page is reading a broken denominator.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status a
  join agg_bhw_counts c
    on c.geo_code = a.geo_code and c.geo_level = a.geo_level
   and c.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
  where a.listed_n_profiled + a.other_n_profiled is distinct from c.n_total;
  if n_bad > 0 then
    raise exception '% row(s) do not recombine to agg_bhw_counts.n_total', n_bad;
  end if;

  -- 6. No count exceeds the denominator it belongs to.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status
  where n_listed_with_data > n_barangays_listed
     or n_other_with_data > n_barangays_other
     or n_listed_no_bhw > n_listed_with_data
     or n_other_no_bhw > n_other_with_data
     or listed_registered_universe > listed_n_bhw
     or other_registered_universe > other_n_bhw;
  if n_bad > 0 then
    raise exception '% row(s) carry a count outside its denominator', n_bad;
  end if;

  -- 7. Every level rolls up to the national totals, on all eight measures. Computed once per
  --    level from the same barangay rows, so a level that disagrees means the fan-out is wrong.
  select count(*) into n_bad
  from (
    select geo_level,
      sum(n_barangays_listed) l, sum(n_barangays_other) o,
      sum(listed_n_bhw) lb, sum(other_n_bhw) ob,
      sum(listed_households) lh, sum(other_households) oh,
      sum(listed_n_profiled) lp, sum(other_n_profiled) op
    from agg_bhw_by_uuc_status
    where geo_level <> 'national'
    group by geo_level
  ) lvl
  cross join (
    select n_barangays_listed l, n_barangays_other o,
      listed_n_bhw lb, other_n_bhw ob,
      listed_households lh, other_households oh,
      listed_n_profiled lp, other_n_profiled op
    from agg_bhw_by_uuc_status where geo_level = 'national'
  ) nat
  where lvl.l <> nat.l or lvl.o <> nat.o
     or lvl.lb <> nat.lb or lvl.ob <> nat.ob
     or lvl.lh <> nat.lh or lvl.oh <> nat.oh
     or lvl.lp <> nat.lp or lvl.op <> nat.op;
  if n_bad > 0 then
    raise exception '% level(s) do not roll up to the national totals', n_bad;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Suppression.
--
-- Plan §9 U12b: "suppress any cell whose contributing barangay count is below the §4.1 threshold"
-- — n < 5, and n = 0 stays visible because a true zero reveals nothing about anybody.
--
-- **This is a presentation rule, not a disclosure control, and saying so matters.** BUILD_PLAN.md
-- §4.1's suppression exists because a small demographic cell can identify a person; but it also
-- says in as many words that "counts of totals — e.g. 'this barangay has 3 BHWs' — are not
-- suppressed", and `agg_bhw_stepzero_counts` is public at barangay grain for all 41,958. Anyone
-- can compute this split themselves. What the rule prevents is *this page* rendering one, two or
-- three barangays as a group statistic and setting it beside a group of hundreds — which is a
-- claim about a group, made from something that is not one.
--
-- Only the small side is nulled. The other side of such an area is, to within a few barangays, the
-- area's own published total, so suppressing it too would destroy a real 198-barangay figure to
-- protect a number already on the page above it. What the page must not do — and does not — is
-- draw the comparison when either side is suppressed.
update agg_bhw_by_uuc_status set
  listed_is_suppressed = true,
  listed_n_bhw = null,
  listed_households = null,
  listed_registered_universe = null,
  listed_n_profiled = null
where n_listed_with_data > 0 and n_listed_with_data < 5;

update agg_bhw_by_uuc_status set
  other_is_suppressed = true,
  other_n_bhw = null,
  other_households = null,
  other_registered_universe = null,
  other_n_profiled = null
where n_other_with_data > 0 and n_other_with_data < 5;

-- ---------------------------------------------------------------------------------------------
-- 5. Assertions on the suppression itself.
do $$
declare
  n_bad integer;
begin
  -- 8. Suppression fired exactly where the rule says and nowhere else, in both directions. The
  --    check constraints already guarantee a suppressed side is wholly null; this is the other
  --    half — that a side is suppressed if and only if 0 < contributing barangays < 5.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status
  where listed_is_suppressed <> (n_listed_with_data > 0 and n_listed_with_data < 5)
     or other_is_suppressed <> (n_other_with_data > 0 and n_other_with_data < 5);
  if n_bad > 0 then
    raise exception '% row(s) where suppression does not match the 0 < n < 5 rule', n_bad;
  end if;

  -- 9. An area with nothing listed is not a suppressed area. NCR reads 0 of 1,675, which is data;
  --    if that ever started rendering as suppressed the page would say "withheld" where the
  --    correct answer is "none".
  select count(*) into n_bad
  from agg_bhw_by_uuc_status
  where n_barangays_listed = 0 and listed_is_suppressed;
  if n_bad > 0 then
    raise exception '% area(s) with nothing listed are marked suppressed', n_bad;
  end if;
end $$;

-- =============================================================================================
-- 7. The data-quality relations.
--
-- ref_uuc_phc_quality is a view, so it re-derives on read and needs no rebuild — but one of its
-- columns now needs a different definition, and the assertion below is what forces the point.
--
-- **A barangay with no recorded criterion (d) score is not a disagreement.** The two score columns
-- exist to measure how far a recomputation from the published columns lands from the source's own
-- score. SUMISIP CENTRAL has no such score (see the header), and `recomputed is distinct from
-- health_indicators` counts a NULL as different from every integer — so it entered
-- n_score_disagreement while `recomputed < health_indicators` left it out of n_score_understated,
-- making the two disagree for the first time. That would trip assertion 7 below, which is the
-- assertion doing its job: the claim it guards ("the recomputation is always worse, never better")
-- is a claim about rows where both numbers exist. Restricted to those rows, both counts read 664
-- as before, and the gap the page quotes is unchanged by the alignment.
-- =============================================================================================

create or replace view ref_uuc_phc_quality
with (security_invoker = true) as
with scored as (
  select
    i.geo_code,
    cardinality(i.capped_indicators) as n_capped,
    i.health_indicators,
    -- comparesWorse, per indicator, in the direction criterion (d) asks it. A null benchmark or
    -- one above the indicator's own maximum contributes nothing, exactly as the read layer's
    -- function returns null rather than false.
    ( coalesce(i.imr_prov_ref       <= 1000 and i.imr       > i.imr_prov_ref,       false)::int
    + coalesce(i.ufmr_prov_ref      <= 1000 and i.ufmr      > i.ufmr_prov_ref,      false)::int
    + coalesce(i.abr_prov_ref       <= 1000 and i.abr       > i.abr_prov_ref,       false)::int
    + coalesce(i.fic_prov_ref       <=  100 and i.fic       < i.fic_prov_ref,       false)::int
    + coalesce(i.pre_natal_prov_ref <=  100 and i.pre_natal < i.pre_natal_prov_ref, false)::int
    + coalesce(i.sba_prov_ref       <=  100 and i.sba       < i.sba_prov_ref,       false)::int
    + coalesce(i.water_prov_ref     <=  100 and i.water     < i.water_prov_ref,     false)::int
    ) as recomputed,
    -- Whether any of the three socio-economic routes carries this barangay without criterion (d).
    ( coalesce(i.ip_pop, 0) >= 10
      or coalesce(i.armed_conf, 0) + coalesce(i.idp, 0) >= 10
      or coalesce(i.elcac_brgy, false)
      or coalesce(i.four_ps, 0) >= 50 ) as other_route
  from fact_uuc_phc_indicators i
  where i.dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
)
select
  count(*)::int                                              as n_listed,
  count(*) filter (where n_capped > 0)::int                  as n_barangays_capped,
  coalesce(sum(n_capped), 0)::int                            as n_values_capped,
  count(*) filter (where n_capped > 1)::int                  as n_barangays_multi_capped,
  -- Both score columns are counted only over barangays that HAVE a recorded score. Where the
  -- source recorded none there is nothing for the recomputation to disagree with, and counting it
  -- as a disagreement would inflate a figure the page presents as a measured gap.
  count(*) filter (where health_indicators is not null
                     and recomputed is distinct from health_indicators)::int
                                                             as n_score_disagreement,
  count(*) filter (where health_indicators is not null
                     and recomputed < health_indicators)::int as n_score_understated,
  -- Listed barangays that would qualify on no route at all if criterion (d) were recomputed —
  -- which DOH AO No. 2020-0023 makes impossible, and which is why the source's own score is the
  -- one that decided this list.
  count(*) filter (where not other_route and recomputed < 4)::int as n_no_route_if_recomputed,
  count(*) filter (where not other_route and coalesce(health_indicators, 0) < 4)::int
                                                             as n_no_route_as_recorded
from scored;

comment on view ref_uuc_phc_quality is
  'One row: the national data-quality facts behind /uuc-phc/data-quality that no per-indicator aggregate can express. n_barangays_capped counts BARANGAYS (1,397), not values (1,584) — 167 barangays carry more than one bounded value, so the two must never be swapped. The score columns recompute criterion (d) from the published columns solely to measure how far that derivation lands from the source''s own recorded score; they are a measurement of the gap, never a score to report, and they count only the barangays that have a recorded score to compare against. See docs/UUC_PHC_2025_PLAN.md §9 U10.';

comment on table ref_uuc_phc_published_delta is
  'The 2025 UUC for PHC published-total reconciliation: every geography where the 2027 Budget Cue Cards p37 figure differs from this dashboard''s. AS OF THE FINAL-LIST ALIGNMENT THIS TABLE IS EMPTY, AND EMPTY IS THE ANSWER: the dashboard now publishes the source office''s final 5,987, which is what p37 reports, so all 17 regions and the national total agree to the unit. Parsed from the doc_chunk copy of p37 rather than transcribed, so any row that appears here is a real discrepancy. Matching geographies are deliberately not stored — the cue cards are an internal-exposure document and a matching row carries no reconciliation — so a caller must not read no-rows as no-data. See docs/UUC_PHC_2025_PLAN.md §3.';

-- Rebuild ref_uuc_phc_published_delta. It empties: every geography now agrees with p37.
--
-- Re-executed verbatim from supabase/migrations/20260827170000_uuc_phc_data_quality.sql.

-- Populate. Idempotent: re-parses and upserts, so re-running after a corpus or fact reload is the
-- refresh procedure. Rows that have stopped differing are deleted, so a corrected cue card empties
-- the table rather than leaving a stale discrepancy on the page.
with ds as (
  select dataset_id from dim_dataset where slug = 'uuc-phc-2025'
),
doc as (
  select s.key, s.as_of, c.page_from, c.content
  from doc_chunk c
  join doc_source s on s.doc_id = c.doc_id
  where s.key = 'blhsd-2027-budget-cue-cards'
    and c.page_from = 37 and c.page_to = 37
),
-- p37 sets each region name on its own line with the count on the next: "REGION V (BICOL
-- REGION)\n757\n\n". The header row ("REGION\nNUMBER") cannot match because NUMBER is not digits.
pairs as (
  select (m)[1] as label, (m)[2]::int as n
  from doc, regexp_matches(doc.content, '([A-Z][^\n]*)\n(\d+)', 'g') as m
),
published as (
  -- Matched to dim_geo on the printed name. Exact, not fuzzy: p37 uses the PSA region names
  -- verbatim, and all 17 resolve — asserted below, so a renamed region fails the migration rather
  -- than silently dropping a row.
  select g.geo_code, 'region'::geo_level_enum as geo_level, p.label, p.n
  from pairs p
  join dim_geo g on g.geo_level = 'region' and g.geo_name = p.label
  where p.label <> 'TOTAL'
  union all
  select 'PH', 'national'::geo_level_enum, p.label, p.n
  from pairs p
  where p.label = 'TOTAL'
),
compared as (
  select
    pub.geo_code, pub.geo_level, pub.label, pub.n as n_published,
    c.n_listed,
    c.n_listed - pub.n as delta
  from published pub
  join agg_uuc_phc_counts c
    on c.dataset_id = (select dataset_id from ds)
   and c.geo_code = pub.geo_code and c.geo_level = pub.geo_level
)
insert into ref_uuc_phc_published_delta (
  dataset_id, geo_code, geo_level, source_label, n_published, n_listed, delta,
  source_doc_key, source_page, source_as_of
)
select
  (select dataset_id from ds), cmp.geo_code, cmp.geo_level, cmp.label,
  cmp.n_published, cmp.n_listed, cmp.delta,
  (select key from doc), (select page_from from doc), (select as_of from doc)
from compared cmp
where cmp.delta <> 0
on conflict (dataset_id, geo_code, geo_level) do update set
  source_label = excluded.source_label,
  n_published = excluded.n_published,
  n_listed = excluded.n_listed,
  delta = excluded.delta,
  source_doc_key = excluded.source_doc_key,
  source_page = excluded.source_page,
  source_as_of = excluded.source_as_of;

-- A geography that has stopped differing must leave, or the page keeps reporting a closed gap.
delete from ref_uuc_phc_published_delta d
where not exists (
  select 1
  from agg_uuc_phc_counts c
  where c.dataset_id = d.dataset_id and c.geo_code = d.geo_code and c.geo_level = d.geo_level
    and c.n_listed - d.n_published <> 0
);

-- ---------------------------------------------------------------------------------------------
-- Assert, after loading, what the page depends on. A failure aborts the migration rather than
-- publishing a wrong claim about our own data quality — which is the one kind of wrong figure this
-- page cannot afford.
do $$
declare
  n_bad integer;
  n_regions integer;
  n_total integer;
  n_sum integer;
begin
  -- 1. The parse found p37 and read it whole: 17 region rows, every one resolving to dim_geo, and
  --    a TOTAL row that equals their sum. A mis-parse that still balances is not reachable.
  with doc as (
    select c.content from doc_chunk c join doc_source s on s.doc_id = c.doc_id
    where s.key = 'blhsd-2027-budget-cue-cards' and c.page_from = 37 and c.page_to = 37
  ),
  pairs as (
    select (m)[1] as label, (m)[2]::int as n
    from doc, regexp_matches(doc.content, '([A-Z][^\n]*)\n(\d+)', 'g') as m
  )
  select
    (select count(*) from pairs where label <> 'TOTAL'),
    (select sum(n) from pairs where label <> 'TOTAL'),
    (select n from pairs where label = 'TOTAL'),
    (select count(*) from pairs p where p.label <> 'TOTAL'
       and not exists (select 1 from dim_geo g where g.geo_level = 'region' and g.geo_name = p.label))
  into n_regions, n_sum, n_total, n_bad;

  if n_regions <> 17 then
    raise exception 'cue cards p37 parsed % region rows, expected 17', n_regions;
  end if;
  if n_bad > 0 then
    raise exception '% region name(s) on cue cards p37 do not resolve to a dim_geo region', n_bad;
  end if;
  if n_sum is distinct from n_total then
    raise exception 'cue cards p37 regions sum to % but its TOTAL row reads %', n_sum, n_total;
  end if;

  -- 2. The one region p37 does not print must be the one with nothing listed. If a region with
  --    listed barangays ever goes unprinted, the reconciliation below is incomplete and silent.
  select count(*) into n_bad
  from dim_geo g
  join agg_uuc_phc_counts c
    on c.geo_code = g.geo_code and c.geo_level = 'region'
   and c.dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  where g.geo_level = 'region'
    and c.n_listed > 0
    and not exists (
      select 1
      from doc_chunk ch join doc_source s on s.doc_id = ch.doc_id,
           regexp_matches(ch.content, '([A-Z][^\n]*)\n(\d+)', 'g') as m
      where s.key = 'blhsd-2027-budget-cue-cards' and ch.page_from = 37 and (m)[1] = g.geo_name
    );
  if n_bad > 0 then
    raise exception '% region(s) with listed barangays are absent from cue cards p37', n_bad;
  end if;

  -- 3. Every stored delta is real and its arithmetic holds against the published aggregate.
  select count(*) into n_bad
  from ref_uuc_phc_published_delta d
  join agg_uuc_phc_counts c
    on c.dataset_id = d.dataset_id and c.geo_code = d.geo_code and c.geo_level = d.geo_level
  where d.delta = 0 or d.n_listed <> c.n_listed or d.delta <> c.n_listed - d.n_published;
  if n_bad > 0 then
    raise exception '% published-delta row(s) do not reconcile against agg_uuc_phc_counts', n_bad;
  end if;

  -- 4. The capping totals agree with the per-indicator aggregate U9 publishes. They are computed
  --    from the same fact table by different routes, so agreement is a real check that neither
  --    counts a value the other misses — and it is the pair a reader will add up by hand.
  select count(*) into n_bad
  from ref_uuc_phc_quality q
  where q.n_values_capped <> (
    select coalesce(sum((select coalesce(sum(x), 0) from unnest(d.bin_capped) x)), 0)
    from agg_uuc_phc_indicator_dist d
    where d.geo_level = 'national'
      and d.dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  );
  if n_bad > 0 then
    raise exception 'ref_uuc_phc_quality.n_values_capped disagrees with agg_uuc_phc_indicator_dist';
  end if;

  -- 5. Barangays carrying a bounded value cannot outnumber the values themselves, and the list
  --    cannot be smaller than either. This is what stops the page swapping 1,397 for 1,584.
  select count(*) into n_bad
  from ref_uuc_phc_quality
  where n_barangays_capped > n_values_capped
     or n_values_capped > n_listed * 7
     or n_barangays_capped > n_listed
     or n_barangays_multi_capped > n_barangays_capped;
  if n_bad > 0 then
    raise exception 'ref_uuc_phc_quality capping counts are inconsistent';
  end if;

  -- 6. The benchmark-gap view must account for exactly the barangays agg_uuc_phc_criteria excludes
  --    from route (d), and for exactly the barangays agg_uuc_phc_indicator_dist marks FIC-only.
  --    Three files implementing one rule; this is what stops one of them being edited alone.
  select count(*) into n_bad
  from (
    select coalesce(sum(n_affected), 0)::int as n
    from ref_uuc_phc_benchmark_gaps where finding = 'criterion_d'
  ) g
  cross join (
    select (n_listed - n_health_evaluable)::int as n
    from agg_uuc_phc_criteria
    where geo_level = 'national'
      and dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  ) c
  where g.n <> c.n;
  if n_bad > 0 then
    raise exception 'ref_uuc_phc_benchmark_gaps criterion_d total disagrees with agg_uuc_phc_criteria';
  end if;

  select count(*) into n_bad
  from (
    select coalesce(sum(n_affected), 0)::int as n
    from ref_uuc_phc_benchmark_gaps where finding = 'fic_only'
  ) g
  cross join (
    select coalesce(sum(n_listed), 0)::int as n
    from agg_uuc_phc_indicator_dist
    where geo_level = 'province' and indicator = 'fic' and provincial_ref > value_max
      and dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  ) d
  where g.n <> d.n;
  if n_bad > 0 then
    raise exception 'ref_uuc_phc_benchmark_gaps fic_only total disagrees with agg_uuc_phc_indicator_dist';
  end if;

  -- 7. The recomputation must be *worse* than the source's own score, never better — that is the
  --    substance of the claim the page makes about health_indicators. If a recomputation ever
  --    left zero barangays routeless while the source's score did too, the column note would need
  --    rewriting rather than rendering.
  select count(*) into n_bad
  from ref_uuc_phc_quality
  where n_no_route_as_recorded <> 0
     or n_no_route_if_recomputed = 0
     or n_score_understated <> n_score_disagreement;
  if n_bad > 0 then
    raise exception 'the criterion (d) recomputation no longer behaves as docs/UUC_PHC_2025_PLAN.md describes';
  end if;
end $$;
